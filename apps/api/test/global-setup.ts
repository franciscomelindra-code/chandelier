import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Réinitialise la base de TEST (et seulement elle) puis applique les migrations.
 * Garde-fou : refuse si l'URL ne désigne pas une base dont le nom contient "test".
 */
export default async function setup() {
  const root = resolve(import.meta.dirname, '../../..');
  const envFile = resolve(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST est requis pour les tests d’intégration');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName) || url === process.env.DATABASE_URL) {
    throw new Error(`Refus de réinitialiser "${dbName}" : le nom de la base de test doit contenir "test"`);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$disconnect();
  execSync('npx prisma migrate deploy', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
