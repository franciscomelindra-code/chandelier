import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_KEYS, type RoleKey } from '@chandelier/shared';
import { authed, createOrgUnit, createUser, login, loginAs, setupApp, uniq, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(async () => ctx.close());

describe('utilisateurs', () => {
  it('seul SUPER_ADMIN crée un utilisateur ; mot de passe temporaire et changement imposé', async () => {
    const { session } = await loginAs(ctx, [{ role: 'SUPER_ADMIN' }]);
    const unit = await createOrgUnit(ctx.prisma);
    const email = `${uniq('nouveau')}@test.invalid`;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authed(session),
      payload: {
        email: email.toUpperCase(),
        displayName: 'Nouvel utilisateur',
        orgUnitId: unit.id,
        roles: [{ roleKey: 'SYSTEM_OWNER', orgUnitId: unit.id, includeDescendants: true }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(email.toLowerCase());
    expect(body.user.mustChangePassword).toBe(true);
    expect(body.user.roles).toEqual([
      expect.objectContaining({ roleKey: 'SYSTEM_OWNER', orgUnitId: unit.id, includeDescendants: true }),
    ]);
    expect(body).not.toHaveProperty('user.passwordHash');
    const s = await login(ctx.app, email, body.temporaryPassword);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } });
    expect(me.json().user.mustChangePassword).toBe(true);
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { entityId: body.user.id, action: 'create' } });
    expect(audit?.changes).toMatchObject({ roles: { new: [`SYSTEM_OWNER@${unit.id}+`] } });
  });

  it('refuse la création (403) à tous les autres rôles', async () => {
    for (const role of ROLE_KEYS.filter((r) => r !== 'SUPER_ADMIN') as RoleKey[]) {
      const { session } = await loginAs(ctx, [{ role }]);
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authed(session),
        payload: { email: `${uniq('x')}@test.invalid`, displayName: 'Interdit', roles: [] },
      });
      expect(res.statusCode, role).toBe(403);
    }
  });

  it('rejette les champs inconnus et les données invalides (400)', async () => {
    const { session } = await loginAs(ctx, [{ role: 'SUPER_ADMIN' }]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authed(session),
      payload: { email: 'pas-un-email', displayName: 'X', roles: [], isAdmin: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('masque les rôles des utilisateurs à qui n’a pas user:manage', async () => {
    const { session } = await loginAs(ctx, [{ role: 'READER' }]);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/users?pageSize=5',
      headers: { cookie: session.cookie },
    });
    expect(res.statusCode).toBe(200);
    for (const u of res.json().items) expect(u.roles).toBeUndefined();
  });

  it('désactiver un compte révoque ses sessions ; impossible de se désactiver soi-même', async () => {
    const { user: admin, session } = await loginAs(ctx, [{ role: 'SUPER_ADMIN' }]);
    const target = await createUser(ctx.prisma, [{ role: 'READER' }]);
    const ts = await login(ctx.app, target.email);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${target.id}`,
      headers: authed(session),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: ts.cookie } })).statusCode,
    ).toBe(401);
    const self = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${admin.id}`,
      headers: authed(session),
      payload: { isActive: false },
    });
    expect(self.statusCode).toBe(400);
  });

  it('empêche de retirer le dernier SUPER_ADMIN actif', async () => {
    // Désactive tous les autres super admins globaux créés par les tests, puis tente de retirer le rôle du dernier.
    const { user: admin, session } = await loginAs(ctx, [{ role: 'SUPER_ADMIN' }]);
    const others = await ctx.prisma.userRoleAssignment.findMany({
      where: { role: { key: 'SUPER_ADMIN' }, orgUnitId: null, userId: { not: admin.id } },
    });
    await ctx.prisma.user.updateMany({ where: { id: { in: others.map((o) => o.userId) } }, data: { isActive: false } });
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${admin.id}`,
      headers: authed(session),
      payload: { roles: [{ roleKey: 'READER', orgUnitId: null, includeDescendants: true }] },
    });
    expect(res.statusCode).toBe(409);
    const still = await ctx.prisma.userRoleAssignment.count({
      where: { userId: admin.id, role: { key: 'SUPER_ADMIN' } },
    });
    expect(still).toBe(1);
    await ctx.prisma.user.updateMany({ where: { id: { in: others.map((o) => o.userId) } }, data: { isActive: true } });
  });

  it('réinitialise un mot de passe et révoque les sessions', async () => {
    const { session } = await loginAs(ctx, [{ role: 'SUPER_ADMIN' }]);
    const target = await createUser(ctx.prisma, [{ role: 'READER' }]);
    const ts = await login(ctx.app, target.email);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${target.id}/reset-password`,
      headers: authed(session),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().temporaryPassword.length).toBeGreaterThanOrEqual(20);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: ts.cookie } })).statusCode,
    ).toBe(401);
  });
});

