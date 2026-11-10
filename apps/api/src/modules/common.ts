import type { Prisma, PrismaClient } from '@prisma/client';
import { badRequest } from '../errors.js';

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Date du jour (UTC) au format AAAA-MM-JJ. */
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const toDate = (d: string | null | undefined) =>
  d === undefined ? undefined : d ? new Date(`${d}T00:00:00Z`) : null;

export async function namesFor(db: Db, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

export async function requireActiveUser(db: Db, id: string | null | undefined, label: string) {
  if (!id) return;
  if (!(await db.user.findFirst({ where: { id, isActive: true }, select: { id: true } })))
    throw badRequest(`${label} inconnu ou désactivé`);
}

/** Prochaine référence séquentielle PREFIX-#### (unicité garantie par contrainte ; collision → 409). */
export async function nextSeqReference(db: Db, table: 'risk' | 'action', prefix: string): Promise<string> {
  const pattern = `^${prefix}-([0-9]+)$`;
  const rows =
    table === 'risk'
      ? await db.$queryRaw<{ n: number | null }[]>`
          SELECT max(substring("reference" from ${pattern})::int) AS n FROM "risk"`
      : await db.$queryRaw<{ n: number | null }[]>`
          SELECT max(substring("reference" from ${pattern})::int) AS n FROM "action"`;
  return `${prefix}-${String((rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
}
