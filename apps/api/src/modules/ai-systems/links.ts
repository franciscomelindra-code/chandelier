import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PARTY_FUNCTION_LABELS,
  SECTION_LABELS,
  sectionAssignmentSchema,
  sectionOfFunction,
  systemAssetSchema,
  systemDataCategoriesSchema,
  systemDataSubjectsSchema,
  systemDatasetSchema,
  systemProcessingSchema,
  systemStakeholderSchema,
  systemStakeholderUpdateSchema,
  type PartyFunction,
  type SectionKey,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../audit/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { actorOf, requirePermission } from '../../http.js';
import { can } from '../../rbac/access.js';
import { loadVisible, refreshCompleteness, serializeDetail, snapshot, targetOf, type SystemRow } from './service.js';

type Tx = Prisma.TransactionClient;
type Changes = Record<string, { old: unknown; new: unknown }>;

const id = z.uuid();

/**
 * Modification d'une section relationnelle d'un SIA, dans une transaction :
 * contrôle de visibilité, d'archivage et du droit sur la section, puis version + 1,
 * complétude, instantané et journal.
 */
async function mutateSection(
  request: FastifyRequest,
  systemId: string,
  section: SectionKey,
  action: string,
  fn: (tx: Tx, s: SystemRow) => Promise<Changes>,
) {
  const ctx = requirePermission(request, 'aiSystem:read');
  const { prisma } = request.server.deps;
  const result = await prisma.$transaction(async (tx) => {
    const { system, sections } = await loadVisible(tx, ctx, systemId);
    if (system.archivedAt) throw conflict('SIA archivé : restaurez-le avant toute modification');
    if (!can(ctx, 'aiSystem:update', targetOf(system, sections, section))) {
      throw forbidden(`Modification non autorisée (section « ${SECTION_LABELS[section]} »)`);
    }
    const changes = await fn(tx, system);
    await tx.aiSystem.update({
      where: { id: system.id },
      data: { version: { increment: 1 }, updatedById: ctx.user.id },
    });
    const after = await refreshCompleteness(tx, system.id);
    await snapshot(tx, after, ctx.user.id, `${SECTION_LABELS[section]} : ${action}`);
    await recordAudit(tx, actorOf(request), {
      action,
      entityType: 'AiSystem',
      entityId: system.id,
      aiSystemId: system.id,
      changes,
    });
    return { after, sections };
  });
  return serializeDetail(ctx, result.after, result.sections);
}

