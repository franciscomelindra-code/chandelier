import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { paginationSchema, userCreateSchema, userUpdateSchema, type RoleAssignmentInput } from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { diff, recordAudit } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { generatePassword, hashPassword } from '../auth/password.js';
import { hasPermission } from '../rbac/access.js';

type Tx = Prisma.TransactionClient;

const roleOut = z.object({
  roleKey: z.string(),
  roleLabel: z.string(),
  orgUnitId: z.string().nullable(),
  orgUnitName: z.string().nullable(),
  includeDescendants: z.boolean(),
});

const userOut = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  orgUnitId: z.string().nullable(),
  orgUnitName: z.string().nullable(),
  isActive: z.boolean(),
  authProvider: z.string(),
  lastLoginAt: z.string().nullable(),
  lockedUntil: z.string().nullable(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  /** Visible uniquement avec user:manage. */
  roles: z.array(roleOut).optional(),
});

const userInclude = {
  orgUnit: true,
  roleAssignments: { include: { role: true, orgUnit: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function serialize(u: UserWithRelations, withRoles: boolean): z.infer<typeof userOut> {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    orgUnitId: u.orgUnitId,
    orgUnitName: u.orgUnit?.name ?? null,
    isActive: u.isActive,
    authProvider: u.authProvider,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt.toISOString(),
    ...(withRoles
      ? {
          roles: u.roleAssignments.map((a) => ({
            roleKey: a.role.key,
            roleLabel: a.role.label,
            orgUnitId: a.orgUnitId,
            orgUnitName: a.orgUnit?.name ?? null,
            includeDescendants: a.includeDescendants,
          })),
        }
      : {}),
  };
}

const rolesSummary = (roles: RoleAssignmentInput[]) =>
  roles.map((r) => `${r.roleKey}@${r.orgUnitId ?? 'global'}${r.includeDescendants ? '+' : ''}`).sort();

async function replaceRoles(tx: Tx, userId: string, roles: RoleAssignmentInput[], actorId: string) {
  const keys = [...new Set(roles.map((r) => r.roleKey))];
  const dbRoles = await tx.role.findMany({ where: { key: { in: keys } } });
  if (dbRoles.length !== keys.length) throw badRequest('Rôle inconnu');
  const unitIds = [...new Set(roles.map((r) => r.orgUnitId).filter((v): v is string => !!v))];
  if (unitIds.length) {
    const n = await tx.organizationUnit.count({ where: { id: { in: unitIds } } });
    if (n !== unitIds.length) throw badRequest('Unité organisationnelle inconnue');
  }
  const seen = new Set<string>();
  for (const r of roles) {
    const k = `${r.roleKey}|${r.orgUnitId ?? ''}`;
    if (seen.has(k)) throw badRequest(`Affectation en double : ${r.roleKey}`);
    seen.add(k);
  }
  await tx.userRoleAssignment.deleteMany({ where: { userId } });
  for (const r of roles) {
    const role = dbRoles.find((d) => d.key === r.roleKey)!;
    await tx.userRoleAssignment.create({
      data: {
        userId,
        roleId: role.id,
        orgUnitId: r.orgUnitId,
        includeDescendants: r.includeDescendants,
        createdById: actorId,
      },
    });
  }
}

/** Garde-fou : il doit toujours rester au moins un SUPER_ADMIN global actif. */
async function assertSuperAdminRemains(tx: Tx) {
  const n = await tx.userRoleAssignment.count({
    where: { orgUnitId: null, role: { key: 'SUPER_ADMIN' }, user: { isActive: true } },
  });
  if (n === 0) throw conflict('Opération refusée : il doit rester au moins un super administrateur actif');
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  app.get(
    '/',
    {
      schema: {
        tags: ['Utilisateurs'],
        summary: 'Lister les utilisateurs',
        querystring: paginationSchema.extend({
          q: z.string().trim().max(100).optional(),
          includeInactive: z.enum(['true', 'false']).optional(),
        }),
        response: {
          200: z.object({ items: z.array(userOut), total: z.number(), page: z.number(), pageSize: z.number() }),
        },
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'user:read');
      const { page, pageSize, q, includeInactive } = request.query;
      const where: Prisma.UserWhereInput = {
        ...(includeInactive === 'true' ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { displayName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, total] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          include: userInclude,
          orderBy: { displayName: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.user.count({ where }),
      ]);
      const withRoles = hasPermission(ctx, 'user:manage');
      return { items: items.map((u) => serialize(u, withRoles)), total, page, pageSize };
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['Utilisateurs'],
        summary: 'Consulter un utilisateur',
        params: z.object({ id: z.uuid() }),
        response: { 200: userOut },
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'user:read');
      const u = await prisma.user.findUnique({ where: { id: request.params.id }, include: userInclude });
      if (!u) throw notFound();
      return serialize(u, hasPermission(ctx, 'user:manage'));
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['Utilisateurs'],
        summary: 'Créer un utilisateur local (mot de passe temporaire renvoyé une seule fois)',
        body: userCreateSchema,
        response: { 201: z.object({ user: userOut, temporaryPassword: z.string() }) },
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'user:manage');
      const input = request.body;
      const temporaryPassword = generatePassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const created = await prisma.$transaction(async (tx) => {
        if (input.orgUnitId) {
          const unit = await tx.organizationUnit.findUnique({ where: { id: input.orgUnitId } });
          if (!unit) throw badRequest('Unité organisationnelle inconnue');
        }
        const user = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            orgUnitId: input.orgUnitId ?? null,
            passwordHash,
            mustChangePassword: true,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        await replaceRoles(tx, user.id, input.roles, ctx.user.id);
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'User',
          entityId: user.id,
          changes: {
            email: { old: null, new: user.email },
            displayName: { old: null, new: user.displayName },
            orgUnitId: { old: null, new: user.orgUnitId },
            roles: { old: [], new: rolesSummary(input.roles) },
          },
        });
        return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
      });
      return reply.status(201).send({ user: serialize(created, true), temporaryPassword });
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['Utilisateurs'],
        summary: 'Modifier un utilisateur (profil, unité, activation, rôles)',
        params: z.object({ id: z.uuid() }),
        body: userUpdateSchema,
        response: { 200: userOut },
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'user:manage');
      const { id } = request.params;
      const input = request.body;
      if (id === ctx.user.id && input.isActive === false) {
        throw badRequest('Vous ne pouvez pas désactiver votre propre compte');
      }
      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.user.findUnique({ where: { id }, include: userInclude });
        if (!before) throw notFound();
        if (input.orgUnitId) {
          const unit = await tx.organizationUnit.findUnique({ where: { id: input.orgUnitId } });
          if (!unit) throw badRequest('Unité organisationnelle inconnue');
        }
        const after = await tx.user.update({
          where: { id },
          data: {
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            updatedById: ctx.user.id,
          },
        });
        const changes = diff(before, after, ['displayName', 'orgUnitId', 'isActive']);
        if (input.roles) {
          const oldRoles = rolesSummary(
            before.roleAssignments.map((a) => ({
              roleKey: a.role.key as RoleAssignmentInput['roleKey'],
              orgUnitId: a.orgUnitId,
              includeDescendants: a.includeDescendants,
            })),
          );
          const newRoles = rolesSummary(input.roles);
          if (JSON.stringify(oldRoles) !== JSON.stringify(newRoles)) {
            await replaceRoles(tx, id, input.roles, ctx.user.id);
            changes.roles = { old: oldRoles, new: newRoles };
          }
        }
        if (input.isActive === false) await tx.session.deleteMany({ where: { userId: id } });
        await assertSuperAdminRemains(tx);
        if (Object.keys(changes).length) {
          await recordAudit(tx, actorOf(request), {
            action: changes.roles ? 'update_roles' : 'update',
            entityType: 'User',
            entityId: id,
            changes,
          });
        }
        return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      });
      return serialize(updated, true);
    },
  );

  app.post(
    '/:id/reset-password',
    {
      schema: {
        tags: ['Utilisateurs'],
        summary: 'Réinitialiser le mot de passe (temporaire, changement imposé, sessions révoquées)',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ temporaryPassword: z.string() }) },
      },
    },
    async (request) => {
      requirePermission(request, 'user:manage');
      const { id } = request.params;
      const temporaryPassword = generatePassword();
      const passwordHash = await hashPassword(temporaryPassword);
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id } });
        if (!user) throw notFound();
        if (user.authProvider !== 'LOCAL') throw badRequest('Compte géré par le fournisseur d’identité');
        await tx.user.update({
          where: { id },
          data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
        });
        await tx.session.deleteMany({ where: { userId: id } });
        await recordAudit(tx, actorOf(request), { action: 'password_reset', entityType: 'User', entityId: id });
      });
      return { temporaryPassword };
    },
  );
};
