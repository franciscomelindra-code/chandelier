import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ASSIGNEE_FIELDS,
  actionCreateSchema,
  actionListQuerySchema,
  actionUpdateSchema,
  isOverdue,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, type AccessContext } from '../rbac/access.js';
import { loadVisible, scopeWhere, targetOf, type SystemRow } from './ai-systems/service.js';
import { dayOf, namesFor, nextSeqReference, requireActiveUser, toDate, today, type Db } from './common.js';

const id = z.uuid();

const actionInclude = {
  aiSystem: {
    select: {
      id: true,
      reference: true,
      name: true,
      isDemo: true,
      ownerId: true,
      archivedAt: true,
      orgUnit: { select: { path: true } },
    },
  },
  risk: { select: { id: true, reference: true, title: true } },
  obligation: { select: { id: true, templateKey: true, title: true } },
  measure: { select: { id: true, title: true } },
} satisfies Prisma.ActionInclude;
type ActionRow = Prisma.ActionGetPayload<{ include: typeof actionInclude }>;

const PRIORITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;
const AUDITED = [
  'title',
  'description',
  'priority',
  'status',
  'assigneeId',
  'dueDate',
  'riskId',
  'obligationId',
  'measureId',
  'closureComment',
] as const;

function serialize(a: ActionRow, names: Map<string, string>, perms?: { canManage: boolean; canUpdateStatus: boolean }) {
  const dueDate = dayOf(a.dueDate);
  return {
    id: a.id,
    reference: a.reference,
    title: a.title,
    description: a.description,
    status: a.status,
    priority: a.priority,
    assignee: a.assigneeId ? { id: a.assigneeId, displayName: names.get(a.assigneeId) ?? '—' } : null,
    dueDate,
    overdue: isOverdue(a.status, dueDate, today()),
    completedAt: a.completedAt?.toISOString() ?? null,
    closureComment: a.closureComment,
    aiSystem: { id: a.aiSystem.id, reference: a.aiSystem.reference, name: a.aiSystem.name, isDemo: a.aiSystem.isDemo },
    risk: a.risk,
    obligation: a.obligation,
    measure: a.measure,
    origin: a.origin,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    createdBy: a.createdById ? (names.get(a.createdById) ?? null) : null,
    updatedAt: a.updatedAt.toISOString(),
    ...(perms ? { permissions: perms } : {}),
  };
}

const namesOf = (db: Db, rows: ActionRow[]) =>
  namesFor(
    db,
    rows.flatMap((a) => [a.assigneeId, a.createdById]),
  );

/** Les éléments liés doivent appartenir au même SIA. */
async function checkLinks(
  db: Db,
  aiSystemId: string,
  l: { riskId?: string | null; obligationId?: string | null; measureId?: string | null },
) {
  if (l.riskId) {
    const r = await db.risk.findUnique({ where: { id: l.riskId }, select: { aiSystemId: true } });
    if (!r || r.aiSystemId !== aiSystemId) throw badRequest('Risque inconnu pour ce SIA');
  }
  if (l.obligationId) {
    const o = await db.obligation.findUnique({ where: { id: l.obligationId }, select: { aiSystemId: true } });
    if (!o || o.aiSystemId !== aiSystemId) throw badRequest('Obligation inconnue pour ce SIA');
  }
  if (l.measureId) {
    const m = await db.measure.findUnique({ where: { id: l.measureId }, select: { aiSystemId: true } });
    if (!m || m.aiSystemId !== aiSystemId) throw badRequest('Mesure inconnue pour ce SIA');
  }
}

