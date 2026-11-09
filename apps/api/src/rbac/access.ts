import { parseGrant, type Permission, type Qualifier, type RoleKey } from '@chandelier/shared';
import type { PrismaClient } from '@prisma/client';

/** Une permission effective : issue d'un rôle, limitée à un périmètre. */
export interface EffectiveGrant {
  permission: Permission;
  qualifier: Qualifier;
  /** null = global ; sinon chemin matérialisé de l'unité. */
  scopePath: string | null;
  includeDescendants: boolean;
  role: RoleKey;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  orgUnitId: string | null;
  mustChangePassword: boolean;
}

export interface AccessContext {
  user: AuthUser;
  grants: EffectiveGrant[];
  roles: { roleKey: RoleKey; orgUnitId: string | null; includeDescendants: boolean }[];
}

/** Objet soumis à contrôle : son unité, son propriétaire, les sections affectées à l'utilisateur. */
export interface AccessTarget {
  orgUnitPath: string;
  ownerId?: string | null;
  assignedSections?: string[];
  section?: string;
}

export async function loadAccessContext(prisma: PrismaClient, userId: string): Promise<AccessContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleAssignments: { include: { role: true, orgUnit: true } } },
  });
  if (!user || !user.isActive) return null;
  const grants: EffectiveGrant[] = [];
  for (const a of user.roleAssignments) {
    if (a.orgUnit && !a.orgUnit.isActive) continue;
    for (const g of a.role.permissions) {
      const parsed = parseGrant(g);
      if (!parsed) continue;
      grants.push({
        ...parsed,
        scopePath: a.orgUnit?.path ?? null,
        includeDescendants: a.includeDescendants,
        role: a.role.key as RoleKey,
      });
    }
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      orgUnitId: user.orgUnitId,
      mustChangePassword: user.mustChangePassword,
    },
    grants,
    roles: user.roleAssignments.map((a) => ({
      roleKey: a.role.key as RoleKey,
      orgUnitId: a.orgUnitId,
      includeDescendants: a.includeDescendants,
    })),
  };
}

function inScope(grant: EffectiveGrant, targetPath: string): boolean {
  if (grant.scopePath === null) return true;
  if (grant.includeDescendants) return targetPath.startsWith(grant.scopePath);
  return targetPath === grant.scopePath;
}

function qualifierSatisfied(ctx: AccessContext, grant: EffectiveGrant, target: AccessTarget): boolean {
  switch (grant.qualifier) {
    case 'all':
      return true;
    case 'own':
      return !!target.ownerId && target.ownerId === ctx.user.id;
    case 'assigned':
      return !!target.section && (target.assignedSections ?? []).includes(target.section);
  }
}

/** L'utilisateur détient-il la permission quelque part (au moins sous une forme) ? */
export function hasPermission(ctx: AccessContext, permission: Permission): boolean {
  return ctx.grants.some((g) => g.permission === permission);
}

/** La permission est-elle détenue sans qualificatif et globalement ? */
export function hasGlobalPermission(ctx: AccessContext, permission: Permission): boolean {
  return ctx.grants.some((g) => g.permission === permission && g.qualifier === 'all' && g.scopePath === null);
}

/** Contrôle d'accès objet : permission + périmètre + qualificatif. */
export function can(ctx: AccessContext, permission: Permission, target: AccessTarget): boolean {
  return ctx.grants.some(
    (g) => g.permission === permission && inScope(g, target.orgUnitPath) && qualifierSatisfied(ctx, g, target),
  );
}

/**
 * Périmètres de lecture pour filtrer les listes côté BDD.
 * Retourne null si l'accès est global, sinon la liste des préfixes / chemins exacts autorisés.
 */
export function readScopes(
  ctx: AccessContext,
  permission: Permission,
): { global: true } | { global: false; prefixes: string[]; exact: string[] } {
  const grants = ctx.grants.filter((g) => g.permission === permission);
  if (grants.some((g) => g.scopePath === null)) return { global: true };
  return {
    global: false,
    prefixes: grants.filter((g) => g.includeDescendants).map((g) => g.scopePath as string),
    exact: grants.filter((g) => !g.includeDescendants).map((g) => g.scopePath as string),
  };
}

export function listPermissions(ctx: AccessContext): Permission[] {
  return [...new Set(ctx.grants.map((g) => g.permission))];
}
