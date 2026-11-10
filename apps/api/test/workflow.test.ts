import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, multipart, setupApp, uniq, type Session, type TestCtx } from './helpers.js';
import { runReminders } from '../src/modules/notify.js';

let ctx: TestCtx;
let unit: { id: string };
let other: { id: string };
let gov: Session;
let owner: { user: { id: string }; session: Session };
let dpo: { user: { id: string }; session: Session };
let reviewer: { user: { id: string }; session: Session };
let legal: Session;
let reader: { user: { id: string }; session: Session };
let outsider: { user: { id: string }; session: Session };

type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const req = (s: Session, method: M, url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });
const upload = (
  s: Session,
  url: string,
  fields: Record<string, string>,
  file?: { name: string; content: Buffer | string },
) => {
  const body = multipart(fields, file);
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: authed(s, { 'content-type': body.contentType }),
    payload: body.payload,
  });
};
const PDF = Buffer.from('%PDF-1.4\n% document de test fictif\n%%EOF\n');

async function newSystem(s: Session = gov) {
  const r = await req(s, 'POST', '/ai-systems', {
    name: uniq('SIA workflow'),
    orgUnitId: unit.id,
    ownerId: owner.user.id,
    purpose: 'Finalité initiale',
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; version: number; reference: string };
}

beforeAll(async () => {
  ctx = await setupApp();
  unit = await createOrgUnit(ctx.prisma);
  other = await createOrgUnit(ctx.prisma);
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE' }])).session;
  owner = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unit.id }]);
  dpo = await loginAs(ctx, [{ role: 'DPO' }]);
  reviewer = await loginAs(ctx, [{ role: 'REVIEWER' }]);
  legal = (await loginAs(ctx, [{ role: 'LEGAL' }])).session;
  reader = await loginAs(ctx, [{ role: 'READER', orgUnitId: unit.id }]);
  outsider = await loginAs(ctx, [{ role: 'AI_GOVERNANCE', orgUnitId: other.id }]);
});
afterAll(async () => ctx.close());

