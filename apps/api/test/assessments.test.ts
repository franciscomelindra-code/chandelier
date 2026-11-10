import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';
import { importFrameworks } from '../src/referentials/loader.js';

let ctx: TestCtx;
let unit: { id: string };
let gov: Session;
let legal: Session;

beforeAll(async () => {
  ctx = await setupApp();
  unit = await createOrgUnit(ctx.prisma);
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE' }])).session;
  legal = (await loginAs(ctx, [{ role: 'LEGAL' }])).session;
});
afterAll(async () => ctx.close());

const req = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });

const MINIMAL = {
  C_PERSONAL_DATA: 'NO',
  C_WORKPLACE: 'NO',
  D_MACHINE: 'YES',
  D_INFERENCE: 'YES',
  D_AUTONOMY: 'YES',
  D_INFLUENCE: 'YES',
  X_MILITARY: 'NO',
  X_RESEARCH: 'NO',
  X_PRE_MARKET: 'NO',
  R_DEVELOPS: 'NO',
  R_USES: 'YES',
  R_IMPORTS: 'NO',
  R_DISTRIBUTES: 'NO',
  R_REBRAND: 'NO',
  R_SUBST_MOD: 'NO',
  R_PURPOSE_CHANGE: 'NO',
  P_MANIPULATION: 'NO',
  P_VULNERABILITY: 'NO',
  P_SOCIAL_SCORING: 'NO',
  P_CRIME_PREDICTION: 'NO',
  P_FACE_SCRAPING: 'NO',
  P_EMOTION_WORK_EDU: 'NO',
  P_BIOMETRIC_CATEG: 'NO',
  P_RT_RBI_LE: 'NO',
  H_ANNEX_I: 'NO',
  H_ANNEX_III: ['NONE'],
  T_INTERACTS: 'NO',
  T_SYNTHETIC: 'NO',
  T_EMOTION_BIOMETRIC: 'NO',
  T_DEEPFAKE: 'NO',
  T_PUBLIC_TEXT: 'NO',
  G_USES_GPAI: 'NO',
  G_PROVIDES_GPAI: 'NO',
};
const EMPLOYMENT = {
  ...MINIMAL,
  H_ANNEX_III: ['EMPLOYMENT'],
  H_EMPLOYMENT_USE: 'YES',
  H_PROFILING: 'NO',
  H_DEROGATION: 'NO',
  F_PUBLIC_SERVICE: 'NO',
};

async function systemWithDraft(s: Session = gov) {
  const sys = (await req(s, 'POST', '/api/v1/ai-systems', { name: uniq('SIA qualif'), orgUnitId: unit.id })).json();
  const a = await req(s, 'POST', `/api/v1/ai-systems/${sys.id}/assessments`);
  expect(a.statusCode, a.body).toBe(201);
  return { sys, a: a.json() };
}
async function complete(s: Session, sysId: string, aId: string, answers: Record<string, unknown>) {
  const p = await req(s, 'PATCH', `/api/v1/ai-systems/${sysId}/assessments/${aId}`, { answers });
  expect(p.statusCode, p.body).toBe(200);
  const c = await req(s, 'POST', `/api/v1/ai-systems/${sysId}/assessments/${aId}/complete`);
  expect(c.statusCode, c.body).toBe(200);
  return c.json();
}

