import type { Origin, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface AuditActor {
  id: string | null;
  label: string;
  origin: Origin;
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  aiSystemId?: string | null;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  justification?: string | null;
}

/** Champs jamais recopiés dans le journal. */
const REDACTED = new Set(['passwordHash', 'tokenHash', 'csrfToken']);

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}

/** Diff champ à champ entre deux états (seuls les champs listés sont comparés). */
export function diff<T extends Record<string, unknown>>(
  before: Partial<T> | null,
  after: Partial<T>,
  fields: (keyof T & string)[],
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    if (REDACTED.has(f)) continue;
    const o = normalize(before?.[f]);
    const n = normalize(after[f]);
    if (JSON.stringify(o) !== JSON.stringify(n)) out[f] = { old: o, new: n };
  }
  return out;
}

export async function recordAudit(tx: Tx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: actor.id,
      actorLabel: actor.label,
      origin: actor.origin,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      aiSystemId: entry.aiSystemId ?? null,
      changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      justification: entry.justification ?? null,
      requestId: actor.requestId ?? null,
      ipAddress: actor.ip ?? null,
    },
  });
}
