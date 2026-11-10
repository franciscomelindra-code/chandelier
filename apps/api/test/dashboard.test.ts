import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let unit: { id: string };
let other: { id: string };
let scoped: { user: { id: string }; session: Session };
let outsider: Session;

const req = (s: Session, method: 'GET' | 'POST', url: string, payload?: unknown) =>
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
  scoped = await loginAs(ctx, [{ role: 'AI_GOVERNANCE', orgUnitId: unit.id }]);
  outsider = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE', orgUnitId: other.id }])).session;
});
afterAll(async () => ctx.close());

describe('tableau de bord', () => {
  it('calcule les indicateurs sur le périmètre, la matrice risque × valeur et les alertes cliquables', async () => {
    const a = (
      await req(scoped.session, 'POST', '/ai-systems', {
        name: uniq('SIA tdb A'),
        orgUnitId: unit.id,
        ownerId: scoped.user.id,
      })
    ).json();
    const b = (
      await req(scoped.session, 'POST', '/ai-systems', { name: uniq('SIA tdb B'), orgUnitId: unit.id })
    ).json();
    // Catégorie et valeur posées directement (la qualification est testée ailleurs).
    await ctx.prisma.aiSystem.update({ where: { id: a.id }, data: { riskCategory: 'HIGH', valueLevel: 'HIGH' } });
    // La création désigne le créateur comme propriétaire par défaut : on le retire pour le cas « sans propriétaire ».
    await ctx.prisma.aiSystem.update({
      where: { id: b.id },
      data: { riskCategory: 'MINIMAL', valueLevel: 'LOW', ownerId: null },
    });
    const act = await req(scoped.session, 'POST', '/actions', {
      aiSystemId: a.id,
      title: 'Action en retard',
      dueDate: '2020-01-01',
    });
    expect(act.statusCode, act.body).toBe(201);

    const res = await req(scoped.session, 'GET', '/dashboard');
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.total).toBe(2);
    expect(d.kpis.highRisk).toBe(1);
    expect(d.kpis.notQualified).toBe(2);
    expect(d.kpis.noOwner).toBe(1);
    expect(d.kpis.actionsOverdue).toBe(1);
    expect(d.matrix.HIGH.HIGH).toBe(1);
    expect(d.matrix.MINIMAL.LOW).toBe(1);
    expect(d.evolution).toHaveLength(12);
    expect(d.evolution.at(-1).total).toBe(2);
    const codes = d.alerts.map((x: { code: string }) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['NO_OWNER', 'ACTIONS_OVERDUE', 'NOT_QUALIFIED']));
    expect(d.alerts.find((x: { code: string }) => x.code === 'NO_OWNER').link).toBe('/systemes?noOwner=true');

    // Les liens d'alerte ouvrent une liste filtrée cohérente avec le compteur.
    const noOwner = (await req(scoped.session, 'GET', '/ai-systems?noOwner=true')).json();
    expect(noOwner.total).toBe(1);
    const notQualified = (await req(scoped.session, 'GET', '/ai-systems?qualified=no')).json();
    expect(notQualified.total).toBe(2);

    // Filtres : propriétaire.
    const filtered = (await req(scoped.session, 'GET', `/dashboard?ownerId=${scoped.user.id}`)).json();
    expect(filtered.total).toBe(1);

    // Hors périmètre : rien n'apparaît.
    const out = (await req(outsider, 'GET', '/dashboard')).json();
    expect(out.total).toBe(0);
    expect(out.alerts).toEqual([]);
  });
});