describe('référentiel réglementaire', () => {
  it('est importé une seule fois, versionné, avec empreinte ; réimport idempotent', async () => {
    const list = (await req(gov, 'GET', '/api/v1/regulatory-frameworks')).json().items;
    const active = list.filter((f: { key: string; status: string }) => f.key === 'EU_AI_ACT' && f.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe('1.0.0');
    expect(active[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect((await importFrameworks(ctx.prisma)).imported).toEqual([]);
  });

  it('refuse un référentiel modifié sans changement de version', async () => {
    const f = await ctx.prisma.regulatoryFramework.findFirstOrThrow({ where: { key: 'EU_AI_ACT', version: '1.0.0' } });
    await ctx.prisma.regulatoryFramework.update({ where: { id: f.id }, data: { checksum: 'falsifie' } });
    await expect(importFrameworks(ctx.prisma)).rejects.toThrow(/sans changement de version/);
    await ctx.prisma.regulatoryFramework.update({ where: { id: f.id }, data: { checksum: f.checksum } });
  });
});

describe('qualification', () => {
  it('brouillon unique, aperçu calculé, puis résultat enregistré avec version, auteur, règles et obligations', async () => {
    const { sys, a } = await systemWithDraft();
    expect(a.status).toBe('DRAFT');
    expect(a.framework.version).toBe('1.0.0');
    expect(a.preview.displayCategory).toBe('UNDETERMINED');
    expect((await req(gov, 'POST', `/api/v1/ai-systems/${sys.id}/assessments`)).statusCode).toBe(409);

    const done = await complete(gov, sys.id, a.id, EMPLOYMENT);
    expect(done.status).toBe('COMPLETED');
    expect(done.computedCategory).toBe('HIGH');
    expect(done.computedBy).toBeTruthy();
    expect(done.computedResult.frameworkVersion).toBe('1.0.0');
    expect(done.computedResult.dimensions.highRisk.rules[0].ruleId).toBe('HR-ANNEX-III-4');
    expect(done.computedResult.dimensions.highRisk.rules[0].answers).toMatchObject({ H_EMPLOYMENT_USE: 'YES' });

    const s = (await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}`)).json();
    expect(s.riskCategory).toBe('HIGH');
    expect(s.riskJustification).toMatch(/haut risque/);
    const obl = (await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}/obligations`)).json();
    expect(obl.items.map((o: { templateKey: string }) => o.templateKey)).toEqual(
      expect.arrayContaining(['AIA-OBL-DEP-OVERSIGHT', 'AIA-OBL-LITERACY']),
    );
    expect(obl.items.every((o: { frameworkVersion: string }) => o.frameworkVersion === '1.0.0')).toBe(true);
    expect(obl.complianceStatus).toBe('PARTIAL');
    expect(
      (await req(gov, 'PATCH', `/api/v1/ai-systems/${sys.id}/assessments/${a.id}`, { answers: { D_MACHINE: 'NO' } }))
        .statusCode,
    ).toBe(409);
  });

  it('valide les réponses (question inconnue, valeur, « Aucun » exclusif)', async () => {
    const { sys, a } = await systemWithDraft();
    const url = `/api/v1/ai-systems/${sys.id}/assessments/${a.id}`;
    expect((await req(gov, 'PATCH', url, { answers: { INCONNUE: 'YES' } })).statusCode).toBe(400);
    expect((await req(gov, 'PATCH', url, { answers: { D_MACHINE: 'PEUT-ETRE' } })).statusCode).toBe(400);
    expect((await req(gov, 'PATCH', url, { answers: { H_ANNEX_III: ['NONE', 'EMPLOYMENT'] } })).statusCode).toBe(400);
  });

  it('propose des réponses depuis la fiche sans les appliquer', async () => {
    const sys = (await req(gov, 'POST', '/api/v1/ai-systems', { name: uniq('Prérempli'), orgUnitId: unit.id })).json();
    await req(gov, 'PATCH', `/api/v1/ai-systems/${sys.id}`, {
      version: 1,
      aiActRoles: ['DEPLOYER'],
      processesPersonalData: 'YES',
    });
    const a = (await req(gov, 'POST', `/api/v1/ai-systems/${sys.id}/assessments`)).json();
    expect(a.suggestions).toMatchObject({ R_USES: { value: 'YES' }, C_PERSONAL_DATA: { value: 'YES' } });
    expect(a.answers).toEqual({});
  });

  it('réévaluation : reprend les réponses, remplace l’évaluation précédente, obligations idempotentes', async () => {
    const { sys, a } = await systemWithDraft();
    await complete(gov, sys.id, a.id, EMPLOYMENT);
    const obl1 = (await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}/obligations`)).json().items;
    const target = obl1.find((o: { templateKey: string }) => o.templateKey === 'AIA-OBL-DEP-LOGS');
    await req(gov, 'PATCH', `/api/v1/obligations/${target.id}`, {
      status: 'IN_PROGRESS',
      comment: 'Rétention configurée',
    });

    const b = (await req(gov, 'POST', `/api/v1/ai-systems/${sys.id}/assessments`)).json();
    expect(b.answers).toMatchObject({ H_EMPLOYMENT_USE: 'YES' });
    await complete(gov, sys.id, b.id, { H_EMPLOYMENT_USE: 'NO' });
    const list = (await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}/assessments`)).json().items;
    expect(list.map((x: { status: string }) => x.status)).toEqual(['COMPLETED', 'SUPERSEDED']);
    const obl2 = (await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}/obligations`)).json().items;
    const logs = obl2.find((o: { templateKey: string }) => o.templateKey === 'AIA-OBL-DEP-LOGS');
    expect(logs.status).toBe('IN_PROGRESS');
    expect(logs.applicability).toBe('TO_CONFIRM');
    expect(logs.comment).toMatch(/Rétention configurée[\s\S]*non déclenchée/);
    expect(obl2).toHaveLength(obl1.length);
    expect((await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}`)).json().riskCategory).toBe('MINIMAL');
  });

  it('refuse la qualification aux rôles sans droit et au propriétaire d’un autre SIA', async () => {
    const { sys } = await systemWithDraft();
    const { session: reader } = await loginAs(ctx, [{ role: 'READER' }]);
    expect((await req(reader, 'POST', `/api/v1/ai-systems/${sys.id}/assessments`)).statusCode).toBe(403);
    const { session: owner } = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unit.id }]);
    const other = (await req(gov, 'POST', '/api/v1/ai-systems', { name: uniq('Autre'), orgUnitId: unit.id })).json();
    expect((await req(owner, 'POST', `/api/v1/ai-systems/${other.id}/assessments`)).statusCode).toBe(403);
    const mine = (await req(owner, 'POST', '/api/v1/ai-systems', { name: uniq('Mien'), orgUnitId: unit.id })).json();
    expect((await req(owner, 'POST', `/api/v1/ai-systems/${mine.id}/assessments`)).statusCode).toBe(201);
  });
});

