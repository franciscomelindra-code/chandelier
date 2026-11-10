import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import './types.js';
import { AppError } from './errors.js';
import { cookieName, resolveSession, safeEqual } from './auth/session.js';
import { loadAccessContext } from './rbac/access.js';
import { healthRoutes } from './modules/health.js';
import { authRoutes } from './modules/auth.js';
import { userRoutes } from './modules/users.js';
import { orgUnitRoutes } from './modules/org-units.js';
import { roleRoutes } from './modules/roles.js';
import { auditRoutes } from './modules/audit.js';
import { aiSystemRoutes } from './modules/ai-systems/routes.js';
import { savedViewRoutes, tagRoutes } from './modules/tags.js';
import { aiSystemLinkRoutes } from './modules/ai-systems/links.js';
import { catalogRoutes } from './modules/catalog.js';
import { assessmentRoutes } from './modules/assessments.js';

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, prisma } = deps;
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers.authorization'],
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  app.decorateRequest('auth', null);
  app.decorateRequest('authSession', null);

  await app.register(helmet, {
    // CSP stricte ; la page /api/docs (Swagger UI) a besoin des styles inline.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    hsts: config.cookieSecure,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Chandelier API',
        version: '1.0.0',
        description:
          'API REST de Chandelier (gouvernance des systèmes d’IA). Authentification par cookie de session ; ' +
          'en-tête X-CSRF-Token obligatoire sur les méthodes non sûres (valeur fournie par GET /api/v1/auth/me).',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: cookieName(config) },
        },
      },
      security: [{ session: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // ── Authentification, CSRF, changement de mot de passe imposé ──
  app.addHook('onRequest', async (request) => {
    const routeConfig = request.routeOptions.config;
    const token = request.cookies[cookieName(config)];
    if (token) {
      const session = await resolveSession(prisma, config, token);
      if (session) {
        const ctx = await loadAccessContext(prisma, session.userId);
        if (ctx) {
          request.auth = ctx;
          request.authSession = session;
        }
      }
    }
    if (routeConfig?.public) return;
    if (!request.auth || !request.authSession) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise');
    }
    if (UNSAFE_METHODS.has(request.method)) {
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, request.authSession.csrfToken)) {
        throw new AppError(403, 'CSRF', 'Jeton CSRF absent ou invalide');
      }
    }
    if (request.auth.user.mustChangePassword && !routeConfig?.allowPendingPasswordChange) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Changement de mot de passe requis');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: 'Données invalides',
          details: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Valeur déjà utilisée' } });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } });
      }
    }
    const err = error as { statusCode?: number; message?: string };
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: 'REQUEST_ERROR', message: err.message ?? 'Requête invalide' } });
    }
    request.log.error({ err: error }, 'Erreur interne');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Erreur interne', requestId: request.id } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route introuvable' } });
  });

  await app.register(healthRoutes);
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(userRoutes, { prefix: '/users' });
      await v1.register(orgUnitRoutes, { prefix: '/org-units' });
      await v1.register(roleRoutes, { prefix: '/roles' });
      await v1.register(auditRoutes, { prefix: '/audit-events' });
      await v1.register(aiSystemRoutes, { prefix: '/ai-systems' });
      await v1.register(aiSystemLinkRoutes, { prefix: '/ai-systems' });
      await v1.register(catalogRoutes);
      await v1.register(assessmentRoutes);
      await v1.register(tagRoutes, { prefix: '/tags' });
      await v1.register(savedViewRoutes, { prefix: '/saved-views' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
