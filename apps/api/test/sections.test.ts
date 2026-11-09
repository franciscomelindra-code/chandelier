import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let unit: { id: string };
let gov: Session;

beforeAll(async () => {
  ctx = await setupApp();
  unit = await createOrgUnit(ctx.prisma);
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE' }])).session;
});
afterAll(async () => ctx.close());

const req = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });

async function newSystem(s: Session = gov, extra: Record<string, unknown> = {}) {
  const res = await req(s, 'POST', '/api/v1/ai-systems', { name: uniq('Fiche'), orgUnitId: unit.id, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('référentiels', () => {
  it('CRUD journalisé, écriture réservée à catalog:manage, suppression bloquée si rattaché', async () => {
    const created = await req(gov, 'POST', '/api/v1/assets', { name: 'Serveur fictif', type: 'SERVER' });
    expect(created.statusCode).toBe(201);
    const assetId = created.json().id;
    const { session: reader } = await loginAs(ctx, [{ role: 'READER' }]);
    expect((await req(reader, 'POST', '/api/v1/assets', { name: 'Interdit', type: 'API' })).statusCode).toBe(403);
    expect(
      (await req(reader, 'GET', '/api/v1/assets?q=fictif')).json().items.some((a: { id: string }) => a.id === assetId),
    ).toBe(true);

    const s = await newSystem();
    expect(
      (await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/assets`, { assetId, dependency: 'Hébergement' })).statusCode,
    ).toBe(200);
    expect((await req(gov, 'DELETE', `/api/v1/assets/${assetId}`)).statusCode).toBe(409);
    expect((await req(gov, 'DELETE', `/api/v1/ai-systems/${s.id}/assets/${assetId}`)).statusCode).toBe(200);
    expect((await req(gov, 'DELETE', `/api/v1/assets/${assetId}`)).statusCode).toBe(204);
    const actions = (await ctx.prisma.auditEvent.findMany({ where: { entityId: assetId } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'delete']));
  });

  it('gère les traitements RGPD avec leurs catégories', async () => {
    const cats = (await req(gov, 'GET', '/api/v1/data-categories')).json().items;
    const subs = (await req(gov, 'GET', '/api/v1/data-subject-categories')).json().items;
    const res = await req(gov, 'POST', '/api/v1/processing-activities', {
      reference: uniq('TRT'),
      name: 'Traitement fictif',
      dataCategoryIds: [cats[0].id],
      dataSubjectIds: [subs[0].id],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().dataCategoryIds).toEqual([cats[0].id]);
    const upd = await req(gov, 'PATCH', `/api/v1/processing-activities/${res.json().id}`, { dataSubjectIds: [] });
    expect(upd.json().dataSubjectIds).toEqual([]);
  });
});

describe('fiche en 12 étapes — sections relationnelles', () => {
  it('rattache parties prenantes, actifs, traitements, données, personnes ; version, complétude et historique suivent', async () => {
    const s = await newSystem();
    const st = (
      await req(gov, 'POST', '/api/v1/stakeholders', { kind: 'INTERNAL', name: 'Équipe juridique (fictive)' })
    ).json();
    const asset = (await req(gov, 'POST', '/api/v1/assets', { name: uniq('App'), type: 'APPLICATION' })).json();
    const ds = (
      await req(gov, 'POST', '/api/v1/datasets', {
        name: uniq('Corpus'),
        origin: 'INTERNAL',
        containsPersonalData: 'YES',
      })
    ).json();
    const trt = (
      await req(gov, 'POST', '/api/v1/processing-activities', { reference: uniq('T'), name: 'Traitement lié' })
    ).json();
    const cats = (await req(gov, 'GET', '/api/v1/data-categories')).json().items;
    const subs = (await req(gov, 'GET', '/api/v1/data-subject-categories')).json().items;

    await req(gov, 'PATCH', `/api/v1/ai-systems/${s.id}`, { version: 1, processesPersonalData: 'YES' });
    const steps = [
      req(gov, 'POST', `/api/v1/ai-systems/${s.id}/stakeholders`, {
        stakeholderId: st.id,
        function: 'DPO_LEGAL',
        raci: 'CONSULTED',
      }),
    ];
    let last = await steps[0]!;
    expect(last.statusCode, last.body).toBe(200);
    for (const [url, method, body] of [
      ['assets', 'POST', { assetId: asset.id }],
      ['processing', 'POST', { processingActivityId: trt.id }],
      ['datasets', 'POST', { datasetId: ds.id, usages: ['RAG', 'INFERENCE'] }],
      ['data-categories', 'PUT', { ids: [cats[0].id] }],
      [
        'data-subjects',
        'PUT',
        { items: [{ dataSubjectId: subs[0].id, volumeEstimate: '~100', consequences: 'Faibles' }] },
      ],
    ] as const) {
      last = await req(gov, method, `/api/v1/ai-systems/${s.id}/${url}`, body);
      expect(last.statusCode, `${url} ${last.body}`).toBe(200);
    }
    const d = last.json();
    expect(d.version).toBe(8);
    expect(d.stakeholders[0].function).toBe('DPO_LEGAL');
    expect(d.datasets[0].usages).toEqual(['RAG', 'INFERENCE']);
    expect(d.dataSubjects[0].volumeEstimate).toBe('~100');
    const checks = Object.fromEntries(d.completenessChecks.map((c: { key: string; ok: boolean }) => [c.key, c.ok]));
    expect(checks).toMatchObject({
      dpoLegal: true,
      assets: true,
      processing: true,
      datasets: true,
      dataCategories: true,
      dataSubjects: true,
    });

    const snap = await ctx.prisma.entityVersion.findFirstOrThrow({ where: { entityId: s.id, version: 8 } });
    expect((snap.snapshot as { dataSubjects: unknown[] }).dataSubjects).toHaveLength(1);
    const history = (await req(gov, 'GET', `/api/v1/ai-systems/${s.id}/history?pageSize=50`)).json();
    expect(history.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        'link_stakeholder',
        'link_asset',
        'link_processing',
        'link_dataset',
        'set_data_categories',
        'set_data_subjects',
      ]),
    );
  });

  it('refuse un usage de dataset vide et une partie prenante en double', async () => {
    const s = await newSystem();
    const ds = (await req(gov, 'POST', '/api/v1/datasets', { name: uniq('D'), origin: 'PUBLIC' })).json();
    expect(
      (await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/datasets`, { datasetId: ds.id, usages: [] })).statusCode,
    ).toBe(400);
    const st = (
      await req(gov, 'POST', '/api/v1/stakeholders', { kind: 'EXTERNAL', name: 'Intégrateur fictif' })
    ).json();
    const body = { stakeholderId: st.id, function: 'INTEGRATOR' };
    expect((await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/stakeholders`, body)).statusCode).toBe(200);
    expect((await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/stakeholders`, body)).statusCode).toBe(409);
  });

  it('contrôle les droits par section pour un contributeur affecté', async () => {
    const s = await newSystem();
    const { user, session } = await loginAs(ctx, [{ role: 'CONTRIBUTOR', orgUnitId: unit.id }]);
    const a = await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/assignments`, { section: 'assets', userId: user.id });
    expect(a.statusCode).toBe(201);
    const asset = (await req(gov, 'POST', '/api/v1/assets', { name: uniq('A'), type: 'SAAS' })).json();
    const ds = (await req(gov, 'POST', '/api/v1/datasets', { name: uniq('D'), origin: 'INTERNAL' })).json();
    expect((await req(session, 'POST', `/api/v1/ai-systems/${s.id}/assets`, { assetId: asset.id })).statusCode).toBe(
      200,
    );
    expect(
      (await req(session, 'POST', `/api/v1/ai-systems/${s.id}/datasets`, { datasetId: ds.id, usages: ['RAG'] }))
        .statusCode,
    ).toBe(403);
    // Le contributeur ne peut pas affecter d'autres personnes.
    expect(
      (await req(session, 'POST', `/api/v1/ai-systems/${s.id}/assignments`, { section: 'data', userId: user.id }))
        .statusCode,
    ).toBe(403);
    expect((await req(gov, 'DELETE', `/api/v1/ai-systems/${s.id}/assignments/${a.json().id}`)).statusCode).toBe(204);
    expect((await req(session, 'DELETE', `/api/v1/ai-systems/${s.id}/assets/${asset.id}`)).statusCode).toBe(403);
  });

  it('fusionne les détails de valeur ajoutée (sauvegarde partielle)', async () => {
    const s = await newSystem();
    const r1 = await req(gov, 'PATCH', `/api/v1/ai-systems/${s.id}`, {
      version: 1,
      valueDetails: { benefits: 'Réduction du temps de recherche' },
    });
    const r2 = await req(gov, 'PATCH', `/api/v1/ai-systems/${s.id}`, {
      version: 2,
      valueDetails: { kpis: 'Temps moyen' },
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.json().valueDetails).toEqual({ benefits: 'Réduction du temps de recherche', kpis: 'Temps moyen' });
    expect(r2.json().completenessChecks.find((c: { key: string }) => c.key === 'benefits').ok).toBe(true);
  });

  it('bloque la modification des sections d’un SIA archivé', async () => {
    const s = await newSystem();
    await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/archive`, { reason: 'Archivage pour test de section' });
    const asset = (await req(gov, 'POST', '/api/v1/assets', { name: uniq('A'), type: 'API' })).json();
    expect((await req(gov, 'POST', `/api/v1/ai-systems/${s.id}/assets`, { assetId: asset.id })).statusCode).toBe(409);
  });
});

