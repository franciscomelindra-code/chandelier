import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, createUser, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let unitA: { id: string };
let unitA1: { id: string };
let unitB: { id: string };
let gov: Session;

beforeAll(async () => {
  ctx = await setupApp();
  unitA = await createOrgUnit(ctx.prisma);
  unitA1 = await createOrgUnit(ctx.prisma, unitA.id);
  unitB = await createOrgUnit(ctx.prisma);
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE' }])).session;
});
afterAll(async () => ctx.close());

async function create(s: Session, body: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/v1/ai-systems', headers: authed(s), payload: body });
}
async function createOk(s: Session, body: Record<string, unknown>) {
  const res = await create(s, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}
const get = (s: Session, url: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const patch = (s: Session, id: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'PATCH', url: `/api/v1/ai-systems/${id}`, headers: authed(s), payload });

describe('registre des SIA — création et consultation', () => {
  it('crée une fiche vierge en brouillon avec référence automatique, versionnée et journalisée', async () => {
    const s = await createOk(gov, { name: 'Assistant de test', orgUnitId: unitA.id, purpose: 'Tester' });
    expect(s.reference).toMatch(/^SIA-\d{4}$/);
    expect(s.status).toBe('DRAFT');
    expect(s.riskCategory).toBe('UNDETERMINED');
    expect(s.version).toBe(1);
    expect(s.completenessChecks.length).toBeGreaterThan(5);
    const versions = await ctx.prisma.entityVersion.count({ where: { entityType: 'AiSystem', entityId: s.id } });
    expect(versions).toBe(1);
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { entityId: s.id, action: 'create' } });
    expect(audit?.aiSystemId).toBe(s.id);
  });

  it('refuse une référence en double (409) et des données invalides (400)', async () => {
    const ref = uniq('REF').toUpperCase();
    await createOk(gov, { name: 'Premier', orgUnitId: unitA.id, reference: ref });
    expect((await create(gov, { name: 'Second', orgUnitId: unitA.id, reference: ref })).statusCode).toBe(409);
    expect((await create(gov, { name: 'X', orgUnitId: unitA.id })).statusCode).toBe(400);
    expect(
      (await create(gov, { name: 'Champ inconnu', orgUnitId: unitA.id, riskCategory: 'MINIMAL' })).statusCode,
    ).toBe(400);
  });

  it('limite la création au périmètre de l’utilisateur', async () => {
    const { session } = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unitA.id }]);
    expect((await create(session, { name: 'Dans mon périmètre', orgUnitId: unitA1.id })).statusCode).toBe(201);
    expect((await create(session, { name: 'Hors périmètre', orgUnitId: unitB.id })).statusCode).toBe(403);
    const { session: reader } = await loginAs(ctx, [{ role: 'READER' }]);
    expect((await create(reader, { name: 'Lecteur', orgUnitId: unitA.id })).statusCode).toBe(403);
  });

  it('filtre la liste par périmètre et renvoie 404 hors périmètre (sans fuite d’existence)', async () => {
    const inB = await createOk(gov, { name: 'Système unité B', orgUnitId: unitB.id });
    const { session } = await loginAs(ctx, [{ role: 'READER', orgUnitId: unitA.id }]);
    const list = (await get(session, '/api/v1/ai-systems?pageSize=200')).json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain(inB.id);
    expect(list.items.length).toBeGreaterThan(0);
    expect((await get(session, `/api/v1/ai-systems/${inB.id}`)).statusCode).toBe(404);
    expect((await get(session, `/api/v1/ai-systems/${crypto.randomUUID()}`)).statusCode).toBe(404);
  });
});

