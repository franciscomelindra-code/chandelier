/**
 * Crée un super administrateur local.
 *   npm run admin:create -- --email admin@example.org --name "Prénom Nom"
 *   docker compose exec api node dist/cli/create-admin.js --email ... --name ...
 * Le mot de passe temporaire est affiché UNE fois sur la sortie standard ; changement imposé au premier login.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../config.js';
import { seedBase } from '../seed/base.js';
import { createSuperAdmin } from '../bootstrap.js';
import { generatePassword } from '../auth/password.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
});
if (!values.email || !values.name) {
  console.error('Usage : --email <adresse> --name "<nom affiché>"');
  process.exit(1);
}
const config = loadConfig();
const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
try {
  await seedBase(prisma);
  const password = generatePassword();
  await createSuperAdmin(prisma, { email: values.email, displayName: values.name, password });
  console.log(`Super administrateur créé : ${values.email}`);
  console.log(`Mot de passe temporaire (à changer à la première connexion) : ${password}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
