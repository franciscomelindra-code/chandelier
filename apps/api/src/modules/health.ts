import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({ status: z.literal('ok') });
const readyResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({ database: z.boolean(), migrations: z.boolean() }),
});

/** /health : vivacité du processus. /ready : BDD joignable et migrations appliquées. */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  const handlers = async () => ({ status: 'ok' as const });
  for (const url of ['/health', '/api/v1/health']) {
    app.get(
      url,
      {
        config: { public: true },
        schema: { tags: ['Supervision'], summary: 'Vivacité', security: [], response: { 200: healthResponse } },
      },
      handlers,
    );
  }

  for (const url of ['/ready', '/api/v1/ready']) {
    app.get(
      url,
      {
        config: { public: true },
        schema: {
          tags: ['Supervision'],
          summary: 'Disponibilité (BDD + migrations)',
          security: [],
          response: { 200: readyResponse, 503: readyResponse },
        },
      },
      async (_request, reply) => {
        const { prisma } = app.deps;
        let database = false;
        let migrations = false;
        try {
          await prisma.$queryRaw`SELECT 1`;
          database = true;
          const pending = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM "_prisma_migrations"
            WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`;
          const applied = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
          migrations = Number(pending[0]?.n ?? 1) === 0 && Number(applied[0]?.n ?? 0) > 0;
        } catch {
          // non prêt
        }
        const ok = database && migrations;
        return reply
          .status(ok ? 200 : 503)
          .send({ status: ok ? 'ready' : 'not_ready', checks: { database, migrations } });
      },
    );
  }
};