describe('registre — recherche, filtres, tri, pagination', () => {
  it('recherche en plein texte (français, préfixes) et par référence', async () => {
    const s = await createOk(gov, {
      name: 'Optimisation des tournées',
      orgUnitId: unitA.id,
      purpose: 'Planifier les itinéraires de livraison fictifs',
    });
    const byStem = (await get(gov, '/api/v1/ai-systems?q=itinéraire')).json();
    expect(byStem.items.map((i: { id: string }) => i.id)).toContain(s.id);
    const byPrefix = (await get(gov, '/api/v1/ai-systems?q=tourn')).json();
    expect(byPrefix.items.map((i: { id: string }) => i.id)).toContain(s.id);
    const byRef = (await get(gov, `/api/v1/ai-systems?q=${s.reference}`)).json();
    expect(byRef.items[0].id).toBe(s.id);
    const none = (await get(gov, '/api/v1/ai-systems?q=zzzaucunresultat')).json();
    expect(none.total).toBe(0);
  });

  it('combine les filtres, inclut les sous-unités, trie et pagine côté serveur', async () => {
    const parent = await createOrgUnit(ctx.prisma);
    const child = await createOrgUnit(ctx.prisma, parent.id);
    const a = await createOk(gov, { name: 'Alpha filtre', orgUnitId: parent.id });
    const b = await createOk(gov, { name: 'Bravo filtre', orgUnitId: child.id });
    const c = await createOk(gov, { name: 'Charlie filtre', orgUnitId: child.id });
    await patch(gov, c.id, { version: c.version, status: 'ACTIVE', valueLevel: 'HIGH', aiActRoles: ['DEPLOYER'] });

    const all = (await get(gov, `/api/v1/ai-systems?orgUnitId=${parent.id}&sort=name&dir=asc`)).json();
    expect(all.items.map((i: { id: string }) => i.id)).toEqual([a.id, b.id, c.id]);

    const filtered = (
      await get(gov, `/api/v1/ai-systems?orgUnitId=${parent.id}&status=ACTIVE&value=HIGH&role=DEPLOYER`)
    ).json();
    expect(filtered.items.map((i: { id: string }) => i.id)).toEqual([c.id]);

    const p2 = (await get(gov, `/api/v1/ai-systems?orgUnitId=${parent.id}&sort=name&dir=asc&page=2&pageSize=2`)).json();
    expect(p2.total).toBe(3);
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual([c.id]);

    expect((await get(gov, '/api/v1/ai-systems?status=INVENTE')).statusCode).toBe(400);
  });
});

describe('registre — modification', () => {
  it('applique le verrou optimiste (409) et journalise le diff', async () => {
    const s = await createOk(gov, { name: 'Verrou', orgUnitId: unitA.id });
    const ok = await patch(gov, s.id, { version: 1, description: 'Nouvelle description détaillée du système.' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    const stale = await patch(gov, s.id, { version: 1, description: 'Écrasement' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { entityId: s.id, action: 'update' } });
    expect(audit?.changes).toMatchObject({
      description: { old: '', new: 'Nouvelle description détaillée du système.' },
    });
  });

  it('recalcule la complétude côté serveur', async () => {
    const s = await createOk(gov, { name: 'Complétude', orgUnitId: unitA.id });
    const before = s.completeness;
    const res = await patch(gov, s.id, {
      version: 1,
      valueLevel: 'MEDIUM',
      valueJustification: 'Gain de temps estimé',
      aiActRoles: ['DEPLOYER'],
    });
    expect(res.json().completeness).toBeGreaterThan(before);
  });

  it('SYSTEM_OWNER ne modifie que ses propres SIA', async () => {
    const { user, session } = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unitA.id }]);
    const mine = await createOk(session, { name: 'Le mien', orgUnitId: unitA.id });
    expect(mine.owner.id).toBe(user.id);
    expect((await patch(session, mine.id, { version: 1, purpose: 'Mise à jour autorisée' })).statusCode).toBe(200);
    const other = await createOk(gov, { name: 'Pas le mien', orgUnitId: unitA.id });
    expect((await patch(session, other.id, { version: 1, purpose: 'Interdit' })).statusCode).toBe(403);
    expect((await get(session, `/api/v1/ai-systems/${other.id}`)).json().canUpdate).toBe(false);
  });

  it('CONTRIBUTOR ne modifie que les sections affectées', async () => {
    const { user, session } = await loginAs(ctx, [{ role: 'CONTRIBUTOR', orgUnitId: unitA.id }]);
    const s = await createOk(gov, { name: 'Contribution', orgUnitId: unitA.id });
    expect((await patch(session, s.id, { version: 1, valueLevel: 'HIGH' })).statusCode).toBe(403);
    await ctx.prisma.sectionAssignment.create({ data: { aiSystemId: s.id, section: 'value', userId: user.id } });
    expect((await patch(session, s.id, { version: 1, valueLevel: 'HIGH' })).statusCode).toBe(200);
    expect((await patch(session, s.id, { version: 2, name: 'Renommage interdit' })).statusCode).toBe(403);
    const detail = (await get(session, `/api/v1/ai-systems/${s.id}`)).json();
    expect(detail.permissions.updatableSections).toEqual(['value']);
  });

  it('refuse le déplacement vers une unité hors périmètre', async () => {
    const { session } = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unitA.id }]);
    const s = await createOk(session, { name: 'Déplacement', orgUnitId: unitA.id });
    expect((await patch(session, s.id, { version: 1, orgUnitId: unitB.id })).statusCode).toBe(403);
    expect((await patch(session, s.id, { version: 1, orgUnitId: unitA1.id })).statusCode).toBe(200);
  });

  it('empêche de passer au statut Archivé hors archivage motivé', async () => {
    const s = await createOk(gov, { name: 'Statut', orgUnitId: unitA.id });
    expect((await patch(gov, s.id, { version: 1, status: 'ARCHIVED' })).statusCode).toBe(400);
  });
});

