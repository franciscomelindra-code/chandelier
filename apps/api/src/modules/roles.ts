import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '../http.js';

const roleOut = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  assignmentCount: z.number(),
});

export const roleRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  app.get(
    '/',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Rôles et permissions',
        response: { 200: z.object({ items: z.array(roleOut) }) },
      },
    },
    async (request) => {
      requirePermission(request, 'user:read');
      const roles = await prisma.role.findMany({
        include: { _count: { select: { assignments: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        items: roles.map((r) => ({
          key: r.key,
          label: r.label,
          description: r.description,
          permissions: r.permissions,
          isSystem: r.isSystem,
          assignmentCount: r._count.assignments,
        })),
      };
    },
  );
};