export const aiSystemLinkRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;
  const tags = ['Systèmes d’IA — sections'];

  // ── Étapes 2 et 4 : responsabilités et parties prenantes ──
  app.post(
    '/:id/stakeholders',
    {
      schema: {
        tags,
        summary: 'Rattacher une partie prenante (fonction, responsabilité, accès, RACI)',
        params: z.object({ id }),
        body: systemStakeholderSchema,
      },
    },
    async (request) => {
      const b = request.body;
      return mutateSection(
        request,
        request.params.id,
        sectionOfFunction(b.function as PartyFunction),
        'link_stakeholder',
        async (tx, s) => {
          const st = await tx.stakeholder.findUnique({ where: { id: b.stakeholderId } });
          if (!st) throw badRequest('Partie prenante inconnue');
          if (s.stakeholders.some((l) => l.stakeholderId === b.stakeholderId && l.function === b.function)) {
            throw conflict('Cette partie prenante a déjà cette fonction sur ce SIA');
          }
          await tx.aiSystemStakeholder.create({ data: { aiSystemId: s.id, ...b } });
          return {
            stakeholders: { old: null, new: `${st.name} — ${PARTY_FUNCTION_LABELS[b.function as PartyFunction]}` },
          };
        },
      );
    },
  );

  app.patch(
    '/:id/stakeholders/:linkId',
    {
      schema: {
        tags,
        summary: 'Modifier un rattachement de partie prenante',
        params: z.object({ id, linkId: id }),
        body: systemStakeholderUpdateSchema,
      },
    },
    async (request) => {
      const link = await prisma.aiSystemStakeholder.findUnique({
        where: { id: request.params.linkId },
        include: { stakeholder: true },
      });
      if (!link || link.aiSystemId !== request.params.id) throw notFound();
      return mutateSection(
        request,
        request.params.id,
        sectionOfFunction(link.function as PartyFunction),
        'update_stakeholder',
        async (tx) => {
          await tx.aiSystemStakeholder.update({ where: { id: link.id }, data: request.body });
          const changes: Changes = {};
          for (const [k, v] of Object.entries(request.body)) {
            const old = (link as unknown as Record<string, unknown>)[k];
            if (v !== undefined && v !== old) changes[`${link.stakeholder.name}.${k}`] = { old, new: v };
          }
          return changes;
        },
      );
    },
  );

  app.delete(
    '/:id/stakeholders/:linkId',
    { schema: { tags, summary: 'Retirer une partie prenante', params: z.object({ id, linkId: id }) } },
    async (request) => {
      const link = await prisma.aiSystemStakeholder.findUnique({
        where: { id: request.params.linkId },
        include: { stakeholder: true },
      });
      if (!link || link.aiSystemId !== request.params.id) throw notFound();
      return mutateSection(
        request,
        request.params.id,
        sectionOfFunction(link.function as PartyFunction),
        'unlink_stakeholder',
        async (tx) => {
          await tx.aiSystemStakeholder.delete({ where: { id: link.id } });
          return {
            stakeholders: {
              old: `${link.stakeholder.name} — ${PARTY_FUNCTION_LABELS[link.function as PartyFunction]}`,
              new: null,
            },
          };
        },
      );
    },
  );

  // ── Étape 5 : actifs ──
  app.post(
    '/:id/assets',
    { schema: { tags, summary: 'Rattacher un actif existant', params: z.object({ id }), body: systemAssetSchema } },
    async (request) =>
      mutateSection(request, request.params.id, 'assets', 'link_asset', async (tx, s) => {
        const a = await tx.asset.findUnique({ where: { id: request.body.assetId } });
        if (!a) throw badRequest('Actif inconnu');
        await tx.aiSystemAsset.upsert({
          where: { aiSystemId_assetId: { aiSystemId: s.id, assetId: a.id } },
          create: { aiSystemId: s.id, assetId: a.id, dependency: request.body.dependency },
          update: { dependency: request.body.dependency },
        });
        return { assets: { old: null, new: a.name } };
      }),
  );
  app.delete(
    '/:id/assets/:assetId',
    { schema: { tags, summary: 'Retirer un actif', params: z.object({ id, assetId: id }) } },
    async (request) =>
      mutateSection(request, request.params.id, 'assets', 'unlink_asset', async (tx, s) => {
        const l = s.assets.find((x) => x.assetId === request.params.assetId);
        if (!l) throw notFound();
        await tx.aiSystemAsset.delete({ where: { aiSystemId_assetId: { aiSystemId: s.id, assetId: l.assetId } } });
        return { assets: { old: l.asset.name, new: null } };
      }),
  );

  // ── Étape 6 : traitements RGPD ──
  app.post(
    '/:id/processing',
    {
      schema: {
        tags,
        summary: 'Lier un traitement du registre RGPD',
        params: z.object({ id }),
        body: systemProcessingSchema,
      },
    },
    async (request) =>
      mutateSection(request, request.params.id, 'processing', 'link_processing', async (tx, s) => {
        const p = await tx.processingActivity.findUnique({ where: { id: request.body.processingActivityId } });
        if (!p) throw badRequest('Traitement inconnu');
        await tx.aiSystemProcessingActivity.upsert({
          where: { aiSystemId_processingActivityId: { aiSystemId: s.id, processingActivityId: p.id } },
          create: { aiSystemId: s.id, processingActivityId: p.id, notes: request.body.notes },
          update: { notes: request.body.notes },
        });
        return { processing: { old: null, new: `${p.reference} — ${p.name}` } };
      }),
  );
  app.delete(
    '/:id/processing/:processingActivityId',
    { schema: { tags, summary: 'Retirer un traitement', params: z.object({ id, processingActivityId: id }) } },
    async (request) =>
      mutateSection(request, request.params.id, 'processing', 'unlink_processing', async (tx, s) => {
        const l = s.processing.find((x) => x.processingActivityId === request.params.processingActivityId);
        if (!l) throw notFound();
        await tx.aiSystemProcessingActivity.delete({
          where: {
            aiSystemId_processingActivityId: { aiSystemId: s.id, processingActivityId: l.processingActivityId },
          },
        });
        return { processing: { old: l.processingActivity.reference, new: null } };
      }),
  );

  // ── Étape 7 : données ──
  app.post(
    '/:id/datasets',
    {
      schema: {
        tags,
        summary: 'Rattacher un jeu de données (usages : entraînement, RAG, inférence…)',
        params: z.object({ id }),
        body: systemDatasetSchema,
      },
    },
    async (request) =>
      mutateSection(request, request.params.id, 'data', 'link_dataset', async (tx, s) => {
        const d = await tx.dataset.findUnique({ where: { id: request.body.datasetId } });
        if (!d) throw badRequest('Jeu de données inconnu');
        const prev = s.datasets.find((x) => x.datasetId === d.id);
        await tx.aiSystemDataset.upsert({
          where: { aiSystemId_datasetId: { aiSystemId: s.id, datasetId: d.id } },
          create: { aiSystemId: s.id, datasetId: d.id, usages: request.body.usages, notes: request.body.notes },
          update: { usages: request.body.usages, notes: request.body.notes },
        });
        return { [`datasets.${d.name}`]: { old: prev?.usages ?? null, new: request.body.usages } };
      }),
  );
  app.delete(
    '/:id/datasets/:datasetId',
    { schema: { tags, summary: 'Retirer un jeu de données', params: z.object({ id, datasetId: id }) } },
    async (request) =>
      mutateSection(request, request.params.id, 'data', 'unlink_dataset', async (tx, s) => {
        const l = s.datasets.find((x) => x.datasetId === request.params.datasetId);
        if (!l) throw notFound();
        await tx.aiSystemDataset.delete({
          where: { aiSystemId_datasetId: { aiSystemId: s.id, datasetId: l.datasetId } },
        });
        return { datasets: { old: l.dataset.name, new: null } };
      }),
  );
  app.put(
    '/:id/data-categories',
    {
      schema: {
        tags,
        summary: 'Définir les catégories de données traitées',
        params: z.object({ id }),
        body: systemDataCategoriesSchema,
      },
    },
    async (request) =>
      mutateSection(request, request.params.id, 'data', 'set_data_categories', async (tx, s) => {
        const ids = [...new Set(request.body.ids)];
        const cats = await tx.dataCategory.findMany({ where: { id: { in: ids } } });
        if (cats.length !== ids.length) throw badRequest('Catégorie de données inconnue');
        await tx.aiSystemDataCategory.deleteMany({ where: { aiSystemId: s.id } });
        await tx.aiSystemDataCategory.createMany({
          data: ids.map((dataCategoryId) => ({ aiSystemId: s.id, dataCategoryId })),
        });
        return {
          dataCategories: {
            old: s.dataCategories.map((c) => c.dataCategory.label).sort(),
            new: cats.map((c) => c.label).sort(),
          },
        };
      }),
  );

  // ── Étape 8 : personnes concernées ──
  app.put(
    '/:id/data-subjects',
    {
      schema: {
        tags,
        summary: 'Définir les catégories de personnes concernées',
        params: z.object({ id }),
        body: systemDataSubjectsSchema,
      },
    },
    async (request) =>
      mutateSection(request, request.params.id, 'subjects', 'set_data_subjects', async (tx, s) => {
        const items = request.body.items;
        const ids = items.map((i) => i.dataSubjectId);
        if (new Set(ids).size !== ids.length) throw badRequest('Catégorie en double');
        const cats = await tx.dataSubjectCategory.findMany({ where: { id: { in: ids } } });
        if (cats.length !== ids.length) throw badRequest('Catégorie de personnes inconnue');
        await tx.aiSystemDataSubject.deleteMany({ where: { aiSystemId: s.id } });
        await tx.aiSystemDataSubject.createMany({ data: items.map((i) => ({ aiSystemId: s.id, ...i })) });
        return {
          dataSubjects: {
            old: s.dataSubjects.map((c) => c.dataSubject.label).sort(),
            new: cats.map((c) => c.label).sort(),
          },
        };
      }),
  );

  // ── Affectation de sections à des contributeurs ──
  const assignmentOut = (a: {
    id: string;
    section: string;
    dueDate: Date | null;
    user: { id: string; displayName: string };
  }) => ({
    id: a.id,
    section: a.section,
    dueDate: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null,
    user: a.user,
  });

  app.get(
    '/:id/assignments',
    { schema: { tags, summary: 'Sections affectées à des contributeurs', params: z.object({ id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await loadVisible(prisma, ctx, request.params.id);
      const rows = await prisma.sectionAssignment.findMany({
        where: { aiSystemId: request.params.id },
        include: { user: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return { items: rows.map(assignmentOut) };
    },
  );

  app.post(
    '/:id/assignments',
    {
      schema: {
        tags,
        summary: 'Affecter une section à un utilisateur',
        params: z.object({ id }),
        body: sectionAssignmentSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const created = await prisma.$transaction(async (tx) => {
        const { system } = await loadVisible(tx, ctx, request.params.id);
        // Seuls ceux qui gèrent les responsabilités du SIA (hors simple affectation) peuvent affecter.
        if (!can(ctx, 'aiSystem:update', targetOf(system, [], 'responsibility'))) throw forbidden();
        if (system.archivedAt) throw conflict('SIA archivé');
        const user = await tx.user.findUnique({ where: { id: request.body.userId } });
        if (!user || !user.isActive) throw badRequest('Utilisateur inconnu ou désactivé');
        const a = await tx.sectionAssignment.create({
          data: {
            aiSystemId: system.id,
            section: request.body.section,
            userId: user.id,
            dueDate: request.body.dueDate ? new Date(`${request.body.dueDate}T00:00:00Z`) : null,
            createdById: ctx.user.id,
          },
          include: { user: { select: { id: true, displayName: true } } },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'assign_section',
          entityType: 'AiSystem',
          entityId: system.id,
          aiSystemId: system.id,
          changes: {
            assignment: { old: null, new: `${SECTION_LABELS[a.section as SectionKey]} → ${user.displayName}` },
          },
        });
        return a;
      });
      return reply.status(201).send(assignmentOut(created));
    },
  );

  app.delete(
    '/:id/assignments/:assignmentId',
    { schema: { tags, summary: 'Retirer une affectation', params: z.object({ id, assignmentId: id }) } },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { system } = await loadVisible(tx, ctx, request.params.id);
        if (!can(ctx, 'aiSystem:update', targetOf(system, [], 'responsibility'))) throw forbidden();
        const a = await tx.sectionAssignment.findUnique({
          where: { id: request.params.assignmentId },
          include: { user: true },
        });
        if (!a || a.aiSystemId !== system.id) throw notFound();
        await tx.sectionAssignment.delete({ where: { id: a.id } });
        await recordAudit(tx, actorOf(request), {
          action: 'unassign_section',
          entityType: 'AiSystem',
          entityId: system.id,
          aiSystemId: system.id,
          changes: {
            assignment: { old: `${SECTION_LABELS[a.section as SectionKey]} → ${a.user.displayName}`, new: null },
          },
        });
      });
      return reply.status(204).send(null);
    },
  );
};
