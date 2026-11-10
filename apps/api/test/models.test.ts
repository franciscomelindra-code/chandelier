import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let unitA: { id: string };
let unitB: { id: string };
let gov: Session;

beforeAll(async () => {
  ctx = await setupApp();
  unitA = await createOrgUnit(ctx.prisma);
  unitB = await createOrgUnit(ctx.prisma);
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE' }])).session;
});
afterAll(async () => ctx.close());

const req = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });

async function system(orgUnitId = unitA.id) {
  const r = await req(gov, 'POST', '/api/v1/ai-systems', { name: uniq('SIA modèle'), orgUnitId });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
async function vendor() {
  const r = await req(gov, 'POST', '/api/v1/vendors', { name: uniq('Éditeur fictif'), country: 'fr' });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
async function model(vendorId: string | null = null, extra: Record<string, unknown> = {}) {
  const r = await req(gov, 'POST', '/api/v1/ai-models', {
    name: uniq('Modèle fictif'),
    version: '1.0',
    type: 'LLM',
    accessMode: 'API',
    vendorId,
    regions: ['UE'],
    ...extra,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}

describe('référentiel des modèles et fournisseurs', () => {
  it('crée fournisseur et modèle, valide les champs, refuse les doublons', async () => {
    const v = await vendor();
    expect(v.country).toBe('FR');
    const m = await model(v.id, {
      isGpai: 'YES',
      knowledgeDate: '2025-01-31',
      documentationUrl: 'https://exemple.invalid/doc',
    });
    expect(m.vendor.name).toBe(v.name);
    expect(m.knowledgeDate).toBe('2025-01-31');
    const dup = await req(gov, 'POST', '/api/v1/ai-models', {
      name: m.name,
      version: '1.0',
      type: 'LLM',
      accessMode: 'API',
      vendorId: v.id,
    });
    expect(dup.statusCode).toBe(409);
    const badUrl = await req(gov, 'POST', '/api/v1/ai-models', {
      name: 'X url',
      type: 'LLM',
      accessMode: 'API',
      documentationUrl: 'javascript:alert(1)',
    });
    expect(badUrl.statusCode).toBe(400);
    const unknownVendor = await req(gov, 'POST', '/api/v1/ai-models', {
      name: 'X v',
      type: 'LLM',
      accessMode: 'API',
      vendorId: crypto.randomUUID(),
    });
    expect(unknownVendor.statusCode).toBe(400);
    const { session: reader } = await loginAs(ctx, [{ role: 'READER' }]);
    expect((await req(reader, 'POST', '/api/v1/vendors', { name: 'Interdit' })).statusCode).toBe(403);
  });

  it('lie un modèle à deux SIA avec deux descriptions d’usage distinctes (critère F-011)', async () => {
    const m = await model();
    const s1 = await system();
    const s2 = await system();
    const l1 = await req(gov, 'POST', `/api/v1/ai-systems/${s1.id}/models`, {
      aiModelId: m.id,
      usageDescription: 'Résumé de documents internes',
    });
    const l2 = await req(gov, 'POST', `/api/v1/ai-systems/${s2.id}/models`, {
      aiModelId: m.id,
      usageDescription: 'Classification de demandes entrantes',
      versionUsed: '1.1',
    });
    expect(l1.statusCode, l1.body).toBe(200);
    expect(l2.statusCode, l2.body).toBe(200);
    const detail = (await req(gov, 'GET', `/api/v1/ai-models/${m.id}`)).json();
    expect(detail.systems.map((x: { usageDescription: string }) => x.usageDescription).sort()).toEqual([
      'Classification de demandes entrantes',
      'Résumé de documents internes',
    ]);
    expect(detail.usage).toBe(2);
    // SIA → modèles : la relation inverse expose la même description.
    expect(l1.json().modelLinks[0].usageDescription).toBe('Résumé de documents internes');
    expect(l1.json().completenessChecks.find((c: { key: string }) => c.key === 'models').ok).toBe(true);
  });

  it('exige une description d’usage et refuse un doublon de version', async () => {
    const m = await model();
    const s = await system();
    expect(
      (await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/models`, { aiModelId: m.id, usageDescription: 'court' }))
        .statusCode,
    ).toBe(400);
    const ok = { aiModelId: m.id, usageDescription: 'Génération de brouillons de réponses' };
    expect((await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/models`, ok)).statusCode).toBe(200);
    expect((await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/models`, ok)).statusCode).toBe(409);
  });

  it('garantit un seul modèle principal par SIA et journalise les changements', async () => {
    const [m1, m2] = [await model(), await model()];
    const s = await system();
    await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/models`, {
      aiModelId: m1.id,
      usageDescription: 'Modèle principal initial',
      isPrimary: true,
    });
    const r = await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/models`, {
      aiModelId: m2.id,
      usageDescription: 'Nouveau modèle principal',
      isPrimary: true,
    });
    const links = r.json().modelLinks as { isPrimary: boolean; model: { id: string } }[];
    expect(links.filter((l) => l.isPrimary).map((l) => l.model.id)).toEqual([m2.id]);
    const linkId = (r.json().modelLinks as { id: string; model: { id: string } }[]).find(
      (l) => l.model.id === m1.id,
    )!.id;
    const upd = await req(gov, 'PATCH', `/api/v1/ai-systems/${s.id}/models/${linkId}`, {
      usageDescription: 'Usage secondaire de repli',
    });
    expect(upd.statusCode).toBe(200);
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { aiSystemId: s.id, action: 'update_model_link' } });
    expect(Object.values(audit?.changes as object)[0]).toMatchObject({ new: 'Usage secondaire de repli' });
    expect((await req(gov, 'DELETE', `/api/v1/ai-systems/${s.id}/models/${linkId}`)).statusCode).toBe(200);
  });

  it('bloque la suppression d’un modèle ou d’un fournisseur utilisé', async () => {
    const v = await vendor();
    const m = await model(v.id);
    const s = await system();
    await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/models`, {
      aiModelId: m.id,
      usageDescription: 'Usage pour test de suppression',
    });
    expect((await req(gov, 'DELETE', `/api/v1/ai-models/${m.id}`)).statusCode).toBe(409);
    expect((await req(gov, 'DELETE', `/api/v1/vendors/${v.id}`)).statusCode).toBe(409);
  });

  it('limite la fiche modèle aux SIA du périmètre', async () => {
    const m = await model();
    const sA = await system(unitA.id);
    const sB = await system(unitB.id);
    for (const s of [sA, sB]) {
      await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/models`, {
        aiModelId: m.id,
        usageDescription: 'Usage dans une unité donnée',
      });
    }
    const { session } = await loginAs(ctx, [{ role: 'READER', orgUnitId: unitA.id }]);
    const d = (await req(session, 'GET', `/api/v1/ai-models/${m.id}`)).json();
    expect(d.systems.map((x: { system: { id: string } }) => x.system.id)).toEqual([sA.id]);
    expect(d.hiddenSystems).toBe(1);
  });

  it('filtre le registre par modèle et par fournisseur (déclaré ou via un modèle)', async () => {
    const v = await vendor();
    const m = await model(v.id);
    const viaModel = await system();
    const declared = await system();
    await req(gov, 'POST', `/api/v1/ai-systems/${viaModel.id}/models`, {
      aiModelId: m.id,
      usageDescription: 'Usage pour filtrage du registre',
    });
    const r = await req(gov, 'POST', `/api/v1/ai-systems/${declared.id}/vendors`, {
      vendorId: v.id,
      relation: 'INTEGRATOR',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().vendorLinks[0].relation).toBe('INTEGRATOR');
    const byModel = (await req(gov, 'GET', `/api/v1/ai-systems?modelId=${m.id}`)).json();
    expect(byModel.items.map((i: { id: string }) => i.id)).toEqual([viaModel.id]);
    const byVendor = (await req(gov, 'GET', `/api/v1/ai-systems?vendorId=${v.id}&pageSize=50`)).json();
    expect(byVendor.items.map((i: { id: string }) => i.id).sort()).toEqual([viaModel.id, declared.id].sort());
    expect(byModel.items[0].vendors).toContain(v.name);
  });

  it('applique les droits de section : un contributeur sans affectation ne lie pas de modèle', async () => {
    const m = await model();
    const s = await system();
    const { session } = await loginAs(ctx, [{ role: 'CONTRIBUTOR', orgUnitId: unitA.id }]);
    expect(
      (
        await req(session, 'POST', `/api/v1/ai-systems/${s.id}/models`, {
          aiModelId: m.id,
          usageDescription: 'Tentative non autorisée',
        })
      ).statusCode,
    ).toBe(403);
  });
});
