import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  APPROVAL_DOMAIN_LABELS,
  DEFAULT_REVIEW_INTERVALS,
  DOMAIN_ROLES,
  addMonths,
  approvalDecisionSchema,
  commentCreateSchema,
  intervalFor,
  reviewCompleteSchema,
  reviewCreateSchema,
  reviewIntervalsSchema,
  reviewUpdateSchema,
  validationRequestSchema,
  type ApprovalDomain,
  type ReviewIntervals,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { actorOf, requireAuth, requirePermission } from '../http.js';
import { can, loadAccessContext, type AccessContext } from '../rbac/access.js';
import {
  TRACKED_FIELDS,
  loadVisible,
  refreshCompleteness,
  scopeWhere,
  snapshot,
  systemInclude,
  targetOf,
  type SystemRow,
} from './ai-systems/service.js';
import { dayOf, namesFor, requireActiveUser, today, type Db, type Tx } from './common.js';
import { notify } from './notify.js';

const id = z.uuid();
const SETTINGS_KEY = 'review.intervals';

/** Dernière demande par domaine (une demande relancée après rejet remplace la précédente). */
function latestPerDomain<T extends { domain: string; createdAt: Date }>(list: T[]): T[] {
  const m = new Map<string, T>();
  for (const a of list) {
    const prev = m.get(a.domain);
    if (!prev || a.createdAt > prev.createdAt) m.set(a.domain, a);
  }
  return [...m.values()];
}

export async function reviewIntervals(db: Db): Promise<ReviewIntervals> {
  const s = await db.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  const parsed = reviewIntervalsSchema.safeParse(s?.value);
  return parsed.success ? parsed.data : DEFAULT_REVIEW_INTERVALS;
}

/** L'utilisateur peut-il décider pour ce domaine sur ce SIA ? */
function canDecide(ctx: AccessContext, s: SystemRow, a: { domain: string; approverId: string | null }) {
  const target = targetOf(s, []);
  if (a.approverId) return a.approverId === ctx.user.id && can(ctx, 'approval:decide', target);
  const roles = DOMAIN_ROLES[a.domain as ApprovalDomain];
  return ctx.grants.some(
    (g) =>
      g.permission === 'approval:decide' &&
      roles.includes(g.role) &&
      can({ ...ctx, grants: [g] }, 'approval:decide', target),
  );
}

/** Utilisateurs actifs pouvant décider pour un domaine sur ce SIA (destinataires des notifications). */
async function domainDeciders(db: Db, s: SystemRow, domain: ApprovalDomain) {
  const users = await db.user.findMany({
    where: { isActive: true, roleAssignments: { some: { role: { key: { in: DOMAIN_ROLES[domain] } } } } },
    select: { id: true },
  });
  const out: string[] = [];
  for (const u of users) {
    const ctx = await loadAccessContext(db as never, u.id);
    if (ctx && canDecide(ctx, s, { domain, approverId: null })) out.push(u.id);
  }
  return out;
}

