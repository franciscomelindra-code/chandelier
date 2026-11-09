import { existsSync, writeFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { emailSchema } from '@chandelier/shared';
import type { AppConfig } from './config.js';
import { generatePassword, hashPassword } from './auth/password.js';
import { recordAudit } from './audit/audit.js';

export interface CreateAdminResult {
  created: boolean;
  reason?: string;
}

/** Crée un SUPER_ADMIN global avec mot de passe imposé au premier login. */
export async function createSuperAdmin(
  prisma: PrismaClient,
  input: { email: string; displayName: string; password: string },
): Promise<string> {
  const email = emailSchema.parse(input.email);
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    const user = await tx.user.create({
      data: { email, displayName: input.displayName, passwordHash, mustChangePassword: true },
    });
    await tx.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, orgUnitId: null } });
    await recordAudit(
      tx,
      { id: null, label: 'système (initialisation)', origin: 'SYSTEM' },
      {
        action: 'bootstrap_admin',
        entityType: 'User',
        entityId: user.id,
        changes: { email: { old: null, new: email }, roles: { old: [], new: ['SUPER_ADMIN@global'] } },
      },
    );
    return user.id;
  });
}

/**
 * Premier démarrage : si aucun SUPER_ADMIN n'existe et BOOTSTRAP_ADMIN_EMAIL est défini,
 * crée le compte avec un mot de passe ALÉATOIRE écrit dans SECRETS_DIR/initial_admin_password
 * (jamais dans les journaux). Sans SECRETS_DIR, rien n'est créé (utiliser `npm run admin:create`).
 */
export async function bootstrapAdmin(prisma: PrismaClient, cfg: AppConfig): Promise<CreateAdminResult> {
  const existing = await prisma.userRoleAssignment.count({ where: { role: { key: 'SUPER_ADMIN' } } });
  if (existing > 0) return { created: false, reason: 'un super administrateur existe déjà' };
  if (!cfg.BOOTSTRAP_ADMIN_EMAIL) return { created: false, reason: 'BOOTSTRAP_ADMIN_EMAIL non défini' };
  if (!cfg.SECRETS_DIR || !existsSync(cfg.SECRETS_DIR)) {
    return { created: false, reason: 'SECRETS_DIR absent : utiliser npm run admin:create' };
  }
  const password = generatePassword();
  const file = `${cfg.SECRETS_DIR}/initial_admin_password`;
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  await createSuperAdmin(prisma, {
    email: cfg.BOOTSTRAP_ADMIN_EMAIL,
    displayName: cfg.BOOTSTRAP_ADMIN_NAME || 'Administrateur',
    password,
  });
  return { created: true };
}