describe('registre — archivage', () => {
  it('exige une justification, masque par défaut, bloque la modification, puis restaure le statut', async () => {
    const s = await createOk(gov, { name: 'À archiver', orgUnitId: unitA.id });
    await patch(gov, s.id, { version: 1, status: 'PILOT' });
    const noReason = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/ai-systems/${s.id}/archive`,
      headers: authed(gov),
      payload: { reason: 'court' },
    });
    expect(noReason.statusCode).toBe(400);
    const archived = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/ai-systems/${s.id}/archive`,
      headers: authed(gov),
      payload: { reason: 'Projet abandonné après pilote' },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().status).toBe('ARCHIVED');

    const listed = (await get(gov, `/api/v1/ai-systems?q=${s.reference}`)).json();
    expect(listed.total).toBe(0);
    const onlyArchived = (await get(gov, `/api/v1/ai-systems?q=${s.reference}&archived=only`)).json();
    expect(onlyArchived.total).toBe(1);

    expect((await patch(gov, s.id, { version: archived.json().version, name: 'Modif' })).statusCode).toBe(409);

    const restored = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/ai-systems/${s.id}/restore`,
      headers: authed(gov),
      payload: { reason: 'Reprise du projet décidée' },
    });
    expect(restored.json().status).toBe('PILOT');
    const ev = await ctx.prisma.auditEvent.findFirst({ where: { entityId: s.id, action: 'archive' } });
    expect(ev?.justification).toBe('Projet abandonné après pilote');
  });

  it('refuse l’archivage à un lecteur', async () => {
    const s = await createOk(gov, { name: 'Lecteur archive', orgUnitId: unitA.id });
    const { session } = await loginAs(ctx, [{ role: 'READER' }]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/ai-systems/${s.id}/archive`,
      headers: authed(session),
      payload: { reason: 'Tentative non autorisée' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('registre — actions de masse', () => {
  it('applique tout ou rien selon les droits sur chaque SIA', async () => {
    const { user, session } = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unitA.id }]);
    const mine1 = await createOk(session, { name: 'Masse 1', orgUnitId: unitA.id });
    const mine2 = await createOk(session, { name: 'Masse 2', orgUnitId: unitA.id });
    const notMine = await createOk(gov, { name: 'Masse 3', orgUnitId: unitA.id });

    const refused = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ai-systems/bulk',
      headers: authed(session),
      payload: { action: 'setStatus', ids: [mine1.id, mine2.id, notMine.id], status: 'QUALIFICATION' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details.denied).toEqual([notMine.reference]);
    expect((await ctx.prisma.aiSystem.findUniqueOrThrow({ where: { id: mine1.id } })).status).toBe('DRAFT');

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ai-systems/bulk',
      headers: authed(session),
      payload: { action: 'setStatus', ids: [mine1.id, mine2.id], status: 'QUALIFICATION' },
    });
    expect(ok.statusCode).toBe(200);
    const rows = await ctx.prisma.aiSystem.findMany({ where: { id: { in: [mine1.id, mine2.id] } } });
    expect(rows.every((r) => r.status === 'QUALIFICATION' && r.version === 2 && r.ownerId === user.id)).toBe(true);
  });

  it('ajoute et retire des tags, réaffecte le propriétaire, archive en masse', async () => {
    const tag = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: authed(gov),
      payload: { label: uniq('tag') },
    });
    expect(tag.statusCode).toBe(201);
    const tagId = tag.json().id;
    const a = await createOk(gov, { name: 'Tag A', orgUnitId: unitA.id });
    const b = await createOk(gov, { name: 'Tag B', orgUnitId: unitA.id });
    const bulk = (payload: Record<string, unknown>) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai-systems/bulk',
        headers: authed(gov),
        payload: { ids: [a.id, b.id], ...payload },
      });
    expect((await bulk({ action: 'addTags', tagIds: [tagId] })).statusCode).toBe(200);
    expect((await get(gov, `/api/v1/ai-systems?tagId=${tagId}`)).json().total).toBe(2);
    expect((await bulk({ action: 'removeTags', tagIds: [tagId] })).statusCode).toBe(200);
    expect((await get(gov, `/api/v1/ai-systems?tagId=${tagId}`)).json().total).toBe(0);
    const owner = await createUser(ctx.prisma, [{ role: 'SYSTEM_OWNER' }]);
    expect((await bulk({ action: 'assignOwner', ownerId: owner.id })).statusCode).toBe(200);
    expect((await get(gov, `/api/v1/ai-systems?ownerId=${owner.id}`)).json().total).toBe(2);
    expect((await bulk({ action: 'archive', reason: 'Archivage groupé de test' })).statusCode).toBe(200);
    expect(await ctx.prisma.aiSystem.count({ where: { id: { in: [a.id, b.id] }, archivedAt: { not: null } } })).toBe(2);
  });
});

