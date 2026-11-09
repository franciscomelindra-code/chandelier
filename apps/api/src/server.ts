import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { seedBase } from './seed/base.js';
import { seedDemo } from './seed/demo.js';
import { bootstrapAdmin } from './bootstrap.js';
import { purgeExpiredSessions } from './auth/session.js';
import { recomputeAllCompleteness } from './modules/ai-systems/service.js';

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  await prisma.$connect();

  const app = await buildApp({ config, prisma });

  app.log.info(
    `Mode d’accès distant déclaré : ${config.REMOTE_ACCESS_MODE} (voir docs/REMOTE_ACCESS.md) — URL : ${config.APP_URL}`,
  );
  await seedBase(prisma);
  if (config.SEED_DEMO) {
    await seedDemo(prisma);
    app.log.warn('Jeu de démonstration FICTIF chargé (SEED_DEMO=true)');
  }
  const recomputed = await recomputeAllCompleteness(prisma);
  if (recomputed) app.log.info(`Complétude recalculée pour ${recomputed} SIA (critères mis à jour)`);
  const admin = await bootstrapAdmin(prisma, config);
  if (admin.created) {
    app.log.warn(
      'Compte administrateur initial créé. Mot de passe temporaire : docker compose exec api cat /run/chandelier-secrets/initial_admin_password',
    );
  } else {
    app.log.info(`Pas de création d’administrateur initial : ${admin.reason}`);
  }

  const purge = setInterval(
    () => void purgeExpiredSessions(prisma, config).catch((err) => app.log.error({ err }, 'Purge sessions')),
    15 * 60_000,
  );
  purge.unref();

  const shutdown = async (signal: string) => {
    app.log.info(`Arrêt (${signal})`);
    clearInterval(purge);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