export const workflowRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;
  const tags = ['Validations, revues, collaboration'];

  const approvalOut = (
    a: Prisma.ApprovalGetPayload<object>,
    names: Map<string, string>,
    ctx?: AccessContext,
    s?: SystemRow,
  ) => ({
    id: a.id,
    aiSystemId: a.aiSystemId,
    entityVersion: a.entityVersion,
    domain: a.domain,
    status: a.status,
    requestedBy: names.get(a.requestedById) ?? null,
    requestedById: a.requestedById,
    approver: a.approverId ? (names.get(a.approverId) ?? null) : null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    comment: a.comment,
    createdAt: a.createdAt.toISOString(),
    ...(ctx && s
      ? { canDecide: a.status === 'PENDING' && a.requestedById !== ctx.user.id && canDecide(ctx, s, a) }
      : {}),
  });

  // ── Validation par domaine ──
  app.get(
    '/ai-systems/:sid/approvals',
    {
      schema: {
        tags,
        summary: 'Circuit de validation du SIA (version courante et historique)',
        params: z.object({ sid: id }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system } = await loadVisible(prisma, ctx, request.params.sid);
      const list = await prisma.approval.findMany({ where: { aiSystemId: system.id }, orderBy: { createdAt: 'desc' } });
      const names = await namesFor(
        prisma,
        list.flatMap((a) => [a.requestedById, a.approverId]),
      );
      const current = latestPerDomain(
        list.filter((a) => a.entityVersion === system.version && a.status !== 'CANCELLED'),
      );
      return {
        version: system.version,
        lockedVersion: system.lockedVersion,
        validatedAt: system.validatedAt?.toISOString() ?? null,
        state:
          system.lockedVersion === system.version
            ? 'VALIDATED'
            : current.some((a) => a.status === 'REJECTED')
              ? 'REJECTED'
              : current.length
                ? 'PENDING'
                : system.lockedVersion
                  ? 'MODIFIED_SINCE_VALIDATION'
                  : 'NOT_REQUESTED',
        items: list.map((a) => approvalOut(a, names, ctx, system)),
        canRequest: !system.archivedAt && can(ctx, 'aiSystem:update', targetOf(system, [])),
      };
    },
  );

  app.post(
    '/ai-systems/:sid/validation-requests',
    {
      schema: {
        tags,
        summary: 'Demander la validation de la version courante par domaine',
        params: z.object({ sid: id }),
        body: validationRequestSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const b = request.body;
      await prisma.$transaction(async (tx) => {
        const { system } = await loadVisible(tx, ctx, request.params.sid);
        if (system.archivedAt) throw conflict('SIA archivé');
        if (!can(ctx, 'aiSystem:update', targetOf(system, [])))
          throw forbidden('Seuls le propriétaire du SIA et les rôles de gouvernance peuvent demander une validation');
        if (system.lockedVersion === system.version) throw conflict('La version courante est déjà validée');
        for (const uid of Object.values(b.approvers)) await requireActiveUser(tx, uid, 'Approbateur');
        // Les demandes encore en attente sur des versions antérieures sont annulées.
        await tx.approval.updateMany({
          where: { aiSystemId: system.id, status: 'PENDING' },
          data: { status: 'CANCELLED', comment: 'Remplacée par une nouvelle demande' },
        });
        for (const domain of b.domains) {
          const approverId = b.approvers[domain] ?? null;
          const a = await tx.approval.create({
            data: {
              aiSystemId: system.id,
              entityType: 'AiSystem',
              entityId: system.id,
              entityVersion: system.version,
              domain,
              requestedById: ctx.user.id,
              approverId,
              comment: '',
            },
          });
          const recipients = approverId ? [approverId] : await domainDeciders(tx, system, domain);
          await notify(
            tx,
            recipients,
            {
              type: 'approval',
              title: `Validation ${APPROVAL_DOMAIN_LABELS[domain]} demandée — ${system.reference}`,
              body: b.comment || `Version ${system.version} de « ${system.name} ».`,
              link: `/systemes/${system.id}?onglet=validation`,
            },
            ctx.user.id,
          );
          await recordAudit(tx, actorOf(request), {
            action: 'request_validation',
            entityType: 'Approval',
            entityId: a.id,
            aiSystemId: system.id,
            justification: b.comment || null,
            changes: { domain: { old: null, new: domain }, version: { old: null, new: system.version } },
          });
        }
      });
      return reply.status(201).send({ ok: true });
    },
  );

  app.post(
    '/approvals/:aid/decide',
    {
      schema: {
        tags,
        summary: 'Approuver ou rejeter (motif obligatoire en cas de rejet ; demandeur ≠ décideur)',
        params: z.object({ aid: id }),
        body: approvalDecisionSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'approval:decide');
      const result = await prisma.$transaction(async (tx) => {
        const a = await tx.approval.findUnique({ where: { id: request.params.aid } });
        if (!a) throw notFound();
        const { system } = await loadVisible(tx, ctx, a.aiSystemId).catch(() => {
          throw notFound();
        });
        if (a.status !== 'PENDING') throw conflict('Demande déjà traitée ou annulée');
        if (!canDecide(ctx, system, a))
          throw forbidden(`Vous n’êtes pas habilité pour le domaine ${APPROVAL_DOMAIN_LABELS[a.domain]}`);
        if (a.requestedById === ctx.user.id) throw forbidden('Le demandeur ne peut pas valider sa propre demande');
        if (system.version !== a.entityVersion)
          throw conflict(
            'La fiche a été modifiée depuis la demande : une nouvelle demande de validation est nécessaire',
          );
        const { decision, comment } = request.body;
        await tx.approval.update({
          where: { id: a.id },
          data: { status: decision, approverId: ctx.user.id, decidedAt: new Date(), comment },
        });
        await recordAudit(tx, actorOf(request), {
          action: decision === 'APPROVED' ? 'approve' : 'reject',
          entityType: 'Approval',
          entityId: a.id,
          aiSystemId: system.id,
          justification: comment || null,
          changes: { [a.domain]: { old: 'PENDING', new: decision } },
        });
        const siblings = latestPerDomain(
          await tx.approval.findMany({
            where: { aiSystemId: system.id, entityVersion: a.entityVersion, status: { not: 'CANCELLED' } },
          }),
        );
        let validated = false;
        if (siblings.every((x) => x.status === 'APPROVED')) {
          // Toutes les validations requises sont obtenues : la version est validée (verrouillée).
          await tx.aiSystem.update({
            where: { id: system.id },
            data: { lockedVersion: a.entityVersion, validatedAt: new Date() },
          });
          await recordAudit(tx, actorOf(request), {
            action: 'validate_system',
            entityType: 'AiSystem',
            entityId: system.id,
            aiSystemId: system.id,
            changes: { lockedVersion: { old: system.lockedVersion, new: a.entityVersion } },
          });
          validated = true;
        }
        await notify(
          tx,
          [a.requestedById, system.ownerId],
          {
            type: 'approval',
            title: `${decision === 'APPROVED' ? 'Validation' : 'Rejet'} ${APPROVAL_DOMAIN_LABELS[a.domain]} — ${system.reference}`,
            body: validated ? 'Toutes les validations sont obtenues : version validée.' : comment,
            link: `/systemes/${system.id}?onglet=validation`,
          },
          ctx.user.id,
        );
        return { validated };
      });
      return result;
    },
  );

  app.get(
    '/approvals',
    { schema: { tags, summary: 'Validations en attente que je peux décider' } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const pending = await prisma.approval.findMany({
        where: { status: 'PENDING', aiSystem: { AND: [scopeWhere(ctx), { archivedAt: null }] } },
        include: { aiSystem: { include: systemInclude } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      const mine = pending.filter((a) => a.requestedById !== ctx.user.id && canDecide(ctx, a.aiSystem, a));
      const names = await namesFor(
        prisma,
        mine.flatMap((a) => [a.requestedById, a.approverId]),
      );
      return {
        items: mine.map((a) => ({
          ...approvalOut(a, names),
          aiSystem: {
            id: a.aiSystem.id,
            reference: a.aiSystem.reference,
            name: a.aiSystem.name,
            isDemo: a.aiSystem.isDemo,
          },
          stale: a.aiSystem.version !== a.entityVersion,
        })),
      };
    },
  );

  // ── Revues ──
  const reviewOut = (r: Prisma.ReviewGetPayload<object>, names: Map<string, string>) => ({
    id: r.id,
    aiSystemId: r.aiSystemId,
    kind: r.kind,
    trigger: r.trigger,
    status: r.status,
    dueDate: dayOf(r.dueDate),
    overdue: (r.status === 'PLANNED' || r.status === 'IN_PROGRESS') && dayOf(r.dueDate)! < today(),
    reviewer: r.reviewerId ? { id: r.reviewerId, displayName: names.get(r.reviewerId) ?? '—' } : null,
    completedAt: r.completedAt?.toISOString() ?? null,
    outcome: r.outcome,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  });

  app.get(
    '/ai-systems/:sid/reviews',
    { schema: { tags, summary: 'Revues du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      const list = await prisma.review.findMany({ where: { aiSystemId: system.id }, orderBy: { dueDate: 'desc' } });
      const names = await namesFor(
        prisma,
        list.map((r) => r.reviewerId),
      );
      const intervals = await reviewIntervals(prisma);
      return {
        items: list.map((r) => reviewOut(r, names)),
        nextReviewDate: dayOf(system.nextReviewDate),
        lastReviewDate: dayOf(system.lastReviewDate),
        intervalMonths: intervalFor(intervals, system.riskCategory),
        canManage: !system.archivedAt && can(ctx, 'review:manage', targetOf(system, sections)),
        reviewerIds: list.filter((r) => r.reviewerId === ctx.user.id).map((r) => r.id),
      };
    },
  );

  app.get(
    '/reviews',
    {
      schema: {
        tags,
        summary: 'Revues ouvertes du périmètre',
        querystring: z.object({
          overdue: z.enum(['true', 'false']).default('false'),
          mine: z.enum(['true', 'false']).default('false'),
        }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const where: Prisma.ReviewWhereInput = {
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        aiSystem: { AND: [scopeWhere(ctx), { archivedAt: null }] },
        ...(request.query.overdue === 'true' ? { dueDate: { lt: new Date(`${today()}T00:00:00Z`) } } : {}),
        ...(request.query.mine === 'true' ? { reviewerId: ctx.user.id } : {}),
      };
      const list = await prisma.review.findMany({
        where,
        include: { aiSystem: { select: { id: true, reference: true, name: true, isDemo: true } } },
        orderBy: { dueDate: 'asc' },
        take: 500,
      });
      const names = await namesFor(
        prisma,
        list.map((r) => r.reviewerId),
      );
      return { items: list.map((r) => ({ ...reviewOut(r, names), aiSystem: r.aiSystem })) };
    },
  );

  app.post(
    '/ai-systems/:sid/reviews',
    {
      schema: {
        tags,
        summary: 'Planifier une revue (review:manage)',
        params: z.object({ sid: id }),
        body: reviewCreateSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const b = request.body;
      const r = await prisma.$transaction(async (tx) => {
        const { system, sections } = await loadVisible(tx, ctx, request.params.sid);
        if (system.archivedAt) throw conflict('SIA archivé');
        if (!can(ctx, 'review:manage', targetOf(system, sections)))
          throw forbidden('Droit de gestion des revues requis');
        await requireActiveUser(tx, b.reviewerId, 'Réviseur');
        const r = await tx.review.create({
          data: {
            ...b,
            aiSystemId: system.id,
            dueDate: new Date(`${b.dueDate}T00:00:00Z`),
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'Review',
          entityId: r.id,
          aiSystemId: system.id,
          changes: {
            kind: { old: null, new: b.kind },
            trigger: { old: null, new: b.trigger },
            dueDate: { old: null, new: b.dueDate },
          },
        });
        await notify(
          tx,
          [b.reviewerId ?? system.ownerId],
          {
            type: 'review',
            title: `Revue à réaliser — ${system.reference}`,
            body: `Échéance : ${b.dueDate}`,
            link: `/systemes/${system.id}?onglet=validation`,
          },
          ctx.user.id,
        );
        return r;
      });
      return reply.status(201).send(reviewOut(r, await namesFor(prisma, [r.reviewerId])));
    },
  );

  async function loadReview(tx: Tx, ctx: AccessContext, rid: string) {
    const r = await tx.review.findUnique({ where: { id: rid } });
    if (!r) throw notFound();
    const { system, sections } = await loadVisible(tx, ctx, r.aiSystemId).catch(() => {
      throw notFound();
    });
    if (system.archivedAt) throw conflict('SIA archivé');
    const manage = can(ctx, 'review:manage', targetOf(system, sections));
    return { r, system, manage };
  }

  app.patch(
    '/reviews/:rid',
    {
      schema: { tags, summary: 'Modifier une revue ouverte', params: z.object({ rid: id }), body: reviewUpdateSchema },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const b = request.body;
      const r = await prisma.$transaction(async (tx) => {
        const { r, system, manage } = await loadReview(tx, ctx, request.params.rid);
        const isReviewer = r.reviewerId === ctx.user.id;
        const onlyProgress = Object.keys(b).every((k) => k === 'status' || k === 'notes') && b.status !== 'CANCELLED';
        if (!manage && !(isReviewer && onlyProgress)) throw forbidden();
        if (r.status === 'COMPLETED' || r.status === 'CANCELLED') throw conflict('Revue clôturée');
        await requireActiveUser(tx, b.reviewerId, 'Réviseur');
        const u = await tx.review.update({
          where: { id: r.id },
          data: { ...b, dueDate: b.dueDate ? new Date(`${b.dueDate}T00:00:00Z`) : undefined, updatedById: ctx.user.id },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'Review',
          entityId: r.id,
          aiSystemId: system.id,
          changes: Object.fromEntries(
            Object.entries(b).map(([k, v]) => [k, { old: (r as Record<string, unknown>)[k] ?? null, new: v }]),
          ),
        });
        if (b.reviewerId && b.reviewerId !== r.reviewerId)
          await notify(
            tx,
            [b.reviewerId],
            {
              type: 'review',
              title: `Revue à réaliser — ${system.reference}`,
              body: `Échéance : ${dayOf(u.dueDate)}`,
              link: `/systemes/${system.id}?onglet=validation`,
            },
            ctx.user.id,
          );
        return u;
      });
      return reviewOut(r, await namesFor(prisma, [r.reviewerId]));
    },
  );

  app.post(
    '/reviews/:rid/complete',
    {
      schema: {
        tags,
        summary: 'Clôturer une revue : conclusion obligatoire, prochaine revue recalculée',
        params: z.object({ rid: id }),
        body: reviewCompleteSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const r = await prisma.$transaction(async (tx) => {
        const { r, system, manage } = await loadReview(tx, ctx, request.params.rid);
        if (!manage && r.reviewerId !== ctx.user.id)
          throw forbidden('Seuls le réviseur désigné et les gestionnaires de revues peuvent clôturer');
        if (r.status === 'COMPLETED' || r.status === 'CANCELLED') throw conflict('Revue déjà clôturée');
        const day = today();
        const next = addMonths(day, intervalFor(await reviewIntervals(tx), system.riskCategory));
        const u = await tx.review.update({
          where: { id: r.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            outcome: request.body.outcome,
            notes: request.body.notes ?? r.notes,
            reviewerId: r.reviewerId ?? ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        // Date de revue : champs dérivés, sans incrément de version (pas de modification du contenu de la fiche).
        await tx.aiSystem.update({
          where: { id: system.id },
          data: { lastReviewDate: new Date(`${day}T00:00:00Z`), nextReviewDate: new Date(`${next}T00:00:00Z`) },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'complete_review',
          entityType: 'Review',
          entityId: r.id,
          aiSystemId: system.id,
          justification: request.body.outcome,
          changes: {
            status: { old: r.status, new: 'COMPLETED' },
            nextReviewDate: { old: dayOf(system.nextReviewDate), new: next },
          },
        });
        return u;
      });
      return reviewOut(r, await namesFor(prisma, [r.reviewerId]));
    },
  );

  app.get(
    '/settings/review-intervals',
    { schema: { tags, summary: 'Périodicité des revues par catégorie AI Act' } },
    async (request) => {
      requirePermission(request, 'aiSystem:read');
      return reviewIntervals(prisma);
    },
  );
  app.put(
    '/settings/review-intervals',
    { schema: { tags, summary: 'Modifier la périodicité des revues (settings:manage)', body: reviewIntervalsSchema } },
    async (request) => {
      const ctx = requirePermission(request, 'settings:manage');
      await prisma.$transaction(async (tx) => {
        const before = await reviewIntervals(tx);
        await tx.appSetting.upsert({
          where: { key: SETTINGS_KEY },
          update: { value: request.body, updatedById: ctx.user.id },
          create: { key: SETTINGS_KEY, value: request.body, updatedById: ctx.user.id },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'AppSetting',
          changes: { [SETTINGS_KEY]: { old: before, new: request.body } },
        });
      });
      return reviewIntervals(prisma);
    },
  );

  // ── Commentaires internes ──
  app.get(
    '/ai-systems/:sid/comments',
    {
      schema: {
        tags,
        summary: 'Commentaires internes du SIA',
        params: z.object({ sid: id }),
        querystring: z.object({ section: z.string().max(40).optional() }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system } = await loadVisible(prisma, ctx, request.params.sid);
      const list = await prisma.comment.findMany({
        where: { aiSystemId: system.id, ...(request.query.section ? { section: request.query.section } : {}) },
        orderBy: { createdAt: 'asc' },
      });
      const names = await namesFor(
        prisma,
        list.flatMap((c) => [c.authorId, ...c.mentions]),
      );
      return {
        items: list.map((c) => ({
          id: c.id,
          section: c.section,
          body: c.body,
          author: names.get(c.authorId) ?? '—',
          authorId: c.authorId,
          mentions: c.mentions.map((m) => ({ id: m, displayName: names.get(m) ?? '—' })),
          resolvedAt: c.resolvedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        })),
        canWrite: !system.archivedAt && can(ctx, 'comment:write', targetOf(system, [])),
      };
    },
  );

  app.post(
    '/ai-systems/:sid/comments',
    {
      schema: {
        tags,
        summary: 'Commenter (mentions notifiées)',
        params: z.object({ sid: id }),
        body: commentCreateSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'comment:write');
      const b = request.body;
      await prisma.$transaction(async (tx) => {
        const { system } = await loadVisible(tx, ctx, request.params.sid);
        if (system.archivedAt) throw conflict('SIA archivé');
        if (!can(ctx, 'comment:write', targetOf(system, []))) throw forbidden();
        const mentions = [...new Set(b.mentions)];
        // Une mention ne doit pas révéler le SIA à quelqu'un qui ne peut pas le lire.
        for (const uid of mentions) {
          const mctx = await loadAccessContext(tx as never, uid);
          if (!mctx || !can(mctx, 'aiSystem:read', targetOf(system, [])))
            throw badRequest('Personne mentionnée inconnue ou sans accès à ce SIA');
        }
        const c = await tx.comment.create({
          data: {
            entityType: 'AiSystem',
            entityId: system.id,
            aiSystemId: system.id,
            section: b.section,
            body: b.body,
            mentions,
            authorId: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'comment',
          entityType: 'Comment',
          entityId: c.id,
          aiSystemId: system.id,
          changes: { section: { old: null, new: b.section }, mentions: { old: null, new: mentions } },
        });
        await notify(
          tx,
          mentions,
          {
            type: 'mention',
            title: `${ctx.user.displayName} vous a mentionné — ${system.reference}`,
            body: b.body.slice(0, 300),
            link: `/systemes/${system.id}?onglet=commentaires`,
          },
          ctx.user.id,
        );
      });
      return reply.status(201).send({ ok: true });
    },
  );

  app.post(
    '/comments/:cid/resolve',
    { schema: { tags, summary: 'Marquer un commentaire comme traité', params: z.object({ cid: id }) } },
    async (request, reply) => {
      const ctx = requirePermission(request, 'comment:write');
      await prisma.$transaction(async (tx) => {
        const c = await tx.comment.findUnique({ where: { id: request.params.cid } });
        if (!c || !c.aiSystemId) throw notFound();
        const { system } = await loadVisible(tx, ctx, c.aiSystemId).catch(() => {
          throw notFound();
        });
        if (!can(ctx, 'comment:write', targetOf(system, []))) throw forbidden();
        if (c.resolvedAt) throw conflict('Déjà traité');
        await tx.comment.update({ where: { id: c.id }, data: { resolvedAt: new Date() } });
        await recordAudit(tx, actorOf(request), {
          action: 'resolve',
          entityType: 'Comment',
          entityId: c.id,
          aiSystemId: system.id,
        });
      });
      return reply.status(204).send();
    },
  );

  // ── Notifications in-app ──
  app.get(
    '/notifications',
    {
      schema: {
        tags,
        summary: 'Mes notifications',
        querystring: z.object({ unread: z.enum(['true', 'false']).default('false') }),
      },
    },
    async (request) => {
      const ctx = requireAuth(request);
      const where = { userId: ctx.user.id, ...(request.query.unread === 'true' ? { readAt: null } : {}) };
      const [items, unread] = await Promise.all([
        prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
      ]);
      return {
        unread,
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );
  app.post(
    '/notifications/read',
    {
      schema: {
        tags,
        summary: 'Marquer comme lues (toutes si ids absent)',
        body: z.strictObject({ ids: z.array(id).max(200).optional() }),
      },
    },
    async (request) => {
      const ctx = requireAuth(request);
      const r = await prisma.notification.updateMany({
        where: { userId: ctx.user.id, readAt: null, ...(request.body.ids ? { id: { in: request.body.ids } } : {}) },
        data: { readAt: new Date() },
      });
      return { updated: r.count };
    },
  );

  // ── Versions : comparaison et restauration ──
  app.get(
    '/ai-systems/:sid/versions',
    { schema: { tags, summary: 'Versions enregistrées du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system } = await loadVisible(prisma, ctx, request.params.sid);
      const list = await prisma.entityVersion.findMany({
        where: { entityType: 'AiSystem', entityId: system.id },
        orderBy: { version: 'desc' },
        select: { version: true, reason: true, createdAt: true, createdById: true },
      });
      const names = await namesFor(
        prisma,
        list.map((v) => v.createdById),
      );
      return {
        current: system.version,
        lockedVersion: system.lockedVersion,
        items: list.map((v) => ({
          version: v.version,
          reason: v.reason,
          createdAt: v.createdAt.toISOString(),
          createdBy: v.createdById ? (names.get(v.createdById) ?? null) : null,
        })),
        canRestore: !system.archivedAt && can(ctx, 'aiSystem:update', targetOf(system, [])),
      };
    },
  );

  async function versionSnapshot(db: Db, systemId: string, version: number) {
    const v = await db.entityVersion.findUnique({
      where: { entityType_entityId_version: { entityType: 'AiSystem', entityId: systemId, version } },
    });
    if (!v) throw notFound(`Version ${version} introuvable`);
    return v.snapshot as Record<string, unknown>;
  }
  const LINK_KEYS = [
    'tagIds',
    'vendors',
    'models',
    'stakeholders',
    'assets',
    'processing',
    'datasets',
    'dataCategoryIds',
    'dataSubjects',
  ];

  app.get(
    '/ai-systems/:sid/versions/compare',
    {
      schema: {
        tags,
        summary: 'Comparer deux versions (champs et liens)',
        params: z.object({ sid: id }),
        querystring: z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system } = await loadVisible(prisma, ctx, request.params.sid);
      const a = await versionSnapshot(prisma, system.id, request.query.from);
      const b = await versionSnapshot(prisma, system.id, request.query.to);
      const fields = [...TRACKED_FIELDS, 'riskCategory', 'complianceStatus', ...LINK_KEYS];
      const changes = fields
        .filter((f) => JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null))
        .map((f) => ({ field: f, from: a[f] ?? null, to: b[f] ?? null, isLink: LINK_KEYS.includes(f) }));
      return { from: request.query.from, to: request.query.to, changes };
    },
  );

  app.post(
    '/ai-systems/:sid/versions/:v/restore',
    {
      schema: {
        tags,
        summary: 'Restaurer les champs d’une version (les liens ne sont pas restaurés) — crée une nouvelle version',
        params: z.object({ sid: id, v: z.coerce.number().int().min(1) }),
        body: z.strictObject({ reason: z.string().trim().min(10).max(2000) }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const out = await prisma.$transaction(async (tx) => {
        const { system } = await loadVisible(tx, ctx, request.params.sid);
        if (system.archivedAt) throw conflict('SIA archivé');
        if (!can(ctx, 'aiSystem:update', targetOf(system, [])))
          throw forbidden('Restauration réservée au propriétaire et aux rôles de gouvernance');
        if (request.params.v >= system.version) throw badRequest('Choisissez une version antérieure');
        const snap = await versionSnapshot(tx, system.id, request.params.v);
        const restorable = TRACKED_FIELDS.filter((f) => !['reference', 'archivedAt', 'archiveReason'].includes(f));
        const DATE_FIELDS = new Set([
          'firstDeploymentDate',
          'productionDate',
          'plannedRetirementDate',
          'actualRetirementDate',
          'nextReviewDate',
        ]);
        const data: Record<string, unknown> = {};
        for (const f of restorable) {
          if (!(f in snap)) continue;
          const v = snap[f];
          data[f] = DATE_FIELDS.has(f) ? (v ? new Date(v as string) : null) : v;
        }
        // Unité et propriétaire restaurés seulement s'ils existent encore et restent valides.
        if (
          data.orgUnitId &&
          !(await tx.organizationUnit.findFirst({ where: { id: data.orgUnitId as string, isActive: true } }))
        )
          delete data.orgUnitId;
        for (const k of ['ownerId', 'businessOwnerId'] as const)
          if (data[k] && !(await tx.user.findFirst({ where: { id: data[k] as string, isActive: true } })))
            delete data[k];
        const before = system as unknown as Record<string, unknown>;
        await tx.aiSystem.update({
          where: { id: system.id },
          data: {
            ...(data as Prisma.AiSystemUncheckedUpdateInput),
            version: { increment: 1 },
            updatedById: ctx.user.id,
          },
        });
        const after = await refreshCompleteness(tx, system.id);
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const f of Object.keys(data)) {
          const o = before[f] instanceof Date ? (before[f] as Date).toISOString() : before[f];
          const n = (after as unknown as Record<string, unknown>)[f];
          const nn = n instanceof Date ? n.toISOString() : n;
          if (JSON.stringify(o ?? null) !== JSON.stringify(nn ?? null))
            changes[f] = { old: o ?? null, new: nn ?? null };
        }
        await snapshot(tx, after, ctx.user.id, `restauration de la version ${request.params.v}`);
        await recordAudit(tx, actorOf(request), {
          action: 'restore_version',
          entityType: 'AiSystem',
          entityId: system.id,
          aiSystemId: system.id,
          justification: request.body.reason,
          changes,
        });
        return { version: after.version, restoredFields: Object.keys(changes) };
      });
      return out;
    },
  );
};
