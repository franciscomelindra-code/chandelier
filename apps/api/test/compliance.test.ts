import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let unit: { id: string };
let legal: Session;
let dpo: Session;
let gov: Session;
let owner: { user: { id: string }; session: Session };

const req = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });
const long = (s: string) => `${s} — description suffisamment détaillée pour la FRIA.`;

beforeAll(async () => {
  ctx = await setupApp();
  unit = await createOrgUnit(ctx.prisma);
  legal = (await loginAs(ctx, [{ role: 'LEGAL' }])).session;
  dpo = (await loginAs(ctx, [{ role: 'DPO' }])).session;
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE' }])).session;
  owner = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unit.id }]);
});
afterAll(async () => ctx.close());

async function newSystem() {
  const r = await req(gov, 'POST', '/ai-systems', {
    name: uniq('SIA conformité'),
    orgUnitId: unit.id,
    ownerId: owner.user.id,
    purpose: 'Aider les équipes à répondre aux questions des clients.',
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; reference: string };
}

describe('FRIA et DPIA', () => {
  it('rédaction, réutilisation de la DPIA, soumission contrôlée, validation à quatre yeux', async () => {
    const s = await newSystem();
    expect((await req(owner.session, 'POST', `/ai-systems/${s.id}/frias`)).statusCode).toBe(403);
    const created = await req(legal, 'POST', `/ai-systems/${s.id}/frias`);
    expect(created.statusCode, created.body).toBe(201);
    const fria = created.json();
    expect(fria.missingSections).toHaveLength(6);
    expect((await req(legal, 'POST', `/ai-systems/${s.id}/frias`)).statusCode).toBe(409);

    const badUrl = await req(legal, 'POST', `/ai-systems/${s.id}/dpias`, {
      title: 'AIPD',
      externalUrl: 'javascript:alert(1)',
    });
    expect(badUrl.statusCode).toBe(400);
    const dpia = await req(legal, 'POST', `/ai-systems/${s.id}/dpias`, {
      title: 'AIPD du traitement support client',
      status: 'VALIDATED',
      externalUrl: 'https://outil-rgpd.example.invalid/aipd/42',
      coveredTopics: ['affectedPersons', 'specificRisks'],
    });
    expect(dpia.statusCode, dpia.body).toBe(201);
    expect(dpia.json().reference).toMatch(/^DPIA-\d{4}$/);

    const notCovered = await req(legal, 'PATCH', `/frias/${fria.id}`, {
      dpiaId: dpia.json().id,
      coveredByDpia: ['mitigation'],
    });
    expect(notCovered.statusCode).toBe(400);
    const p = await req(legal, 'PATCH', `/frias/${fria.id}`, {
      dpiaId: dpia.json().id,
      coveredByDpia: ['affectedPersons', 'specificRisks'],
      sections: { process: long('Processus'), periodFrequency: long('Période') },
    });
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json().missingSections).toEqual(['humanOversight', 'mitigation']);
    expect((await req(legal, 'POST', `/frias/${fria.id}/submit`, {})).statusCode).toBe(400);
    await req(legal, 'PATCH', `/frias/${fria.id}`, {
      sections: { humanOversight: long('Contrôle'), mitigation: long('Mesures') },
      conclusion: long('Conclusion : risques maîtrisés'),
    });
    const submitted = await req(legal, 'POST', `/frias/${fria.id}/submit`, {});
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().status).toBe('IN_REVIEW');
    expect((await req(legal, 'PATCH', `/frias/${fria.id}`, { conclusion: 'x' })).statusCode).toBe(409);
    expect((await req(legal, 'POST', `/frias/${fria.id}/validate`, {})).statusCode).toBe(403);
    const validated = await req(dpo, 'POST', `/frias/${fria.id}/validate`, {});
    expect(validated.statusCode, validated.body).toBe(200);
    expect(validated.json().status).toBe('VALIDATED');

    // Un thème revendiqué par la FRIA ne peut pas être retiré de la DPIA.
    expect(
      (await req(legal, 'PATCH', `/dpias/${dpia.json().id}`, { coveredTopics: ['specificRisks'] })).statusCode,
    ).toBe(409);

    // Nouvelle version : reprise du contenu, la version validée reste consultable.
    const v2 = await req(legal, 'POST', `/ai-systems/${s.id}/frias`);
    expect(v2.statusCode).toBe(201);
    expect(v2.json().version).toBe(2);
    expect(v2.json().sections.process).toBe(long('Processus'));
  });
});

describe('notice de transparence', () => {
  it('génération depuis les données, marqueurs à compléter bloquants, validation, ajout aux pièces, export échappé', async () => {
    const s = await newSystem();
    const created = await req(gov, 'POST', `/ai-systems/${s.id}/notices`, {
      blocks: ['aiInteraction', 'humanContact'],
    });
    expect(created.statusCode, created.body).toBe(201);
    const n = created.json();
    expect(n.contentMarkdown).toContain('Aider les équipes à répondre aux questions des clients.');
    expect(n.contentMarkdown).toContain('Vous échangez avec un système d’IA');
    expect(n.placeholders).toBeGreaterThan(0);
    expect((await req(gov, 'POST', `/notices/${n.id}/submit`)).statusCode).toBe(400);

    const content =
      n.contentMarkdown.replace(/\[À compléter : [^\]]*\]/g, 'support-ia@example.invalid') +
      '\n\n<script>alert(1)</script>';
    expect((await req(gov, 'PATCH', `/notices/${n.id}`, { contentMarkdown: content })).statusCode).toBe(200);
    expect((await req(gov, 'POST', `/notices/${n.id}/submit`)).statusCode).toBe(200);
    expect((await req(gov, 'POST', `/notices/${n.id}/validate`)).statusCode).toBe(403);
    const v = await req(dpo, 'POST', `/notices/${n.id}/validate`);
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json().status).toBe('VALIDATED');
    expect(v.json().documentId).toBeTruthy();

    const docs = (await req(gov, 'GET', `/ai-systems/${s.id}/documents`)).json();
    const doc = docs.items.find((d: { id: string }) => d.id === v.json().documentId);
    expect(doc.type).toBe('TRANSPARENCY_NOTICE');
    const dl = await req(gov, 'GET', `/documents/${doc.id}/versions/1/download`);
    expect(dl.body).toBe(content);

    const html = await req(gov, 'GET', `/notices/${n.id}/export?format=html`);
    expect(html.headers['content-disposition']).toMatch(/^attachment/);
    expect(html.body).not.toContain('<script>alert(1)</script>');
    expect(html.body).toContain('&lt;script&gt;');

    // Une nouvelle version est possible après validation ; la précédente reste validée jusqu'à la suivante.
    expect((await req(gov, 'POST', `/ai-systems/${s.id}/notices`, {})).statusCode).toBe(201);
    const portfolio = (await req(gov, 'GET', '/compliance-portfolio')).json();
    const row = portfolio.items.find((i: { system: { id: string } }) => i.system.id === s.id);
    expect(row.notice.hasValidated).toBe(true);
  });
});
