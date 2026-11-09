import type { Session } from '@prisma/client';
import type { AccessContext } from './rbac/access.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AccessContext | null;
    authSession: Session | null;
  }
  interface FastifyContextConfig {
    /** Route accessible sans session. */
    public?: boolean;
    /** Route accessible même si un changement de mot de passe est exigé. */
    allowPendingPasswordChange?: boolean;
  }
}

export {};