describe('unités organisationnelles', () => {
  it('crée une arborescence et recalcule les chemins lors d’un déplacement', async () => {
    const { session } = await loginAs(ctx, [{ role: 'SUPER_ADMIN' }]);
    const create = async (parentId: string | null) => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/org-units',
        headers: authed(session),
        payload: { code: uniq('U').toUpperCase(), name: uniq('Unité'), type: 'DIRECTION', parentId },
      });
      expect(res.statusCode).toBe(201);
      return res.json();
    };
    const a = await create(null);
    const b = await create(null);
    const a1 = await create(a.id);
    const a11 = await create(a1.id);
    expect(a11.path).toBe(`/${a.id}/${a1.id}/${a11.id}/`);

    const moved = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/org-units/${a1.id}`,
      headers: authed(session),
      payload: { parentId: b.id },
    });
    expect(moved.statusCode).toBe(200);
    const child = await ctx.prisma.organizationUnit.findUniqueOrThrow({ where: { id: a11.id } });
    expect(child.path).toBe(`/${b.id}/${a1.id}/${a11.id}/`);

    const cycle = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/org-units/${a1.id}`,
      headers: authed(session),
      payload: { parentId: a11.id },
    });
    expect(cycle.statusCode).toBe(400);
  });

  it('refuse un code dupliqué (409) et la gestion aux non-administrateurs (403)', async () => {
    const { session } = await loginAs(ctx, [{ role: 'SUPER_ADMIN' }]);
    const code = uniq('DUP').toUpperCase();
    const payload = { code, name: 'Doublon', type: 'TEAM' };
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/org-units', headers: authed(session), payload }))
        .statusCode,
    ).toBe(201);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/org-units', headers: authed(session), payload }))
        .statusCode,
    ).toBe(409);
    const { session: dpo } = await loginAs(ctx, [{ role: 'DPO' }]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/org-units',
      headers: authed(dpo),
      payload: { code: uniq('X').toUpperCase(), name: 'Interdit', type: 'TEAM' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('journal d’audit', () => {
  it('est lisible par AUDITOR, refusé à READER', async () => {
    const { session: auditor } = await loginAs(ctx, [{ role: 'AUDITOR' }]);
    const { session: reader } = await loginAs(ctx, [{ role: 'READER' }]);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/audit-events', headers: { cookie: auditor.cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/audit-events', headers: { cookie: reader.cookie } }))
        .statusCode,
    ).toBe(403);
  });

  it('est immuable en base (UPDATE, DELETE, TRUNCATE rejetés)', async () => {
    const event = await ctx.prisma.auditEvent.findFirstOrThrow();
    await expect(
      ctx.prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'falsifié' } }),
    ).rejects.toThrow(/immuable/);
    await expect(ctx.prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/immuable/);
    await expect(ctx.prisma.$executeRawUnsafe('TRUNCATE "audit_event"')).rejects.toThrow(/immuable/);
  });

  it('exporte en CSV en neutralisant les formules', async () => {
    const { session } = await loginAs(ctx, [{ role: 'AUDITOR' }]);
    await ctx.prisma.auditEvent.create({
      data: { actorLabel: '=HYPERLINK("http://x")', origin: 'SYSTEM', action: 'test_csv', entityType: 'Test' },
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/audit-events/export.csv?action=test_csv',
      headers: { cookie: session.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.body).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('expose la spécification OpenAPI aux utilisateurs connectés', async () => {
    const { session } = await loginAs(ctx, [{ role: 'READER' }]);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/docs/json', headers: { cookie: session.cookie } });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/users/', '/api/v1/auth/login']));
  });
});
