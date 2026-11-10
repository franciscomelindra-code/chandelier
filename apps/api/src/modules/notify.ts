import { REMINDER_THRESHOLDS, REVIEW_TRIGGER_LABELS, reminderThreshold, type ReviewTrigger } from '@chandelier/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { recordAudit, type AuditActor } from '../audit/audit.js';
import { addDays, today, type Tx } from './common.js';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
}

/** Notifications in-app (H-08). Idempotentes si `dedupeKey` est fourni. Jamais à l'auteur de l'action. */
export async function notify(
  db: Tx | PrismaClient,
  userIds: (string | null | undefined)[],
  n: NotificationInput,
  exceptUserId?: string | null,
) {
  const targets = [...new Set(userIds.filter((u): u is string => !!u && u !== exceptUserId))];
  let created = 0;
  for (const userId of targets) {
    const data: Prisma.NotificationUncheckedCreateInput = {
      userId,
      type: n.type,
      title: n.title.slice(0, 200),
      body: (n.body ?? '').slice(0, 1000),
      link: n.link ?? '',
      dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${userId}` : null,
    };
    if (data.dedupeKey) {
      const r = await db.notification.createMany({ data: [data], skipDuplicates: true });
      created += r.count;
    } else {
      await db.notification.create({ data });
      created++;
    }
  }
  return created;
}

/**
 * Revue exceptionnelle déclenchée par une modification substantielle d'un SIA validé (F-040).
 * Une seule revue exceptionnelle ouverte par déclencheur.
 */
export async function triggerExceptionalReview(
  tx: Tx,
  actor: AuditActor,
  system: { id: string; reference: string; name: string; ownerId: string | null; lockedVersion: number | null },
  triggers: ReviewTrigger[],
) {
  if (system.lockedVersion == null || !triggers.length) return [];
  const created: string[] = [];
  for (const trigger of [...new Set(triggers)]) {
    const open = await tx.review.findFirst({
      where: { aiSystemId: system.id, kind: 'EXCEPTIONAL', trigger, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
    });
    if (open) continue;
    const r = await tx.review.create({
      data: {
        aiSystemId: system.id,
        kind: 'EXCEPTIONAL',
        trigger,
        dueDate: new Date(`${addDays(today(), 30)}T00:00:00Z`),
        notes: `Créée automatiquement : ${REVIEW_TRIGGER_LABELS[trigger].toLowerCase()} sur un SIA validé.`,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: 'auto_review',
      entityType: 'Review',
      entityId: r.id,
      aiSystemId: system.id,
      changes: { trigger: { old: null, new: trigger } },
    });
    await notify(tx, [system.ownerId], {
      type: 'review',
      title: `Revue exceptionnelle requise — ${system.reference}`,
      body: `${REVIEW_TRIGGER_LABELS[trigger]} sur « ${system.name} », validé précédemment. Échéance : 30 jours.`,
      link: `/systemes/${system.id}?onglet=validation`,
    });
    created.push(r.id);
  }
  return created;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Rappels d'échéance 90/60/30/7 jours et dépassement (F-052) : revues, actions, obligations,
 * prochaine revue des SIA. Idempotent (clé objet + échéance + seuil). Ne concerne que les SIA non archivés.
 */
export async function runReminders(prisma: PrismaClient, day = today()) {
  const horizon = new Date(`${addDays(day, Math.max(...REMINDER_THRESHOLDS))}T00:00:00Z`);
  let created = 0;
  const label = (t: number) => (t === 0 ? 'échéance dépassée' : `échéance dans ${t} jours ou moins`);
  const remind = async (kind: string, id: string, due: Date, users: (string | null)[], title: string, link: string) => {
    const dueDay = due.toISOString().slice(0, 10);
    const t = reminderThreshold(daysBetween(day, dueDay));
    if (t === null) return;
    created += await notify(prisma, users, {
      type: 'reminder',
      title: `${title} — ${label(t)}`,
      body: `Échéance : ${dueDay}`,
      link,
      dedupeKey: `reminder:${kind}:${id}:${dueDay}:${t}`,
    });
  };
  const live = { archivedAt: null };

  const reviews = await prisma.review.findMany({
    where: { status: { in: ['PLANNED', 'IN_PROGRESS'] }, dueDate: { lte: horizon }, aiSystem: live },
    include: { aiSystem: { select: { id: true, reference: true, ownerId: true } } },
  });
  for (const r of reviews)
    await remind(
      'review',
      r.id,
      r.dueDate,
      [r.reviewerId ?? r.aiSystem.ownerId],
      `Revue ${r.aiSystem.reference}`,
      `/systemes/${r.aiSystem.id}?onglet=validation`,
    );

  const actions = await prisma.action.findMany({
    where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lte: horizon }, aiSystem: live },
    include: { aiSystem: { select: { id: true, ownerId: true } } },
  });
  for (const a of actions)
    await remind(
      'action',
      a.id,
      a.dueDate!,
      [a.assigneeId ?? a.aiSystem.ownerId],
      `Action ${a.reference}`,
      `/systemes/${a.aiSystem.id}?onglet=actions`,
    );

  const obligations = await prisma.obligation.findMany({
    where: {
      status: { notIn: ['COMPLIANT', 'NOT_APPLICABLE'] },
      applicability: { not: 'NO' },
      targetDate: { lte: horizon },
      aiSystem: live,
    },
    include: { aiSystem: { select: { id: true, reference: true, ownerId: true } } },
  });
  for (const o of obligations)
    await remind(
      'obligation',
      o.id,
      o.targetDate!,
      [o.responsibleId ?? o.aiSystem.ownerId],
      `Obligation « ${o.title} » (${o.aiSystem.reference})`,
      `/systemes/${o.aiSystem.id}?etape=classification`,
    );

  const systems = await prisma.aiSystem.findMany({
    where: { ...live, nextReviewDate: { lte: horizon } },
    select: { id: true, reference: true, ownerId: true, nextReviewDate: true },
  });
  for (const s of systems)
    await remind(
      'system-review',
      s.id,
      s.nextReviewDate!,
      [s.ownerId],
      `Revue périodique de ${s.reference}`,
      `/systemes/${s.id}?onglet=validation`,
    );

  return created;
}
