import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { orgUnitCreateSchema, orgUnitUpdateSchema } from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { diff, recordAudit } from '../audit/audit.js';
import { badRequest, notFound } from '../errors.js';
import { actorOf, requireAuth, requirePermission } from '../http.js';

type Tx = Prisma.TransactionClient;

const unitOut = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  path: z.string(),
  depth: z.number(),
  isActive: z.boolean(),
  isDemo: z.boolean(),
  userCount: z.number(),
  aiSystemCount: z.number(),
});

type UnitRow = Prisma.OrganizationUnitGetPayload<{
  include: { _count: { select: { users: true; aiSystems: true } } };
}>;

const serialize = (u: UnitRow): z.infer<typeof unitOut> => ({
  id: u.id,
  code: u.code,
  name: u.name,
  type: u.type,
  parentId: u.parentId,
  path: u.path,
  depth: u.path.split('/').filter(Boolean).length - 1,
  isActive: u.isActive,
  isDemo: u.isDemo,
  userCount: u._count.users,
  aiSystemCount: u._count.aiSystems,
});

const withCounts = { _count: { select: { users: true, aiSystems: true } } } as const;

async function parentPath(tx: Tx, parentId: string | null | undefined): Promise<string> {
  if (!parentId) return '/';
  const parent = await tx.organizationUnit.findUnique({ where: { id: parentId } });
  if (!parent) throw badRequest('Unité parente inconnue');
  return parent.path;
}

export const orgUnitRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  app.get(
    '/',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Arborescence des unités organisationnelles (liste ordonnée par chemin)',
        querystring: z.object({ includeInactive: z.enum(['true', 'false']).optional() }),
        response: { 200: z.object({ items: z.array(unitOut) }) },
      },
    },
    async (request) => {
      requireAuth(request);
      const units = await prisma.organizationUnit.findMany({
        where: request.query.includeInactive === 'true' ? {} : { isActive: true },
        include: withCounts,
      });
      // Tri arborescent : par chaîne de noms des ancêtres.
      const byId = new Map(units.map((u) => [u.id, u]));
      const sortKey = (u: UnitRow) =>
        u.path
          .split('/')
          .filter(Boolean)
          .map((id) => byId.get(id)?.name.toLocaleLowerCase('fr') ?? id)
          .join('\u0000');
      units.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'fr'));
      return { items: units.map(serialize) };
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Créer une unité',
        body: orgUnitCreateSchema,
        response: { 201: unitOut },
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'orgUnit:manage');
      const input = request.body;
      const created = await prisma.$transaction(async (tx) => {
        const base = await parentPath(tx, input.parentId);
        const id = crypto.randomUUID();
        const unit = await tx.organizationUnit.create({
          data: {
            id,
            code: input.code,
            name: input.name,
            type: input.type,
            parentId: input.parentId ?? null,
            path: `${base}${id}/`,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
          include: withCounts,
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'OrganizationUnit',
          entityId: unit.id,
          changes: diff(null, unit, ['code', 'name', 'type', 'parentId']),
        });
        return unit;
      });
      return reply.status(201).send(serialize(created));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Modifier, déplacer ou désactiver une unité (pas de suppression physique)',
        params: z.object({ id: z.uuid() }),
        body: orgUnitUpdateSchema,
        response: { 200: unitOut },
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'orgUnit:manage');
      const { id } = request.params;
      const input = request.body;
      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.organizationUnit.findUnique({ where: { id } });
        if (!before) throw notFound();
        let newPath = before.path;
        if (input.parentId !== undefined && input.parentId !== before.parentId) {
          if (input.parentId === id) throw badRequest('Une unité ne peut pas être son propre parent');
          const base = await parentPath(tx, input.parentId);
          if (base.startsWith(before.path)) throw badRequest('Déplacement impossible : cycle dans l’arborescence');
          newPath = `${base}${id}/`;
          // Recalcul du chemin de tout le sous-arbre.
          await tx.$executeRaw`
            UPDATE "organization_unit"
            SET "path" = ${newPath}::text || substring("path" from ${before.path.length + 1}::int)
            WHERE "path" LIKE ${before.path + '%'}::text AND "id" <> ${id}::uuid`;
        }
        const after = await tx.organizationUnit.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            path: newPath,
            updatedById: ctx.user.id,
          },
          include: withCounts,
        });
        const changes = diff(before, after, ['name', 'type', 'parentId', 'isActive', 'path']);
        if (Object.keys(changes).length) {
          await recordAudit(tx, actorOf(request), {
            action: input.isActive === false ? 'deactivate' : 'update',
            entityType: 'OrganizationUnit',
            entityId: id,
            changes,
          });
        }
        return after;
      });
      return serialize(updated);
    },
  );
};