describe('surcharge juridique et validation', () => {
  it('surcharge réservée au juridique, justification obligatoire, historisée et immuable', async () => {
    const { sys, a } = await systemWithDraft();
    await complete(gov, sys.id, a.id, EMPLOYMENT);
    const url = `/api/v1/ai-systems/${sys.id}/assessments/${a.id}/overrides`;
    const body = {
      dimension: 'highRisk',
      value: 'NOT_HIGH_RISK_DEROGATION',
      justification: 'Analyse juridique : tâche préparatoire documentée',
    };
    expect((await req(gov, 'POST', url, body)).statusCode).toBe(403);
    expect((await req(legal, 'POST', url, { ...body, justification: 'trop court' })).statusCode).toBe(400);
    expect((await req(legal, 'POST', url, { ...body, value: 'INVENTE' })).statusCode).toBe(400);
    const ok = await req(legal, 'POST', url, body);
    expect(ok.statusCode, ok.body).toBe(200);
    const d = ok.json();
    expect(d.computedCategory).toBe('HIGH');
    expect(d.effectiveCategory).toBe('MINIMAL');
    expect(d.computedResult.dimensions.highRisk.value).toBe('HIGH_RISK');
    expect(d.effectiveResult.dimensions.highRisk.value).toBe('NOT_HIGH_RISK_DEROGATION');
    expect(d.overrides[0]).toMatchObject({
      dimension: 'highRisk',
      previousValue: 'HIGH_RISK',
      newValue: 'NOT_HIGH_RISK_DEROGATION',
    });
    expect((await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}`)).json().riskCategory).toBe('MINIMAL');
    const ev = await ctx.prisma.auditEvent.findFirst({ where: { entityId: a.id, action: 'override' } });
    expect(ev?.justification).toBe(body.justification);
    const o = await ctx.prisma.assessmentOverride.findFirstOrThrow({ where: { assessmentId: a.id } });
    await expect(
      ctx.prisma.assessmentOverride.update({ where: { id: o.id }, data: { justification: 'x' } }),
    ).rejects.toThrow(/immuable/);
  });

  it('validation : quatre yeux, et toute surcharge ultérieure invalide la validation', async () => {
    const { sys, a } = await systemWithDraft(legal);
    await complete(legal, sys.id, a.id, MINIMAL);
    const vurl = `/api/v1/ai-systems/${sys.id}/assessments/${a.id}/validate`;
    expect((await req(legal, 'POST', vurl, {})).statusCode).toBe(403);
    const v = await req(gov, 'POST', vurl, { comment: 'Relu' });
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json().status).toBe('VALIDATED');
    const o = await req(legal, 'POST', `/api/v1/ai-systems/${sys.id}/assessments/${a.id}/overrides`, {
      dimension: 'displayCategory',
      value: 'UNDETERMINED',
      justification: 'Doute sur la finalité réelle : instruction complémentaire',
    });
    expect(o.json().status).toBe('COMPLETED');
    expect(o.json().validatedAt).toBeNull();
  });
});

describe('obligations', () => {
  it('mise à jour journalisée, justification exigée pour « non applicable », statut de conformité dérivé', async () => {
    const { sys, a } = await systemWithDraft();
    await complete(gov, sys.id, a.id, MINIMAL);
    const [lit] = (await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}/obligations`)).json().items;
    expect(lit.templateKey).toBe('AIA-OBL-LITERACY');
    expect((await req(gov, 'PATCH', `/api/v1/obligations/${lit.id}`, { status: 'NOT_APPLICABLE' })).statusCode).toBe(
      400,
    );
    const ok = await req(gov, 'PATCH', `/api/v1/obligations/${lit.id}`, { status: 'COMPLIANT' });
    expect(ok.json().validatedAt).toBeTruthy();
    const list = (await req(gov, 'GET', `/api/v1/ai-systems/${sys.id}/obligations`)).json();
    expect(list.complianceStatus).toBe('COMPLIANT');
    const { session: reader } = await loginAs(ctx, [{ role: 'READER' }]);
    expect((await req(reader, 'PATCH', `/api/v1/obligations/${lit.id}`, { status: 'IN_PROGRESS' })).statusCode).toBe(
      403,
    );
    expect(await ctx.prisma.auditEvent.count({ where: { entityId: lit.id, action: 'update_obligation' } })).toBe(1);
  });

  it('portefeuille : état de qualification de chaque SIA du périmètre', async () => {
    const { sys } = await systemWithDraft();
    const items = (await req(gov, 'GET', '/api/v1/assessments?status=DRAFT')).json().items;
    expect(items.map((i: { system: { id: string } }) => i.system.id)).toContain(sys.id);
  });
});
