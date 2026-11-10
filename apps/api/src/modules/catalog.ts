import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z, type ZodType } from 'zod';
import {
  TEMPLATE_FIELDS,
  aiModelSchema,
  aiModelUpdateSchema,
  vendorSchema,
  vendorUpdateSchema,
  assetSchema,
  assetUpdateSchema,
  datasetSchema,
  datasetUpdateSchema,
  processingActivitySchema,
  processingActivityUpdateSchema,
  stakeholderSchema,
  stakeholderUpdateSchema,
  templateFromSystemSchema,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { diff, recordAudit } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { actorOf, requireAuth, requirePermission } from '../http.js';
import { loadVisible, scopeWhere } from './ai-systems/service.js';

type Tx = Prisma.TransactionClient;
type Row = { id: string } & Record<string, unknown>;

interface CatalogSpec<C, U> {
  prefix: string;
  tag: string;
  entityType: string;
  label: string;
  createSchema: ZodType<C>;
  updateSchema: ZodType<U>;
  list: (tx: Tx, q: string | undefined) => Promise<(Row & { usage: number })[]>;
  find: (tx: Tx, id: string) => Promise<Row | null>;
  create: (tx: Tx, data: C, actorId: string) => Promise<Row>;
  update: (tx: Tx, id: string, data: U, actorId: string) => Promise<Row>;
  remove: (tx: Tx, id: string) => Promise<void>;
  usage: (tx: Tx, id: string) => Promise<number>;
  tracked: string[];
}

/** CRUD générique d'un référentiel : lecture pour tout utilisateur connecté, écriture avec catalog:manage, journalisé. */
function registerCatalog<C, U>(app: FastifyInstance, spec: CatalogSpec<C, U>) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { prisma } = app.deps;
  const params = z.object({ id: z.uuid() });

  r.get(
    spec.prefix,
    {
      schema: {
        tags: [spec.tag],
        summary: `${spec.label} — liste`,
        querystring: z.object({ q: z.string().trim().max(100).optional() }),
      },
    },
    async (request) => {
      requireAuth(request);
      return { items: await spec.list(prisma, request.query.q) };
    },
  );

  r.post(
    spec.prefix,
    { schema: { tags: [spec.tag], summary: `${spec.label} — création`, body: spec.createSchema } },
    async (request, reply) => {
      const ctx = requirePermission(request, 'catalog:manage');
      const created = await prisma.$transaction(async (tx) => {
        const row = await spec.create(tx, request.body as C, ctx.user.id);
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: spec.entityType,
          entityId: row.id,
          changes: diff(null, row, spec.tracked),
        });
        return row;
      });
      return reply.status(201).send(created);
    },
  );

  r.patch(
    `${spec.prefix}/:id`,
    { schema: { tags: [spec.tag], summary: `${spec.label} — modification`, params, body: spec.updateSchema } },
    async (request) => {
      const ctx = requirePermission(request, 'catalog:manage');
      return prisma.$transaction(async (tx) => {
        const before = await spec.find(tx, request.params.id);
        if (!before) throw notFound();
        const after = await spec.update(tx, request.params.id, request.body as U, ctx.user.id);
        const changes = diff(before, after, spec.tracked);
        if (Object.keys(changes).length) {
          await recordAudit(tx, actorOf(request), {
            action: 'update',
            entityType: spec.entityType,
            entityId: before.id,
            changes,
          });
        }
        return after;
      });
    },
  );

  r.delete(
    `${spec.prefix}/:id`,
    {
      schema: {
        tags: [spec.tag],
        summary: `${spec.label} — suppression (uniquement si rattaché à aucun SIA)`,
        params,
      },
    },
    async (request, reply) => {
      requirePermission(request, 'catalog:manage');
      await prisma.$transaction(async (tx) => {
        const before = await spec.find(tx, request.params.id);
        if (!before) throw notFound();
        const n = await spec.usage(tx, before.id);
        if (n > 0) throw conflict(`Suppression impossible : élément rattaché à ${n} SIA. Retirez d’abord les liens.`);
        await spec.remove(tx, before.id);
        await recordAudit(tx, actorOf(request), {
          action: 'delete',
          entityType: spec.entityType,
          entityId: before.id,
          changes: diff(before, {}, spec.tracked),
        });
      });
      return reply.status(204).send(null);
    },
  );
}

