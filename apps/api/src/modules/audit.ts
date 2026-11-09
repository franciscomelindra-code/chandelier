import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { paginationSchema } from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { actorOf, requirePermission } from '../http.js';

const eventOut = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorId: z.string().nullable(),
  actorLabel: z.string(),
  origin: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  aiSystemId: z.string().nullable(),
  changes: z.unknown(),
  justification: z.string().nullable(),
  requestId: z.string().nullable(),
});

const filters = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

function whereOf(q: z.infer<typeof filters>): Prisma.AuditEventWhereInput {
  return {
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.from || q.to
      ? {
          occurredAt: {
            ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
            ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
  };
}

/** Échappement CSV + neutralisation des formules (injection CSV dans Excel). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  app.get(
    '/',
    {
      schema: {
        tags: ['Journal d’audit'],
        summary: 'Consulter le journal d’audit',
        querystring: paginationSchema.extend(filters.shape),
        response: {
          200: z.object({ items: z.array(eventOut), total: z.number(), page: z.number(), pageSize: z.number() }),
        },
      },
    },
    async (request) => {
      requirePermission(request, 'audit:read');
      const { page, pageSize, ...q } = request.query;
      const where = whereOf(q);
      const [items, total] = await prisma.$transaction([
        prisma.auditEvent.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.auditEvent.count({ where }),
      ]);
      return {
        items: items.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString(), changes: e.changes })),
        total,
        page,
        pageSize,
      };
    },
  );

  app.get(
    '/export.csv',
    {
      schema: {
        tags: ['Journal d’audit'],
        summary: 'Exporter le journal filtré en CSV (50 000 lignes max.)',
        querystring: filters,
      },
    },
    async (request, reply) => {
      requirePermission(request, 'audit:read');
      const where = whereOf(request.query);
      const rows = await prisma.auditEvent.findMany({ where, orderBy: { occurredAt: 'desc' }, take: 50_000 });
      await prisma.$transaction((tx) =>
        recordAudit(tx, actorOf(request), {
          action: 'export',
          entityType: 'AuditEvent',
          changes: { filters: { old: null, new: request.query }, rows: { old: null, new: rows.length } },
        }),
      );
      const header = [
        'occurredAt',
        'actorLabel',
        'origin',
        'action',
        'entityType',
        'entityId',
        'aiSystemId',
        'changes',
        'justification',
        'requestId',
      ];
      const lines = [header.map(csvCell).join(';')];
      for (const r of rows) {
        lines.push(
          [
            r.occurredAt.toISOString(),
            r.actorLabel,
            r.origin,
            r.action,
            r.entityType,
            r.entityId,
            r.aiSystemId,
            r.changes,
            r.justification,
            r.requestId,
          ]
            .map(csvCell)
            .join(';'),
        );
      }
      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="chandelier-audit-${stamp}.csv"`)
        .send(`\uFEFF${lines.join('\r\n')}`);
    },
  );
};
