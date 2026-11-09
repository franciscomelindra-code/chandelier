import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient, Session } from '@prisma/client';
import type { AppConfig } from '../config.js';

export function cookieName(cfg: AppConfig): string {
  // Préfixe __Host- : cookie lié à l'hôte, Secure, Path=/ (uniquement en HTTPS).
  return cfg.cookieSecure ? '__Host-chandelier_sid' : 'chandelier_sid';
}

export function hashToken(cfg: AppConfig, token: string): string {
  return createHmac('sha256', cfg.SESSION_SECRET).update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function createSession(
  prisma: PrismaClient,
  cfg: AppConfig,
  userId: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<{ token: string; session: Session }> {
  const token = randomBytes(32).toString('base64url');
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(cfg, token),
      csrfToken: randomBytes(32).toString('base64url'),
      userId,
      expiresAt: new Date(Date.now() + cfg.SESSION_ABSOLUTE_HOURS * 3600_000),
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, session };
}

/** Retourne la session valide (expiration absolue + inactivité) ou null ; prolonge l'inactivité. */
export async function resolveSession(prisma: PrismaClient, cfg: AppConfig, token: string): Promise<Session | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(cfg, token) } });
  if (!session) return null;
  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + cfg.SESSION_IDLE_MINUTES * 60_000;
  if (session.expiresAt.getTime() <= now || idleLimit <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  // Limite les écritures : mise à jour au plus une fois par minute.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }
  return session;
}

export async function purgeExpiredSessions(prisma: PrismaClient, cfg: AppConfig): Promise<number> {
  const idleCutoff = new Date(Date.now() - cfg.SESSION_IDLE_MINUTES * 60_000);
  const { count } = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: new Date() } }, { lastSeenAt: { lte: idleCutoff } }] },
  });
  return count;
}
