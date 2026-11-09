import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { savedViewSchema, tagCreateSchema } from '@chandelier/shared';
import { recordAudit } from '../audit/audit.js';
import { forbidden } from '../errors.js';
import { actorOf, requireAuth } from '../http.js';
import { hasPermission } from '../rbac/access.js';

export const tagRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  app.get('/', { schema: { tags: ['Référentiels'], summary: 'Tags' } }, async (request) => {
    requireAuth(request);
    const tags = await prisma.tag.findMany({
      orderBy: { label: 'asc' },
      include: { _count: { select: { systems: true } } },
    });
    return { items: tags.map((t) => ({ id: t.id, label: t.label, color: t.color, usage: t._count.systems })) };
  });

  app.post(
    '/',
    { schema: { tags: ['Référentiels'], summary: 'Créer un tag', body: tagCreateSchema } },
    async (request, reply) => {
      const ctx = requireAuth(request);
      if (!hasPermission(ctx, 'aiSystem:create') && !hasPermission(ctx, 'aiSystem:update')) throw forbidden();
      const tag = await prisma.$transaction(async (tx) => {
        const t = await tx.tag.create({
          data: { label: request.body.label, color: request.body.color ?? null, createdById: ctx.user.id },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'Tag',
          entityId: t.id,
          changes: { label: { old: null, new: t.label } },
        });
        return t;
      });
      return reply.status(201).send({ id: tag.id, label: tag.label, color: tag.color, usage: 0 });
    },
  );
};

export const savedViewRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  const out = (
    v: {
      id: string;
      name: string;
      scope: string;
      state: unknown;
      isShared: boolean;
      userId: string;
      user: { displayName: string };
    },
    me: string,
  ) => ({
    id: v.id,
    name: v.name,
    scope: v.scope,
    state: v.state,
    isShared: v.isShared,
    ownerName: v.user.displayName,
    mine: v.userId === me,
  });

  app.get(
    '/',
    {
      schema: {
        tags: ['Vues sauvegardées'],
        summary: 'Vues personnelles et partagées',
        querystring: z.object({ scope: z.enum(['ai-systems']) }),
      },
    },
    async (request) => {
      const ctx = requireAuth(request);
      const views = await prisma.savedView.findMany({
        where: { scope: request.query.scope, OR: [{ userId: ctx.user.id }, { isShared: true }] },
        include: { user: { select: { displayName: true } } },
        orderBy: { name: 'asc' },
      });
      return { items: views.map((v) => out(v, ctx.user.id)) };
    },
  );

  app.post(
    '/',
    { schema: { tags: ['Vues sauvegardées'], summary: 'Enregistrer une vue', body: savedViewSchema } },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const v = await prisma.savedView.create({
        data: { ...request.body, userId: ctx.user.id },
        include: { user: { select: { displayName: true } } },
      });
      return reply.status(201).send(out(v, ctx.user.id));
    },
  );

  app.delete(
    '/:id',
    {
      schema: { tags: ['Vues sauvegardées'], summary: 'Supprimer une de ses vues', params: z.object({ id: z.uuid() }) },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const { count } = await prisma.savedView.deleteMany({ where: { id: request.params.id, userId: ctx.user.id } });
      if (count === 0) throw forbidden('Vue introuvable ou appartenant à un autre utilisateur');
      return reply.status(204).send(null);
    },
  );
};