describe('gabarits', () => {
  it('crée un SIA à partir d’un gabarit sans reprendre historique ni liens', async () => {
    const src = await newSystem(gov, { purpose: 'Finalité type', description: 'Description type suffisamment longue' });
    await req(gov, 'PATCH', `/api/v1/ai-systems/${src.id}`, {
      version: 1,
      aiActRoles: ['DEPLOYER'],
      valueLevel: 'HIGH',
    });
    const asset = (await req(gov, 'POST', '/api/v1/assets', { name: uniq('A'), type: 'API' })).json();
    await req(gov, 'POST', `/api/v1/ai-systems/${src.id}/assets`, { assetId: asset.id });
    const tpl = await req(gov, 'POST', '/api/v1/system-templates', { name: uniq('Gabarit'), fromSystemId: src.id });
    expect(tpl.statusCode).toBe(201);
    const created = await newSystem(gov, { templateId: tpl.json().id });
    expect(created.purpose).toBe('Finalité type');
    expect(created.aiActRoles).toEqual(['DEPLOYER']);
    expect(created.valueLevel).toBe('HIGH');
    expect(created.assets).toEqual([]);
    expect(created.status).toBe('DRAFT');
    expect(created.version).toBe(1);
    const { session: owner } = await loginAs(ctx, [{ role: 'READER' }]);
    expect(
      (await req(owner, 'POST', '/api/v1/system-templates', { name: 'x2', fromSystemId: src.id })).statusCode,
    ).toBe(403);
    await req(gov, 'POST', `/api/v1/system-templates/${tpl.json().id}/deactivate`);
    expect(
      (
        await req(gov, 'POST', '/api/v1/ai-systems', {
          name: 'Gabarit inactif',
          orgUnitId: unit.id,
          templateId: tpl.json().id,
        })
      ).statusCode,
    ).toBe(400);
  });
});
