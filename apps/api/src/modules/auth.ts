import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { changePasswordSchema, loginSchema } from '@chandelier/shared';
import { recordAudit } from '../audit/audit.js';
import { AppError, badRequest, unauthorized } from '../errors.js';
import { actorOf, requireAuth } from '../http.js';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password.js';
import { cookieName, createSession } from '../auth/session.js';
import { listPermissions } from '../rbac/access.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const GENERIC_LOGIN_ERROR = 'Identifiants invalides ou compte indisponible';

const meResponse = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    orgUnitId: z.string().nullable(),
    mustChangePassword: z.boolean(),
  }),
  roles: z.array(z.object({ roleKey: z.string(), orgUnitId: z.string().nullable(), includeDescendants: z.boolean() })),
  permissions: z.array(z.string()),
  csrfToken: z.string(),
  session: z.object({ idleMinutes: z.number(), expiresAt: z.string() }),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma, config } = app.deps;

  app.post(
    '/login',
    {
      config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Authentification'],
        summary: 'Connexion locale (e-mail + mot de passe)',
        security: [],
        body: loginSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const user = await prisma.user.findUnique({ where: { email } });
      const actorBase = { origin: 'USER' as const, requestId: request.id, ip: request.ip };

      if (!user || !user.passwordHash || user.authProvider !== 'LOCAL') {
        await verifyPassword(await getDummyHash(), password);
        await prisma.$transaction((tx) =>
          recordAudit(tx, { ...actorBase, id: null, label: email }, { action: 'login_failed', entityType: 'User' }),
        );
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }
      const label = `${user.displayName} <${user.email}>`;
      const locked = user.lockedUntil && user.lockedUntil.getTime() > Date.now();
      const valid = !locked && user.isActive && (await verifyPassword(user.passwordHash, password));

      if (!valid) {
        const failed = locked ? user.failedLoginCount : user.failedLoginCount + 1;
        const lock = !locked && failed >= MAX_FAILED;
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: lock ? 0 : failed,
              ...(lock ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : {}),
            },
          });
          await recordAudit(
            tx,
            { ...actorBase, id: user.id, label },
            {
              action: locked ? 'login_refused_locked' : lock ? 'account_locked' : 'login_failed',
              entityType: 'User',
              entityId: user.id,
            },
          );
        });
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });
        await recordAudit(
          tx,
          { ...actorBase, id: user.id, label },
          { action: 'login', entityType: 'User', entityId: user.id },
        );
      });
      const { token } = await createSession(prisma, config, user.id, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.setCookie(cookieName(config), token, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'strict',
        path: '/',
        maxAge: config.SESSION_ABSOLUTE_HOURS * 3600,
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/logout',
    {
      config: { allowPendingPasswordChange: true },
      schema: { tags: ['Authentification'], summary: 'Déconnexion', response: { 204: z.null() } },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const session = request.authSession;
      await prisma.$transaction(async (tx) => {
        if (session) await tx.session.delete({ where: { id: session.id } });
        await recordAudit(tx, actorOf(request), { action: 'logout', entityType: 'User', entityId: ctx.user.id });
      });
      reply.clearCookie(cookieName(config), { path: '/' });
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me',
    {
      config: { allowPendingPasswordChange: true },
      schema: {
        tags: ['Authentification'],
        summary: 'Utilisateur courant, permissions et jeton CSRF',
        response: { 200: meResponse },
      },
    },
    async (request) => {
      const ctx = requireAuth(request);
      const session = request.authSession;
      if (!session) throw unauthorized();
      return {
        user: ctx.user,
        roles: ctx.roles,
        permissions: listPermissions(ctx),
        csrfToken: session.csrfToken,
        session: { idleMinutes: config.SESSION_IDLE_MINUTES, expiresAt: session.expiresAt.toISOString() },
      };
    },
  );

  // Variante publique de /me pour l'interface : 200 { authenticated: false } plutôt qu'un 401
  // (évite une erreur console à chaque chargement de l'écran de connexion).
  app.get(
    '/session',
    {
      config: { public: true },
      schema: {
        tags: ['Authentification'],
        summary: 'État de session (public)',
        security: [],
        response: {
          200: z.union([
            z.object({ authenticated: z.literal(false) }),
            meResponse.extend({ authenticated: z.literal(true) }),
          ]),
        },
      },
    },
    async (request) => {
      const ctx = request.auth;
      const session = request.authSession;
      if (!ctx || !session) return { authenticated: false as const };
      return {
        authenticated: true as const,
        user: ctx.user,
        roles: ctx.roles,
        permissions: listPermissions(ctx),
        csrfToken: session.csrfToken,
        session: { idleMinutes: config.SESSION_IDLE_MINUTES, expiresAt: session.expiresAt.toISOString() },
      };
    },
  );

  app.post(
    '/change-password',
    {
      config: { allowPendingPasswordChange: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Authentification'],
        summary: 'Changer son mot de passe (révoque les autres sessions)',
        body: changePasswordSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const currentSession = request.authSession;
      if (!currentSession) throw unauthorized();
      const { currentPassword, newPassword } = request.body;
      if (currentPassword === newPassword) throw badRequest('Le nouveau mot de passe doit être différent');
      const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new AppError(400, 'INVALID_PASSWORD', 'Mot de passe actuel incorrect');
      }
      const passwordHash = await hashPassword(newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
        });
        await tx.session.deleteMany({ where: { userId: user.id, id: { not: currentSession.id } } });
        await recordAudit(tx, actorOf(request), {
          action: 'password_changed',
          entityType: 'User',
          entityId: user.id,
        });
      });
      return reply.status(204).send(null);
    },
  );
};
