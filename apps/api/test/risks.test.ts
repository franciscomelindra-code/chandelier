import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let unit: { id: string };
let other: { id: string };
let gov: Session;
let admin: Session;
let owner: { user: { id: string }; session: Session };
let reader: { user: { id: string }; session: Session };
let outsider: Session;
let sys: { id: string };
let sys2: { id: string };

const req = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });

beforeAll(async () => {
  ctx = await setupApp();
  unit = await createOrgUnit(ctx.prisma);
  other = await createOrgUnit(ctx.prisma);
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE' }])).session;
  admin = (await loginAs(ctx, [{ role: 'SUPER_ADMIN' }])).session;
  owner = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unit.id }]);
  reader = await loginAs(ctx, [{ role: 'READER', orgUnitId: unit.id }]);
  outsider = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE', orgUnitId: other.id }])).session;
  const s = await req(gov, 'POST', '/ai-systems', {
    name: uniq('SIA risques'),
    orgUnitId: unit.id,
    ownerId: owner.user.id,
  });
  expect(s.statusCode, s.body).toBe(201);
  sys = s.json();
  sys2 = (await req(gov, 'POST', '/ai-systems', { name: uniq('SIA autre'), orgUnitId: unit.id })).json();
});
afterAll(async () => ctx.close());

async function newRisk(s: Session = gov, body: Record<string, unknown> = {}) {
  const r = await req(s, 'POST', `/ai-systems/${sys.id}/risks`, {
    category: 'HALLUCINATION_ACCURACY',
    title: uniq('Réponse inexacte'),
    inherentLikelihood: 4,
    inherentSeverity: 3,
    ...body,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}

describe('registre des risques', () => {
  it('crée un risque coté : score, niveau, statut et référence calculés côté serveur', async () => {
    const r = await newRisk();
    expect(r.reference).toMatch(/^RSK-\d{4}$/);
    expect(r.inherentScore).toBe(12);
    expect(r.inherentLevel.level).toBe('CRITICAL');
    expect(r.status).toBe('ASSESSED');
    expect(r.warnings.map((w: { code: string }) => w.code)).toEqual(
      expect.arrayContaining(['NO_OWNER', 'TREATMENT_MISSING']),
    );
    const bad = await req(gov, 'POST', `/ai-systems/${sys.id}/risks`, {
      category: 'PRIVACY',
      title: 'Incomplet',
      inherentLikelihood: 2,
    });
    expect(bad.statusCode).toBe(400);
    const out = await req(gov, 'POST', `/ai-systems/${sys.id}/risks`, {
      category: 'PRIVACY',
      title: 'Hors échelle',
      inherentLikelihood: 5,
      inherentSeverity: 1,
    });
    expect(out.statusCode).toBe(400);
  });

  it('résiduel ≤ inhérent ; réduction sans mesure en place signalée puis justifiée par une mesure', async () => {
    const r = await newRisk();
    const up = await req(gov, 'PATCH', `/risks/${r.id}`, {
      version: r.version,
      residualLikelihood: 4,
      residualSeverity: 4,
    });
    expect(up.statusCode).toBe(400);
    const ok = await req(gov, 'PATCH', `/risks/${r.id}`, {
      version: r.version,
      residualLikelihood: 2,
      residualSeverity: 2,
      treatment: 'REDUCE',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const after = ok.json();
    expect(after.residualScore).toBe(4);
    expect(after.residualLevel.level).toBe('MODERATE');
    expect(after.status).toBe('IN_TREATMENT');
    expect(after.warnings.map((w: { code: string }) => w.code)).toContain('RESIDUAL_WITHOUT_MEASURE');

    const planned = await req(gov, 'POST', `/ai-systems/${sys.id}/measures`, {
      title: 'Relecture humaine des réponses',
      type: 'ORGANISATIONAL',
      riskId: r.id,
    });
    expect(planned.statusCode, planned.body).toBe(201);
    let detail = (await req(gov, 'GET', `/risks/${r.id}`)).json();
    expect(detail.measures).toHaveLength(1);
    expect(detail.warnings.map((w: { code: string }) => w.code)).toContain('RESIDUAL_WITHOUT_MEASURE');
    const done = await req(gov, 'PATCH', `/measures/${planned.json().id}`, { status: 'IMPLEMENTED' });
    expect(done.statusCode, done.body).toBe(200);
    detail = (await req(gov, 'GET', `/risks/${r.id}`)).json();
    expect(detail.measures[0].isExisting).toBe(true);
    expect(detail.warnings.map((w: { code: string }) => w.code)).not.toContain('RESIDUAL_WITHOUT_MEASURE');

    // Une mesure d'un autre SIA ne peut pas être rattachée.
    const foreign = await req(gov, 'POST', `/ai-systems/${sys2.id}/measures`, {
      title: 'Autre SIA',
      type: 'TECHNICAL',
    });
    const link = await req(gov, 'POST', `/risks/${r.id}/measures`, { measureId: foreign.json().id });
    expect(link.statusCode).toBe(400);
    const unlink = await req(gov, 'DELETE', `/risks/${r.id}/measures/${planned.json().id}`);
    expect(unlink.statusCode, unlink.body).toBe(200);
    expect(unlink.json().measures).toHaveLength(0);
  });

  it('verrou optimiste', async () => {
    const r = await newRisk();
    expect((await req(gov, 'PATCH', `/risks/${r.id}`, { version: r.version, title: 'Titre modifié' })).statusCode).toBe(
      200,
    );
    const stale = await req(gov, 'PATCH', `/risks/${r.id}`, { version: r.version, title: 'Conflit' });
    expect(stale.statusCode).toBe(409);
  });

  it('acceptation : justification obligatoire, niveau critique réservé aux rôles de validation, renouvelée si la cotation change', async () => {
    const r = await newRisk(owner.session);
    const short = await req(owner.session, 'PATCH', `/risks/${r.id}`, {
      version: r.version,
      treatment: 'ACCEPT',
      acceptanceJustification: 'trop court',
    });
    expect(short.statusCode).toBe(400);
    const notAllowed = await req(owner.session, 'PATCH', `/risks/${r.id}`, {
      version: r.version,
      treatment: 'ACCEPT',
      acceptanceJustification: 'Risque résiduel accepté par le métier au vu des bénéfices.',
    });
    expect(notAllowed.statusCode).toBe(403);
    const accepted = await req(gov, 'PATCH', `/risks/${r.id}`, {
      version: r.version,
      treatment: 'ACCEPT',
      acceptanceJustification: 'Risque accepté par le comité IA du 10/11/2026, revue trimestrielle.',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const a = accepted.json();
    expect(a.status).toBe('ACCEPTED');
    expect(a.acceptedBy).toBeTruthy();
    const rescored = await req(gov, 'PATCH', `/risks/${r.id}`, { version: a.version, inherentSeverity: 4 });
    expect(rescored.statusCode).toBe(400);
    const changed = await req(gov, 'PATCH', `/risks/${r.id}`, { version: a.version, treatment: 'REDUCE' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().status).toBe('IN_TREATMENT');
    expect(changed.json().acceptedAt).toBeNull();

    // Le propriétaire peut accepter un risque de niveau inférieur au plus élevé.
    const low = await newRisk(owner.session, { inherentLikelihood: 1, inherentSeverity: 2 });
    const ok = await req(owner.session, 'PATCH', `/risks/${low.id}`, {
      version: low.version,
      treatment: 'ACCEPT',
      acceptanceJustification: 'Risque faible, accepté par le propriétaire du SIA.',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const hist = (await req(gov, 'GET', `/risks/${r.id}/history`)).json();
    expect(hist.items.map((e: { action: string }) => e.action)).toContain('accept_risk');
  });

  it('clôture refusée tant qu’une action liée est ouverte', async () => {
    const r = await newRisk();
    const act = await req(gov, 'POST', '/actions', {
      aiSystemId: sys.id,
      title: 'Former les utilisateurs',
      riskId: r.id,
    });
    expect(act.statusCode, act.body).toBe(201);
    const close = await req(gov, 'PATCH', `/risks/${r.id}`, { version: r.version, status: 'CLOSED' });
    expect(close.statusCode).toBe(409);
    const a = act.json();
    expect((await req(gov, 'PATCH', `/actions/${a.id}`, { version: a.version, status: 'DONE' })).statusCode).toBe(200);
    const closed = await req(gov, 'PATCH', `/risks/${r.id}`, { version: r.version, status: 'CLOSED' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().warnings).toEqual([]);
  });

  it('contrôle d’accès : périmètre (404), lecture seule (403)', async () => {
    const r = await newRisk();
    expect((await req(outsider, 'GET', `/risks/${r.id}`)).statusCode).toBe(404);
    expect((await req(outsider, 'GET', `/ai-systems/${sys.id}/risks`)).statusCode).toBe(404);
    const list = (await req(outsider, 'GET', '/risks')).json();
    expect(list.items.some((x: { id: string }) => x.id === r.id)).toBe(false);
    expect((await req(reader.session, 'GET', `/risks/${r.id}`)).statusCode).toBe(200);
    expect(
      (await req(reader.session, 'POST', `/ai-systems/${sys.id}/risks`, { category: 'PRIVACY', title: 'Interdit' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await req(reader.session, 'PATCH', `/risks/${r.id}`, { version: r.version, title: 'Non' })).statusCode,
    ).toBe(403);
  });

  it('portefeuille : filtres par niveau et par cellule de la carte de chaleur', async () => {
    const res = await req(gov, 'GET', `/risks?aiSystemId=${sys.id}&level=CRITICAL`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((r: { effectiveLevel: { level: string } }) => r.effectiveLevel.level === 'CRITICAL')).toBe(
      true,
    );
    expect(body.heatmap.cells['4-3']).toBeGreaterThan(0);
    const cell = (await req(gov, 'GET', `/risks?aiSystemId=${sys.id}&cell=4-3`)).json();
    expect(cell.items.length).toBe(body.heatmap.cells['4-3']);
  });
});

describe('plans d’action', () => {
  it('liens limités au même SIA, annulation motivée, responsable limité au statut', async () => {
    const r = await newRisk();
    const cross = await req(gov, 'POST', '/actions', { aiSystemId: sys2.id, title: 'Lien croisé', riskId: r.id });
    expect(cross.statusCode).toBe(400);
    const created = await req(gov, 'POST', '/actions', {
      aiSystemId: sys.id,
      title: 'Mettre à jour la notice',
      assigneeId: reader.user.id,
      dueDate: '2020-01-01',
      priority: 'HIGH',
    });
    expect(created.statusCode, created.body).toBe(201);
    const a = created.json();
    expect(a.reference).toMatch(/^ACT-\d{4}$/);
    expect(a.overdue).toBe(true);

    const mine = (await req(reader.session, 'GET', '/actions?mine=true')).json();
    expect(mine.items.map((x: { id: string }) => x.id)).toContain(a.id);
    const overdue = (await req(gov, 'GET', `/actions?overdue=true&aiSystemId=${sys.id}`)).json();
    expect(overdue.items.map((x: { id: string }) => x.id)).toContain(a.id);

    const rename = await req(reader.session, 'PATCH', `/actions/${a.id}`, { version: a.version, title: 'Non' });
    expect(rename.statusCode).toBe(403);
    const progress = await req(reader.session, 'PATCH', `/actions/${a.id}`, {
      version: a.version,
      status: 'IN_PROGRESS',
    });
    expect(progress.statusCode, progress.body).toBe(200);
    const p = progress.json();
    const cancel = await req(gov, 'PATCH', `/actions/${a.id}`, { version: p.version, status: 'CANCELLED' });
    expect(cancel.statusCode).toBe(400);
    const cancelled = await req(gov, 'PATCH', `/actions/${a.id}`, {
      version: p.version,
      status: 'CANCELLED',
      closureComment: 'Remplacée par une action du plan RGPD',
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().overdue).toBe(false);
    expect((await req(outsider, 'GET', `/actions/${a.id}`)).statusCode).toBe(404);
  });
});

describe('méthodologie paramétrable', () => {
  it('administrateur uniquement, configuration validée, nouvelle version → risques existants à recoter', async () => {
    const r = await newRisk();
    const cfg = {
      likelihood: [1, 2, 3].map((value) => ({ value, label: `V${value}` })),
      severity: [1, 2, 3].map((value) => ({ value, label: `G${value}` })),
      thresholds: [
        { min: 1, level: 'LOW', label: 'Faible', tone: 'green' },
        { min: 3, level: 'MEDIUM', label: 'Moyen', tone: 'orange' },
        { min: 6, level: 'HIGH', label: 'Élevé', tone: 'red' },
      ],
    };
    expect((await req(gov, 'POST', '/risk-methodologies', { name: 'Méthode 3×3', config: cfg })).statusCode).toBe(403);
    const invalid = await req(admin, 'POST', '/risk-methodologies', {
      name: 'Méthode 3×3',
      config: { ...cfg, thresholds: [{ ...cfg.thresholds[0], min: 2 }, cfg.thresholds[1]] },
    });
    expect(invalid.statusCode).toBe(400);
    const created = await req(admin, 'POST', '/risk-methodologies', { name: 'Méthode 3×3', config: cfg });
    expect(created.statusCode, created.body).toBe(201);
    const m = created.json();
    expect(m.isActive).toBe(false);
    const previous = (await req(gov, 'GET', '/risk-methodologies'))
      .json()
      .items.find((x: { isActive: boolean }) => x.isActive);

    const act = await req(admin, 'POST', `/risk-methodologies/${m.id}/activate`, {
      justification: 'Décision comité IA',
    });
    expect(act.statusCode, act.body).toBe(200);
    try {
      const stale = (await req(gov, 'GET', `/risks/${r.id}`)).json();
      expect(stale.warnings.map((w: { code: string }) => w.code)).toContain('REPLACED_METHODOLOGY');
      expect(
        (await req(gov, 'PATCH', `/risks/${r.id}`, { version: stale.version, inherentSeverity: 2 })).statusCode,
      ).toBe(409);
      const outOfScale = await req(gov, 'POST', `/risks/${r.id}/rescore`, {
        version: stale.version,
        inherentLikelihood: 4,
        inherentSeverity: 3,
        justification: 'Passage à la méthode 3×3',
      });
      expect(outOfScale.statusCode).toBe(400);
      const rescored = await req(gov, 'POST', `/risks/${r.id}/rescore`, {
        version: stale.version,
        inherentLikelihood: 3,
        inherentSeverity: 2,
        justification: 'Passage à la méthode 3×3',
      });
      expect(rescored.statusCode, rescored.body).toBe(200);
      expect(rescored.json().methodology.id).toBe(m.id);
      expect(rescored.json().inherentLevel.level).toBe('HIGH');
      // Une version utilisée n'est plus modifiable.
      expect((await req(admin, 'PATCH', `/risk-methodologies/${m.id}`, { config: cfg })).statusCode).toBe(409);
    } finally {
      await req(admin, 'POST', `/risk-methodologies/${previous.id}/activate`, {
        justification: 'Retour méthode par défaut',
      });
    }
  });
});
