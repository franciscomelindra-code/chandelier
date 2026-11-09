import type { FastifyRequest } from 'fastify';
import type { Permission } from '@chandelier/shared';
import type { AuditActor } from './audit/audit.js';
import { forbidden, unauthorized } from './errors.js';
import { hasPermission, type AccessContext } from './rbac/access.js';

export function requireAuth(request: FastifyRequest): AccessContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

/** Garde de premier niveau : la permission existe-t-elle sous une forme quelconque ? Le contrôle objet suit. */
export function requirePermission(request: FastifyRequest, permission: Permission): AccessContext {
  const ctx = requireAuth(request);
  if (!hasPermission(ctx, permission)) throw forbidden();
  return ctx;
}

export function actorOf(request: FastifyRequest): AuditActor {
  return {
    id: request.auth?.user.id ?? null,
    label: request.auth ? `${request.auth.user.displayName} <${request.auth.user.email}>` : 'anonyme',
    origin: 'USER',
    requestId: request.id,
    ip: request.ip,
  };
}
