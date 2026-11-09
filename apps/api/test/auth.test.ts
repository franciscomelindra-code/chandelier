import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createUser, login, setupApp, TEST_PASSWORD, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(async () => ctx.close());

describe('authentification', () => {
  it('refuse l’accès anonyme aux données (401)', async () => {
    for (const url of ['/api/v1/users', '/api/v1/org-units', '/api/v1/audit-events', '/api/v1/roles', '/api/docs']) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('/auth/session renvoie 200 non authentifié, sans donnée', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: false });
  });

  it('health et ready sont publics', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    const ready = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', checks: { database: true, migrations: true } });
  });

  it('renvoie un message générique pour un compte inconnu ou un mauvais mot de passe', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'READER' }]);
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'inconnu@test.invalid', password: 'x' },
    });
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'mauvais' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it('verrouille le compte après 5 échecs, même avec le bon mot de passe ensuite', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'READER' }]);
    for (let i = 0; i < 5; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'mauvais' },
        remoteAddress: `10.0.0.${i + 10}`,
      });
    }
    const locked = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: TEST_PASSWORD },
      remoteAddress: '10.0.0.99',
    });
    expect(res.statusCode).toBe(401);
    const events = await ctx.prisma.auditEvent.findMany({ where: { entityId: user.id } });
    expect(events.map((e) => e.action)).toContain('account_locked');
  });

  it('refuse un compte désactivé', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'READER' }], { isActive: false });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });

  it('pose un cookie HttpOnly SameSite=Strict, sans stocker le jeton en clair', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'READER' }]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: TEST_PASSWORD },
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const token = cookie.split(';')[0]!.split('=')[1]!;
    const sessions = await ctx.prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
  });

  it('expose /me avec permissions et jeton CSRF', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'AUDITOR' }]);
    const s = await login(ctx.app, user.email);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user.email).toBe(user.email);
    expect(body.permissions).toContain('audit:read');
    expect(body.permissions).not.toContain('aiSystem:create');
    expect(body.csrfToken.length).toBeGreaterThan(20);
  });

  it('exige le jeton CSRF sur les méthodes non sûres', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'SUPER_ADMIN' }]);
    const s = await login(ctx.app, user.email);
    const payload = { code: 'CSRF-TEST', name: 'Test CSRF', type: 'TEAM' };
    const noToken = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/org-units',
      headers: { cookie: s.cookie },
      payload,
    });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().error.code).toBe('CSRF');
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/org-units',
      headers: { cookie: s.cookie, 'x-csrf-token': 'faux' },
      payload,
    });
    expect(bad.statusCode).toBe(403);
  });

  it('impose le changement de mot de passe puis révoque les autres sessions', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'READER' }], { mustChangePassword: true });
    const s1 = await login(ctx.app, user.email);
    const s2 = await login(ctx.app, user.email);
    const blocked = await ctx.app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie: s1.cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const tooShort = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authed(s1),
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'court' },
    });
    expect(tooShort.statusCode).toBe(400);

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authed(s1),
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'Un-nouveau-mot-de-passe-solide' },
    });
    expect(ok.statusCode).toBe(204);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie: s1.cookie } })).statusCode,
    ).toBe(200);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s2.cookie } })).statusCode,
    ).toBe(401);
  });

  it('expire une session inactive', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'READER' }]);
    const s = await login(ctx.app, user.email);
    await ctx.prisma.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
    });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(401);
    expect(await ctx.prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('déconnecte et invalide la session', async () => {
    const user = await createUser(ctx.prisma, [{ role: 'READER' }]);
    const s = await login(ctx.app, user.email);
    const out = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: authed(s) });
    expect(out.statusCode).toBe(204);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: s.cookie } })).statusCode,
    ).toBe(401);
  });
});