export const actionRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;
  const tags = ['Plans d’action'];

  const canManage = (ctx: AccessContext, s: SystemRow, sections: string[]) =>
    !s.archivedAt && can(ctx, 'action:manage', targetOf(s, sections));
  async function load(db: Db, ctx: AccessContext, actionId: string) {
    const a = await db.action.findUnique({ where: { id: actionId }, include: actionInclude });
    if (!a) throw notFound('Action introuvable');
    const { system, sections } = await loadVisible(db, ctx, a.aiSystemId).catch(() => {
      throw notFound('Action introuvable');
    });
    return { a, system, sections };
  }
  const permsOf = (ctx: AccessContext, s: SystemRow, sections: string[], a: { assigneeId: string | null }) => {
    const manage = canManage(ctx, s, sections);
    return { canManage: manage, canUpdateStatus: manage || (!s.archivedAt && a.assigneeId === ctx.user.id) };
  };
  // action:manage n'a pas de qualificatif « assigned » : les sections affectées sont sans effet ici.
  const listPerms = (ctx: AccessContext, a: ActionRow) => {
    const manage = !a.aiSystem.archivedAt && can(ctx, 'action:manage', targetOf(a.aiSystem, []));
    return { canManage: manage, canUpdateStatus: manage || (!a.aiSystem.archivedAt && a.assigneeId === ctx.user.id) };
  };
  async function out(db: Db, ctx: AccessContext, actionId: string) {
    const { a, system, sections } = await load(db, ctx, actionId);
    return serialize(a, await namesOf(db, [a]), permsOf(ctx, system, sections, a));
  }

  app.get(
    '/actions',
    {
      schema: {
        tags,
        summary: 'Actions du périmètre (filtres, échues, « mes actions »)',
        querystring: actionListQuerySchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const q = request.query;
      const and: Prisma.ActionWhereInput[] = [{ aiSystem: { AND: [scopeWhere(ctx), { archivedAt: null }] } }];
      if (q.aiSystemId) and.push({ aiSystemId: q.aiSystemId });
      if (q.riskId) and.push({ riskId: q.riskId });
      if (q.obligationId) and.push({ obligationId: q.obligationId });
      if (q.status) and.push({ status: { in: q.status } });
      if (q.priority) and.push({ priority: { in: q.priority } });
      if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
      if (q.mine === 'true') and.push({ assigneeId: ctx.user.id });
      if (q.overdue === 'true')
        and.push({ status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: new Date(`${today()}T00:00:00Z`) } });
      if (q.demo === 'exclude') and.push({ aiSystem: { isDemo: false } });
      if (q.demo === 'only') and.push({ aiSystem: { isDemo: true } });
      if (q.q)
        and.push({
          OR: [
            { reference: { contains: q.q, mode: 'insensitive' } },
            { title: { contains: q.q, mode: 'insensitive' } },
            { aiSystem: { name: { contains: q.q, mode: 'insensitive' } } },
            { aiSystem: { reference: { contains: q.q, mode: 'insensitive' } } },
          ],
        });
      const where = { AND: and };
      // La priorité est triée par rang métier (et non alphabétique) : tri en mémoire, plafond 5 000.
      const orderBy: Prisma.ActionOrderByWithRelationInput[] =
        q.sort === 'dueDate'
          ? [{ dueDate: { sort: q.dir, nulls: 'last' } }, { reference: 'asc' }]
          : q.sort === 'priority'
            ? [{ reference: 'asc' }]
            : [{ [q.sort]: q.dir }, { reference: 'asc' }];
      const [total, rows] = await Promise.all([
        prisma.action.count({ where }),
        q.sort === 'priority'
          ? prisma.action.findMany({ where, include: actionInclude, orderBy, take: 5000 })
          : prisma.action.findMany({
              where,
              include: actionInclude,
              orderBy,
              skip: (q.page - 1) * q.pageSize,
              take: q.pageSize,
            }),
      ]);
      let page = rows;
      if (q.sort === 'priority') {
        const dir = q.dir === 'asc' ? 1 : -1;
        page = [...rows]
          .sort((x, y) => (PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority]) * dir)
          .slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      }
      const names = await namesOf(prisma, page);
      const overdueCount = await prisma.action.count({
        where: {
          AND: [
            { aiSystem: { AND: [scopeWhere(ctx), { archivedAt: null }] } },
            { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: new Date(`${today()}T00:00:00Z`) } },
          ],
        },
      });
      return {
        items: page.map((a) => serialize(a, names, listPerms(ctx, a))),
        total,
        page: q.page,
        pageSize: q.pageSize,
        overdueCount,
      };
    },
  );

  app.get(
    '/ai-systems/:sid/actions',
    { schema: { tags, summary: 'Plan d’action du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      const rows = await prisma.action.findMany({
        where: { aiSystemId: system.id },
        include: actionInclude,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { reference: 'asc' }],
      });
      const names = await namesOf(prisma, rows);
      return {
        items: rows.map((a) => serialize(a, names, permsOf(ctx, system, sections, a))),
        permissions: { canManage: canManage(ctx, system, sections) },
      };
    },
  );

  app.get(
    '/actions/:aid',
    { schema: { tags, summary: 'Détail d’une action', params: z.object({ aid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      return out(prisma, ctx, request.params.aid);
    },
  );

  app.post(
    '/actions',
    {
      schema: {
        tags,
        summary: 'Créer une action (rattachée à un SIA, et éventuellement à un risque, une obligation, une mesure)',
        body: actionCreateSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { aiSystemId, ...b } = request.body;
      const created = await prisma.$transaction(async (tx) => {
        const { system, sections } = await loadVisible(tx, ctx, aiSystemId);
        if (!can(ctx, 'action:manage', targetOf(system, sections)))
          throw forbidden('Droit de gestion des actions requis sur ce SIA');
        if (system.archivedAt) throw conflict('SIA archivé');
        await requireActiveUser(tx, b.assigneeId, 'Responsable');
        await checkLinks(tx, system.id, b);
        const a = await tx.action.create({
          data: {
            ...b,
            aiSystemId: system.id,
            reference: await nextSeqReference(tx, 'action', 'ACT'),
            dueDate: toDate(b.dueDate),
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'Action',
          entityId: a.id,
          aiSystemId: system.id,
          changes: {
            reference: { old: null, new: a.reference },
            title: { old: null, new: a.title },
            assigneeId: { old: null, new: a.assigneeId },
            dueDate: { old: null, new: dayOf(a.dueDate) },
            riskId: { old: null, new: a.riskId },
            obligationId: { old: null, new: a.obligationId },
          },
        });
        return a.id;
      });
      return reply.status(201).send(await out(prisma, ctx, created));
    },
  );

  app.patch(
    '/actions/:aid',
    {
      schema: {
        tags,
        summary: 'Modifier une action (le responsable peut en changer le statut)',
        params: z.object({ aid: id }),
        body: actionUpdateSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { version, ...b } = request.body;
      await prisma.$transaction(async (tx) => {
        const { a, system, sections } = await load(tx, ctx, request.params.aid);
        if (system.archivedAt) throw conflict('SIA archivé');
        const manage = canManage(ctx, system, sections);
        if (!manage) {
          const isAssignee = a.assigneeId === ctx.user.id;
          const extra = Object.keys(request.body).filter((k) => !(ASSIGNEE_FIELDS as readonly string[]).includes(k));
          if (!isAssignee || extra.length)
            throw forbidden(
              isAssignee
                ? 'En tant que responsable de l’action, vous ne pouvez modifier que son statut'
                : 'Droit de gestion des actions requis sur ce SIA',
            );
        }
        if (a.version !== version) throw conflict('L’action a été modifiée par ailleurs : rechargez la page');
        await requireActiveUser(tx, b.assigneeId, 'Responsable');
        await checkLinks(tx, system.id, b);
        const status = b.status ?? a.status;
        const comment = (b.closureComment ?? a.closureComment).trim();
        if (status === 'CANCELLED' && a.status !== 'CANCELLED' && !comment)
          throw badRequest('Motif d’annulation obligatoire');
        const updated = await tx.action.update({
          where: { id: a.id },
          data: {
            ...b,
            dueDate: toDate(b.dueDate),
            ...(status === 'DONE' && a.status !== 'DONE' ? { completedAt: new Date() } : {}),
            ...(status !== 'DONE' && a.status === 'DONE' ? { completedAt: null } : {}),
            version: { increment: 1 },
            updatedById: ctx.user.id,
          },
        });
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const f of AUDITED) {
          const o = a[f] instanceof Date ? dayOf(a[f] as Date) : a[f];
          const n = updated[f] instanceof Date ? dayOf(updated[f] as Date) : updated[f];
          if ((o ?? null) !== (n ?? null)) changes[f] = { old: o ?? null, new: n ?? null };
        }
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'Action',
          entityId: a.id,
          aiSystemId: system.id,
          justification: status === 'CANCELLED' && a.status !== 'CANCELLED' ? comment : null,
          changes,
        });
      });
      return out(prisma, ctx, request.params.aid);
    },
  );
};