describe('documents et preuves', () => {
  it('dépôt contrôlé, versions, téléchargement en pièce jointe, périmètre', async () => {
    const s = await newSystem();
    const up = await upload(
      owner.session,
      `/ai-systems/${s.id}/documents`,
      { title: 'Analyse de sécurité', type: 'SECURITY_ANALYSIS' },
      { name: 'analyse.pdf', content: PDF },
    );
    expect(up.statusCode, up.body).toBe(201);
    const doc = up.json();
    expect(doc.current.versionNo).toBe(1);
    expect(doc.versions[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.current.scanStatus).toBe('NOT_SCANNED');

    const dl = await req(reader.session, 'GET', `/documents/${doc.id}/versions/1/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.rawPayload.equals(PDF)).toBe(true);

    const v2 = await upload(
      owner.session,
      `/documents/${doc.id}/versions`,
      { changeNote: 'Mise à jour' },
      { name: 'analyse-v2.pdf', content: PDF },
    );
    expect(v2.statusCode, v2.body).toBe(201);
    expect(v2.json().currentVersionNo).toBe(2);
    expect(v2.json().versions).toHaveLength(2);

    expect((await req(outsider.session, 'GET', `/documents/${doc.id}`)).statusCode).toBe(404);
    expect((await req(outsider.session, 'GET', `/documents/${doc.id}/versions/1/download`)).statusCode).toBe(404);
    const list = (await req(outsider.session, 'GET', '/documents')).json();
    expect(list.items.some((d: { id: string }) => d.id === doc.id)).toBe(false);
  });

  it('refuse formats dangereux, contenu ne correspondant pas à l’extension, fichiers trop gros, dépôt sans droit', async () => {
    const s = await newSystem();
    const url = `/ai-systems/${s.id}/documents`;
    expect(
      (
        await upload(
          gov,
          url,
          { title: 'Page', type: 'OTHER' },
          { name: 'page.html', content: '<script>alert(1)</script>' },
        )
      ).statusCode,
    ).toBe(415);
    expect(
      (await upload(gov, url, { title: 'Image', type: 'OTHER' }, { name: 'x.svg', content: '<svg onload=alert(1)>' }))
        .statusCode,
    ).toBe(415);
    expect(
      (await upload(gov, url, { title: 'Faux PDF', type: 'OTHER' }, { name: 'faux.pdf', content: '<html>' }))
        .statusCode,
    ).toBe(415);
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10, 0x20)]);
    expect(
      (await upload(gov, url, { title: 'Trop gros', type: 'OTHER' }, { name: 'gros.pdf', content: big })).statusCode,
    ).toBe(413);
    expect(
      (await upload(reader.session, url, { title: 'Lecteur', type: 'OTHER' }, { name: 'a.pdf', content: PDF }))
        .statusCode,
    ).toBe(403);
    expect((await req(gov, 'GET', `/ai-systems/${s.id}/documents`)).json().items).toHaveLength(0);
  });

  it('preuves rattachées aux risques du même SIA uniquement', async () => {
    const s = await newSystem();
    const s2 = await newSystem();
    const doc = (
      await upload(
        gov,
        `/ai-systems/${s.id}/documents`,
        { title: 'Rapport de tests', type: 'TEST_REPORT' },
        { name: 'tests.csv', content: 'cas;résultat\n1;ok\n' },
      )
    ).json();
    const foreign = (
      await upload(
        gov,
        `/ai-systems/${s2.id}/documents`,
        { title: 'Autre SIA', type: 'OTHER' },
        { name: 'x.txt', content: 'texte' },
      )
    ).json();
    const risk = (
      await req(gov, 'POST', `/ai-systems/${s.id}/risks`, { category: 'ROBUSTNESS', title: 'Dérive des performances' })
    ).json();
    expect((await req(gov, 'POST', `/risks/${risk.id}/evidence`, { documentId: doc.id })).statusCode).toBe(204);
    expect((await req(gov, 'POST', `/risks/${risk.id}/evidence`, { documentId: foreign.id })).statusCode).toBe(400);
    const r = (await req(gov, 'GET', `/risks/${risk.id}`)).json();
    expect(r.evidences.map((e: { id: string }) => e.id)).toEqual([doc.id]);
    expect((await req(gov, 'DELETE', `/risks/${risk.id}/evidence/${doc.id}`)).statusCode).toBe(204);
  });
});

describe('validation par domaine', () => {
  it('demande, quatre yeux, habilitation par domaine, verrouillage puis revue exceptionnelle', async () => {
    const s = await newSystem();
    const asked = await req(owner.session, 'POST', `/ai-systems/${s.id}/validation-requests`, {
      domains: ['DPO', 'BUSINESS'],
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const list = (await req(dpo.session, 'GET', `/ai-systems/${s.id}/approvals`)).json();
    expect(list.state).toBe('PENDING');
    const dpoApproval = list.items.find((a: { domain: string }) => a.domain === 'DPO');
    const bizApproval = list.items.find((a: { domain: string }) => a.domain === 'BUSINESS');
    expect(dpoApproval.canDecide).toBe(true);

    // Notification au DPO.
    const notifs = (await req(dpo.session, 'GET', '/notifications?unread=true')).json();
    expect(notifs.items.some((n: { title: string }) => n.title.includes(s.reference))).toBe(true);

    expect((await req(legal, 'POST', `/approvals/${dpoApproval.id}/decide`, { decision: 'APPROVED' })).statusCode).toBe(
      403,
    );
    expect(
      (await req(dpo.session, 'POST', `/approvals/${dpoApproval.id}/decide`, { decision: 'REJECTED', comment: 'non' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await req(dpo.session, 'POST', `/approvals/${dpoApproval.id}/decide`, { decision: 'APPROVED' })).statusCode,
    ).toBe(200);
    const done = await req(reviewer.session, 'POST', `/approvals/${bizApproval.id}/decide`, { decision: 'APPROVED' });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().validated).toBe(true);
    let state = (await req(gov, 'GET', `/ai-systems/${s.id}/approvals`)).json();
    expect(state.state).toBe('VALIDATED');

    // Modification substantielle : nouvelle version non validée et revue exceptionnelle automatique.
    const cur = (await req(gov, 'GET', `/ai-systems/${s.id}`)).json();
    const patched = await req(gov, 'PATCH', `/ai-systems/${s.id}`, {
      version: cur.version,
      purpose: 'Nouvelle finalité élargie',
    });
    expect(patched.statusCode, patched.body).toBe(200);
    state = (await req(gov, 'GET', `/ai-systems/${s.id}/approvals`)).json();
    expect(state.state).toBe('MODIFIED_SINCE_VALIDATION');
    const reviews = (await req(gov, 'GET', `/ai-systems/${s.id}/reviews`)).json();
    expect(
      reviews.items.some(
        (r: { kind: string; trigger: string }) => r.kind === 'EXCEPTIONAL' && r.trigger === 'PURPOSE_CHANGE',
      ),
    ).toBe(true);
    const ownerNotifs = (await req(owner.session, 'GET', '/notifications')).json();
    expect(ownerNotifs.items.some((n: { title: string }) => n.title.startsWith('Revue exceptionnelle'))).toBe(true);
  });

  it('le demandeur ne valide pas sa propre demande ; une demande devient caduque si la fiche change', async () => {
    const s = await newSystem();
    await req(gov, 'POST', `/ai-systems/${s.id}/validation-requests`, { domains: ['BUSINESS'] });
    const a = (await req(gov, 'GET', `/ai-systems/${s.id}/approvals`)).json().items[0];
    expect(a.canDecide).toBe(false);
    expect((await req(gov, 'POST', `/approvals/${a.id}/decide`, { decision: 'APPROVED' })).statusCode).toBe(403);
    const cur = (await req(gov, 'GET', `/ai-systems/${s.id}`)).json();
    await req(gov, 'PATCH', `/ai-systems/${s.id}`, { version: cur.version, description: 'Changement' });
    expect(
      (await req(reviewer.session, 'POST', `/approvals/${a.id}/decide`, { decision: 'APPROVED' })).statusCode,
    ).toBe(409);
  });
});

describe('revues, commentaires, rappels, versions', () => {
  it('clôture d’une revue : conclusion obligatoire, prochaine revue selon la périodicité', async () => {
    const s = await newSystem();
    const created = await req(gov, 'POST', `/ai-systems/${s.id}/reviews`, {
      kind: 'PERIODIC',
      trigger: 'SCHEDULED',
      dueDate: '2026-12-31',
      reviewerId: reviewer.user.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    const rid = created.json().id;
    expect(
      (
        await req(owner.session, 'POST', `/ai-systems/${s.id}/reviews`, {
          kind: 'PERIODIC',
          trigger: 'MANUAL',
          dueDate: '2026-12-31',
        })
      ).statusCode,
    ).toBe(403);
    expect((await req(reviewer.session, 'POST', `/reviews/${rid}/complete`, { outcome: 'ok' })).statusCode).toBe(400);
    const done = await req(reviewer.session, 'POST', `/reviews/${rid}/complete`, {
      outcome: 'Revue réalisée, aucun écart constaté.',
    });
    expect(done.statusCode, done.body).toBe(200);
    const after = (await req(gov, 'GET', `/ai-systems/${s.id}/reviews`)).json();
    // Catégorie « À déterminer » : 6 mois par défaut.
    const expected = new Date();
    expected.setUTCMonth(expected.getUTCMonth() + 6);
    expect(after.nextReviewDate.slice(0, 7)).toBe(expected.toISOString().slice(0, 7));
    expect(after.lastReviewDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('commentaires : mentions contrôlées et notifiées, lecteur sans droit d’écriture', async () => {
    const s = await newSystem();
    expect(
      (await req(gov, 'POST', `/ai-systems/${s.id}/comments`, { body: 'Bonjour', mentions: [outsider.user.id] }))
        .statusCode,
    ).toBe(400);
    const ok = await req(gov, 'POST', `/ai-systems/${s.id}/comments`, {
      body: 'Merci de vérifier la finalité',
      section: 'general',
      mentions: [reader.user.id],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const n = (await req(reader.session, 'GET', '/notifications?unread=true')).json();
    expect(n.items.some((x: { type: string }) => x.type === 'mention')).toBe(true);
    expect((await req(reader.session, 'POST', '/notifications/read', {})).json().updated).toBeGreaterThan(0);
    expect((await req(reader.session, 'POST', `/ai-systems/${s.id}/comments`, { body: 'Non' })).statusCode).toBe(403);
    const list = (await req(reader.session, 'GET', `/ai-systems/${s.id}/comments`)).json();
    expect(list.items).toHaveLength(1);
    expect(list.canWrite).toBe(false);
  });

  it('rappels d’échéance idempotents', async () => {
    const s = await newSystem();
    const due = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const a = await req(gov, 'POST', '/actions', {
      aiSystemId: s.id,
      title: 'Action proche',
      assigneeId: reader.user.id,
      dueDate: due,
    });
    expect(a.statusCode, a.body).toBe(201);
    await runReminders(ctx.prisma);
    const count = () => ctx.prisma.notification.count({ where: { userId: reader.user.id, type: 'reminder' } });
    const first = await count();
    expect(first).toBeGreaterThan(0);
    await runReminders(ctx.prisma);
    expect(await count()).toBe(first);
  });

  it('comparaison et restauration de versions', async () => {
    const s = await newSystem();
    const v1 = (await req(gov, 'GET', `/ai-systems/${s.id}`)).json();
    const p = await req(gov, 'PATCH', `/ai-systems/${s.id}`, { version: v1.version, name: 'Nom modifié par erreur' });
    expect(p.statusCode).toBe(200);
    const versions = (await req(gov, 'GET', `/ai-systems/${s.id}/versions`)).json();
    const first = versions.items[versions.items.length - 1].version;
    const cmp = (
      await req(gov, 'GET', `/ai-systems/${s.id}/versions/compare?from=${first}&to=${versions.current}`)
    ).json();
    expect(cmp.changes.some((c: { field: string }) => c.field === 'name')).toBe(true);
    expect(
      (
        await req(reader.session, 'POST', `/ai-systems/${s.id}/versions/${first}/restore`, {
          reason: 'Erreur de saisie',
        })
      ).statusCode,
    ).toBe(403);
    const r = await req(gov, 'POST', `/ai-systems/${s.id}/versions/${first}/restore`, {
      reason: 'Erreur de saisie du nom',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().restoredFields).toContain('name');
    expect((await req(gov, 'GET', `/ai-systems/${s.id}`)).json().name).toBe(v1.name);
  });
});

describe('action de masse « Lancer une revue »', () => {
  it('crée une revue à l’échéance demandée sur chaque SIA, tout ou rien', async () => {
    const a = await newSystem();
    const b = await newSystem();
    const r = await req(gov, 'POST', '/ai-systems/bulk', {
      action: 'startReview',
      ids: [a.id, b.id],
      dueDate: '2027-03-31',
      reviewerId: reviewer.user.id,
    });
    expect(r.statusCode, r.body).toBe(200);
    for (const s of [a, b]) {
      const reviews = (await req(gov, 'GET', `/ai-systems/${s.id}/reviews`)).json();
      expect(reviews.items[0].dueDate).toBe('2027-03-31');
      expect(reviews.items[0].reviewer.id).toBe(reviewer.user.id);
    }
    const denied = await req(owner.session, 'POST', '/ai-systems/bulk', {
      action: 'startReview',
      ids: [a.id],
      dueDate: '2027-03-31',
    });
    expect(denied.statusCode).toBe(403);
  });
});