describe('registre — export, historique, vues', () => {
  it('exporte en CSV (en-têtes de compatibilité) et JSON, et journalise l’export', async () => {
    const s = await createOk(gov, { name: 'Export test', orgUnitId: unitA.id, description: '=CMD()' });
    const csv = await get(gov, `/api/v1/ai-systems/export?format=csv&q=${s.reference}`);
    expect(csv.statusCode).toBe(200);
    const [header, line] = csv.body.replace('\uFEFF', '').split('\r\n');
    expect(header).toContain('"Label";"Ref";"Description";"State";"RiskLevel"');
    expect(line).toContain(`"${s.reference}"`);
    expect(line).toContain(`"'=CMD()"`);
    const json = await get(gov, `/api/v1/ai-systems/export?format=json&q=${s.reference}`);
    expect(json.json().items[0].id).toBe(s.id);
    expect(
      await ctx.prisma.auditEvent.count({ where: { entityType: 'AiSystem', action: 'export' } }),
    ).toBeGreaterThanOrEqual(2);
    const { session } = await loginAs(ctx, [{ role: 'CONTRIBUTOR' }]);
    expect((await get(session, '/api/v1/ai-systems/export')).statusCode).toBe(403);
  });

  it('expose l’historique du SIA à qui peut le lire', async () => {
    const s = await createOk(gov, { name: 'Historique', orgUnitId: unitA.id });
    await patch(gov, s.id, { version: 1, purpose: 'Finalité modifiée' });
    const { session } = await loginAs(ctx, [{ role: 'READER' }]);
    const h = (await get(session, `/api/v1/ai-systems/${s.id}/history`)).json();
    expect(h.items.map((e: { action: string }) => e.action)).toEqual(['update', 'create']);
  });

  it('isole les vues personnelles et partage les vues partagées', async () => {
    const u1 = await loginAs(ctx, [{ role: 'READER' }]);
    const u2 = await loginAs(ctx, [{ role: 'READER' }]);
    const mk = (name: string, isShared: boolean) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/saved-views',
        headers: authed(u1.session),
        payload: {
          name,
          scope: 'ai-systems',
          isShared,
          state: { query: 'status=ACTIVE', columns: ['name'], layout: 'table' },
        },
      });
    const priv = (await mk('Privée', false)).json();
    await mk('Partagée', true);
    const seen = (await get(u2.session, '/api/v1/saved-views?scope=ai-systems'))
      .json()
      .items.map((v: { name: string }) => v.name);
    expect(seen).toContain('Partagée');
    expect(seen).not.toContain('Privée');
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/saved-views/${priv.id}`,
      headers: authed(u2.session),
    });
    expect(del.statusCode).toBe(403);
    expect(
      (await ctx.app.inject({ method: 'DELETE', url: `/api/v1/saved-views/${priv.id}`, headers: authed(u1.session) }))
        .statusCode,
    ).toBe(204);
  });
});