const ci = (q: string | undefined, fields: string[]) =>
  q ? { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' as const } })) } : {};

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  // ── Parties prenantes ──
  registerCatalog(app, {
    prefix: '/stakeholders',
    tag: 'Référentiels',
    entityType: 'Stakeholder',
    label: 'Parties prenantes',
    createSchema: stakeholderSchema,
    updateSchema: stakeholderUpdateSchema,
    tracked: ['kind', 'name', 'organization', 'contact', 'userId'],
    list: async (tx, q) =>
      (
        await tx.stakeholder.findMany({
          where: ci(q, ['name', 'organization']),
          orderBy: { name: 'asc' },
          include: { _count: { select: { systems: true } } },
          take: 500,
        })
      ).map(({ _count, ...s }) => ({ ...s, usage: _count.systems })),
    find: (tx, id) => tx.stakeholder.findUnique({ where: { id } }),
    create: async (tx, data, actorId) => {
      if (data.userId && !(await tx.user.findUnique({ where: { id: data.userId } })))
        throw badRequest('Utilisateur inconnu');
      return tx.stakeholder.create({ data: { ...data, createdById: actorId, updatedById: actorId } });
    },
    update: (tx, id, data, actorId) =>
      tx.stakeholder.update({ where: { id }, data: { ...data, updatedById: actorId } }),
    remove: async (tx, id) => void (await tx.stakeholder.delete({ where: { id } })),
    usage: (tx, id) => tx.aiSystemStakeholder.count({ where: { stakeholderId: id } }),
  });

  // ── Actifs ──
  registerCatalog(app, {
    prefix: '/assets',
    tag: 'Référentiels',
    entityType: 'Asset',
    label: 'Actifs',
    createSchema: assetSchema,
    updateSchema: assetUpdateSchema,
    tracked: ['name', 'type', 'description', 'location', 'criticality'],
    list: async (tx, q) =>
      (
        await tx.asset.findMany({
          where: ci(q, ['name', 'description']),
          orderBy: { name: 'asc' },
          include: { _count: { select: { systems: true } } },
          take: 500,
        })
      ).map(({ _count, ...s }) => ({ ...s, usage: _count.systems })),
    find: (tx, id) => tx.asset.findUnique({ where: { id } }),
    create: (tx, data, actorId) => tx.asset.create({ data: { ...data, createdById: actorId, updatedById: actorId } }),
    update: (tx, id, data, actorId) => tx.asset.update({ where: { id }, data: { ...data, updatedById: actorId } }),
    remove: async (tx, id) => void (await tx.asset.delete({ where: { id } })),
    usage: (tx, id) => tx.aiSystemAsset.count({ where: { assetId: id } }),
  });

  // ── Jeux de données ──
  registerCatalog(app, {
    prefix: '/datasets',
    tag: 'Référentiels',
    entityType: 'Dataset',
    label: 'Jeux de données',
    createSchema: datasetSchema,
    updateSchema: datasetUpdateSchema,
    tracked: [
      'name',
      'description',
      'origin',
      'dataType',
      'containsPersonalData',
      'containsSpecialCategories',
      'containsCriminalData',
      'isSynthetic',
      'provenance',
      'license',
      'qualityNotes',
      'representativenessNotes',
      'retention',
      'storageLocation',
      'transfersOutsideEu',
      'recipients',
    ],
    list: async (tx, q) =>
      (
        await tx.dataset.findMany({
          where: ci(q, ['name', 'description']),
          orderBy: { name: 'asc' },
          include: { _count: { select: { systems: true } } },
          take: 500,
        })
      ).map(({ _count, ...s }) => ({ ...s, usage: _count.systems })),
    find: (tx, id) => tx.dataset.findUnique({ where: { id } }),
    create: (tx, data, actorId) => tx.dataset.create({ data: { ...data, createdById: actorId, updatedById: actorId } }),
    update: (tx, id, data, actorId) => tx.dataset.update({ where: { id }, data: { ...data, updatedById: actorId } }),
    remove: async (tx, id) => void (await tx.dataset.delete({ where: { id } })),
    usage: (tx, id) => tx.aiSystemDataset.count({ where: { datasetId: id } }),
  });

  // ── Traitements RGPD (avec catégories de données et de personnes) ──
  const processingInclude = {
    dataCategories: { select: { dataCategoryId: true } },
    dataSubjects: { select: { dataSubjectId: true } },
  } as const;
  type ProcRow = Prisma.ProcessingActivityGetPayload<{ include: typeof processingInclude }>;
  const flatten = ({ dataCategories, dataSubjects, ...p }: ProcRow) => ({
    ...p,
    dataCategoryIds: dataCategories.map((c) => c.dataCategoryId).sort(),
    dataSubjectIds: dataSubjects.map((c) => c.dataSubjectId).sort(),
  });
  async function setLinks(tx: Tx, id: string, cats?: string[], subs?: string[]) {
    if (cats) {
      if ((await tx.dataCategory.count({ where: { id: { in: cats } } })) !== new Set(cats).size)
        throw badRequest('Catégorie de données inconnue');
      await tx.processingActivityDataCategory.deleteMany({ where: { processingActivityId: id } });
      await tx.processingActivityDataCategory.createMany({
        data: [...new Set(cats)].map((dataCategoryId) => ({ processingActivityId: id, dataCategoryId })),
      });
    }
    if (subs) {
      if ((await tx.dataSubjectCategory.count({ where: { id: { in: subs } } })) !== new Set(subs).size)
        throw badRequest('Catégorie de personnes inconnue');
      await tx.processingActivityDataSubject.deleteMany({ where: { processingActivityId: id } });
      await tx.processingActivityDataSubject.createMany({
        data: [...new Set(subs)].map((dataSubjectId) => ({ processingActivityId: id, dataSubjectId })),
      });
    }
  }
  registerCatalog(app, {
    prefix: '/processing-activities',
    tag: 'Référentiels',
    entityType: 'ProcessingActivity',
    label: 'Traitements RGPD',
    createSchema: processingActivitySchema,
    updateSchema: processingActivityUpdateSchema,
    tracked: [
      'reference',
      'name',
      'purpose',
      'legalBasis',
      'gdprRole',
      'dpiaRequired',
      'retention',
      'externalRef',
      'dataCategoryIds',
      'dataSubjectIds',
    ],
    list: async (tx, q) =>
      (
        await tx.processingActivity.findMany({
          where: ci(q, ['name', 'reference', 'purpose']),
          orderBy: { reference: 'asc' },
          include: { ...processingInclude, _count: { select: { systems: true } } },
          take: 500,
        })
      ).map(({ _count, ...p }) => ({ ...flatten(p), usage: _count.systems })),
    find: async (tx, id) => {
      const p = await tx.processingActivity.findUnique({ where: { id }, include: processingInclude });
      return p ? flatten(p) : null;
    },
    create: async (tx, { dataCategoryIds, dataSubjectIds, ...data }, actorId) => {
      const p = await tx.processingActivity.create({ data: { ...data, createdById: actorId, updatedById: actorId } });
      await setLinks(tx, p.id, dataCategoryIds, dataSubjectIds);
      return flatten(
        await tx.processingActivity.findUniqueOrThrow({ where: { id: p.id }, include: processingInclude }),
      );
    },
    update: async (tx, id, { dataCategoryIds, dataSubjectIds, ...data }, actorId) => {
      await tx.processingActivity.update({ where: { id }, data: { ...data, updatedById: actorId } });
      await setLinks(tx, id, dataCategoryIds, dataSubjectIds);
      return flatten(await tx.processingActivity.findUniqueOrThrow({ where: { id }, include: processingInclude }));
    },
    remove: async (tx, id) => {
      await tx.processingActivityDataCategory.deleteMany({ where: { processingActivityId: id } });
      await tx.processingActivityDataSubject.deleteMany({ where: { processingActivityId: id } });
      await tx.processingActivity.delete({ where: { id } });
    },
    usage: (tx, id) => tx.aiSystemProcessingActivity.count({ where: { processingActivityId: id } }),
  });

  // ── Fournisseurs / éditeurs ──
  registerCatalog(app, {
    prefix: '/vendors',
    tag: 'Modèles et fournisseurs',
    entityType: 'Vendor',
    label: 'Fournisseurs',
    createSchema: vendorSchema,
    updateSchema: vendorUpdateSchema,
    tracked: ['name', 'legalName', 'country', 'website', 'description', 'dpaSigned', 'isActive'],
    list: async (tx, q) =>
      (
        await tx.vendor.findMany({
          where: ci(q, ['name', 'legalName']),
          orderBy: { name: 'asc' },
          include: { _count: { select: { systems: true, models: true, assets: true } } },
          take: 500,
        })
      ).map(({ _count, ...v }) => ({
        ...v,
        usage: _count.systems,
        modelCount: _count.models,
        linkedTotal: _count.systems + _count.models + _count.assets,
      })),
    find: (tx, id) => tx.vendor.findUnique({ where: { id } }),
    create: (tx, data, actorId) => tx.vendor.create({ data: { ...data, createdById: actorId, updatedById: actorId } }),
    update: (tx, id, data, actorId) => tx.vendor.update({ where: { id }, data: { ...data, updatedById: actorId } }),
    remove: async (tx, id) => void (await tx.vendor.delete({ where: { id } })),
    // Un fournisseur référencé par un SIA, un modèle ou un actif n'est pas supprimable (désactivation possible).
    usage: async (tx, id) =>
      (await tx.aiSystemVendor.count({ where: { vendorId: id } })) +
      (await tx.aiModel.count({ where: { vendorId: id } })) +
      (await tx.asset.count({ where: { vendorId: id } })),
  });

  // ── Modèles d'IA ──
  const modelInclude = {
    vendor: { select: { id: true, name: true } },
    _count: { select: { systems: true } },
  } as const;
  type ModelRow = Prisma.AiModelGetPayload<{ include: typeof modelInclude }>;
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const modelOut = ({ _count, ...m }: ModelRow) => ({
    ...m,
    knowledgeDate: day(m.knowledgeDate),
    versionDate: day(m.versionDate),
    usage: _count.systems,
  });
  const toDate = (v: string | null | undefined) =>
    v === undefined ? undefined : v ? new Date(`${v}T00:00:00Z`) : null;
  async function assertVendor(tx: Tx, vendorId: string | null | undefined) {
    if (vendorId && !(await tx.vendor.findUnique({ where: { id: vendorId } }))) throw badRequest('Fournisseur inconnu');
  }
  registerCatalog(app, {
    prefix: '/ai-models',
    tag: 'Modèles et fournisseurs',
    entityType: 'AiModel',
    label: 'Modèles d’IA',
    createSchema: aiModelSchema,
    updateSchema: aiModelUpdateSchema,
    tracked: [
      'name',
      'vendorId',
      'family',
      'version',
      'type',
      'description',
      'capabilities',
      'knownLimitations',
      'accessMode',
      'hosting',
      'regions',
      'documentationUrl',
      'knowledgeDate',
      'versionDate',
      'status',
      'isGpai',
      'gpaiSystemicRisk',
      'gpaiNotes',
      'license',
    ],
    list: async (tx, q) =>
      (
        await tx.aiModel.findMany({
          where: ci(q, ['name', 'family', 'version']),
          orderBy: [{ name: 'asc' }, { version: 'asc' }],
          include: modelInclude,
          take: 500,
        })
      ).map(modelOut),
    find: async (tx, id) => {
      const m = await tx.aiModel.findUnique({ where: { id }, include: modelInclude });
      return m ? modelOut(m) : null;
    },
    create: async (tx, data, actorId) => {
      await assertVendor(tx, data.vendorId);
      const m = await tx.aiModel.create({
        data: {
          ...data,
          knowledgeDate: toDate(data.knowledgeDate),
          versionDate: toDate(data.versionDate),
          createdById: actorId,
          updatedById: actorId,
        },
        include: modelInclude,
      });
      return modelOut(m);
    },
    update: async (tx, id, data, actorId) => {
      await assertVendor(tx, data.vendorId);
      const m = await tx.aiModel.update({
        where: { id },
        data: {
          ...data,
          knowledgeDate: toDate(data.knowledgeDate),
          versionDate: toDate(data.versionDate),
          updatedById: actorId,
        },
        include: modelInclude,
      });
      return modelOut(m);
    },
    remove: async (tx, id) => void (await tx.aiModel.delete({ where: { id } })),
    usage: (tx, id) => tx.aiSystemModel.count({ where: { aiModelId: id } }),
  });

  // Fiche modèle : SIA utilisateurs visibles dans le périmètre de l'utilisateur, avec la description d'usage propre à chaque lien.
  app.withTypeProvider<ZodTypeProvider>().get(
    '/ai-models/:id',
    {
      schema: {
        tags: ['Modèles et fournisseurs'],
        summary: 'Fiche d’un modèle et SIA qui l’utilisent (limités au périmètre)',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const m = await prisma.aiModel.findUnique({ where: { id: request.params.id }, include: modelInclude });
      if (!m) throw notFound('Modèle introuvable');
      const links = await prisma.aiSystemModel.findMany({
        where: { aiModelId: m.id, aiSystem: scopeWhere(ctx) },
        include: { aiSystem: { select: { id: true, reference: true, name: true, status: true, archivedAt: true } } },
        orderBy: { aiSystem: { reference: 'asc' } },
      });
      return {
        ...modelOut(m),
        systems: links.map((l) => ({
          linkId: l.id,
          usageDescription: l.usageDescription,
          versionUsed: l.versionUsed,
          hostingMode: l.hostingMode,
          isPrimary: l.isPrimary,
          system: { ...l.aiSystem, archivedAt: l.aiSystem.archivedAt?.toISOString() ?? null },
        })),
        hiddenSystems: m._count.systems - links.length,
      };
    },
  );

  // ── Référentiels RGPD en lecture ──
  app.get(
    '/data-categories',
    { schema: { tags: ['Référentiels'], summary: 'Catégories de données' } },
    async (request) => {
      requireAuth(request);
      return {
        items: await prisma.dataCategory.findMany({
          orderBy: [{ isCriminal: 'asc' }, { isSpecial: 'asc' }, { label: 'asc' }],
        }),
      };
    },
  );
  app.get(
    '/data-subject-categories',
    { schema: { tags: ['Référentiels'], summary: 'Catégories de personnes concernées' } },
    async (request) => {
      requireAuth(request);
      return {
        items: await prisma.dataSubjectCategory.findMany({ orderBy: [{ isVulnerable: 'asc' }, { label: 'asc' }] }),
      };
    },
  );

  // ── Gabarits de création ──
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    '/system-templates',
    { schema: { tags: ['Référentiels'], summary: 'Gabarits de SIA actifs' } },
    async (request) => {
      requireAuth(request);
      const items = await prisma.systemTemplate.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
      return {
        items: items.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          fields: Object.keys(t.data as object),
        })),
      };
    },
  );
  r.post(
    '/system-templates',
    {
      schema: {
        tags: ['Référentiels'],
        summary: 'Créer un gabarit à partir d’un SIA existant (champs descriptifs uniquement)',
        body: templateFromSystemSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'catalog:manage');
      const { system } = await loadVisible(prisma, ctx, request.body.fromSystemId);
      const src = system as unknown as Record<string, unknown>;
      const data = Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f, src[f]]));
      const t = await prisma.$transaction(async (tx) => {
        const tpl = await tx.systemTemplate.create({
          data: {
            name: request.body.name,
            description: request.body.description,
            data: data as Prisma.InputJsonValue,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'SystemTemplate',
          entityId: tpl.id,
          changes: { name: { old: null, new: tpl.name }, fromSystem: { old: null, new: system.reference } },
        });
        return tpl;
      });
      return reply.status(201).send({ id: t.id, name: t.name, description: t.description, fields: Object.keys(data) });
    },
  );
  r.post(
    '/system-templates/:id/deactivate',
    { schema: { tags: ['Référentiels'], summary: 'Désactiver un gabarit', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      requirePermission(request, 'catalog:manage');
      await prisma.$transaction(async (tx) => {
        const t = await tx.systemTemplate.findUnique({ where: { id: request.params.id } });
        if (!t) throw notFound();
        await tx.systemTemplate.update({ where: { id: t.id }, data: { isActive: false } });
        await recordAudit(tx, actorOf(request), {
          action: 'deactivate',
          entityType: 'SystemTemplate',
          entityId: t.id,
          changes: { isActive: { old: true, new: false } },
        });
      });
      return reply.status(204).send(null);
    },
  );
};
