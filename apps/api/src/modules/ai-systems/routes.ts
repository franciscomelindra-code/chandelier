import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AI_SYSTEM_STATUSES } from '@chandelier/shared';
import {
  COMPAT_EXPORT_HEADERS,
  SUBSTANTIAL_FIELDS,
  TEMPLATE_FIELDS,
  RISK_CATEGORY_META,
  VALUE_LEVEL_META,
  aiSystemCreateSchema,
  aiSystemListQuerySchema,
  aiSystemUpdateSchema,
  archiveSchema,
  bulkSchema,
  type RiskDisplayCategory,
  type ValueLevel,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { diff, recordAudit } from '../../audit/audit.js';
import { notify, triggerExceptionalReview } from '../notify.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { actorOf, requirePermission } from '../../http.js';
import { can, type AccessContext } from '../../rbac/access.js';
import { csvCell } from '../audit.js';
import {
  TRACKED_FIELDS,
  assignedSections,
  buildListWhere,
  loadVisible,
  refreshCompleteness,
  nextReference,
  orderBy,
  sectionOfField,
  serializeDetail,
  serializeListItem,
  snapshot,
  systemInclude,
  targetOf,
  type SystemRow,
} from './service.js';

type Tx = Prisma.TransactionClient;
const idParams = z.object({ id: z.uuid() });
const dateOrNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`);

async function assertActiveUsers(tx: Tx, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return;
  const n = await tx.user.count({ where: { id: { in: wanted }, isActive: true } });
  if (n !== wanted.length) throw badRequest('Utilisateur inconnu ou désactivé');
}

async function assertTags(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const n = await tx.tag.count({ where: { id: { in: ids } } });
  if (n !== new Set(ids).size) throw badRequest('Tag inconnu');
}

async function reload(tx: Tx, id: string): Promise<SystemRow> {
  return tx.aiSystem.findUniqueOrThrow({ where: { id }, include: systemInclude });
}

function requireUnitPermission(
  ctx: AccessContext,
  permission: 'aiSystem:create' | 'aiSystem:update',
  path: string,
  ownerId: string | null,
) {
  if (!can(ctx, permission, { orgUnitPath: path, ownerId, section: 'general', assignedSections: [] })) {
    throw forbidden('Unité organisationnelle hors de votre périmètre');
  }
}

export const aiSystemRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  // ── Liste ──────────────────────────────────────────────────────────────────
  app.get(
    '/',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Registre : recherche plein texte, filtres combinés, tri, pagination serveur',
        querystring: aiSystemListQuerySchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { page, pageSize, sort, dir, ...filters } = request.query;
      const where = await buildListWhere(prisma, ctx, filters);
      const [rows, total] = await prisma.$transaction([
        prisma.aiSystem.findMany({
          where,
          include: {
            ...systemInclude,
            sectionAssignments: { where: { userId: ctx.user.id }, select: { section: true } },
          },
          orderBy: orderBy(sort, dir),
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.aiSystem.count({ where }),
      ]);
      return {
        items: rows.map((r) =>
          serializeListItem(
            ctx,
            r,
            r.sectionAssignments.map((a) => a.section),
          ),
        ),
        total,
        page,
        pageSize,
      };
    },
  );

  // ── Export (même filtres que la liste) ────────────────────────────────────
  app.get(
    '/export',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Exporter le registre filtré (CSV compatible §5.12 ou JSON), 10 000 lignes max.',
        querystring: aiSystemListQuerySchema.extend({ format: z.enum(['csv', 'json']).default('csv') }),
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:export');
      const { page: _p, pageSize: _ps, sort, dir, format, ...filters } = request.query;
      const where = await buildListWhere(prisma, ctx, filters);
      const rows = await prisma.aiSystem.findMany({
        where,
        include: { ...systemInclude, notices: { select: { status: true, contentMarkdown: true } } },
        orderBy: orderBy(sort, dir),
        take: 10_000,
      });
      await prisma.$transaction((tx) =>
        recordAudit(tx, actorOf(request), {
          action: 'export',
          entityType: 'AiSystem',
          changes: {
            format: { old: null, new: format },
            filters: { old: null, new: filters },
            rows: { old: null, new: rows.length },
          },
        }),
      );
      const stamp = new Date().toISOString().slice(0, 10);
      const iso = (d: Date | null) => (d ? d.toISOString() : '');
      if (format === 'json') {
        const items = rows.map(({ notices, ...r }) => ({
          ...serializeDetail(ctx, r, []),
          transparencyNoticeDone: notices.some((n) => n.status === 'VALIDATED'),
        }));
        return reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="chandelier-registre-${stamp}.json"`)
          .send(JSON.stringify({ exportedAt: new Date().toISOString(), count: items.length, items }, null, 2));
      }
      const extra = [
        'Id',
        'OrgUnit',
        'Owner',
        'BusinessOwner',
        'AiActRoles',
        'Tags',
        'Completeness',
        'ComplianceStatus',
        'NextReview',
        'IsDemo',
      ];
      const lines = [[...COMPAT_EXPORT_HEADERS, ...extra].map(csvCell).join(';')];
      for (const r of rows) {
        const noticeDone = r.notices.some((n) => n.status === 'VALIDATED');
        lines.push(
          [
            r.name,
            r.reference,
            r.description,
            r.status,
            RISK_CATEGORY_META[r.riskCategory as RiskDisplayCategory].label,
            r.riskJustification,
            VALUE_LEVEL_META[r.valueLevel as ValueLevel].label,
            r.valueJustification,
            iso(r.archivedAt),
            iso(r.createdAt),
            iso(r.updatedAt),
            iso(r.firstDeploymentDate ?? r.productionDate),
            iso(r.actualRetirementDate ?? r.plannedRetirementDate),
            noticeDone ? 'true' : 'false',
            '',
            r.id,
            r.orgUnit.name,
            r.owner?.displayName ?? '',
            r.businessOwner?.displayName ?? '',
            r.aiActRoles.join(','),
            r.tags.map((t) => t.tag.label).join(','),
            String(r.completeness),
            r.complianceStatus,
            r.nextReviewDate ? r.nextReviewDate.toISOString().slice(0, 10) : '',
            r.isDemo ? 'true' : 'false',
          ]
            .map(csvCell)
            .join(';'),
        );
      }
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="chandelier-registre-${stamp}.csv"`)
        .send(`\uFEFF${lines.join('\r\n')}`);
    },
  );

  // ── Consultation ───────────────────────────────────────────────────────────
  app.get(
    '/:id',
    { schema: { tags: ['Systèmes d’IA'], summary: 'Fiche d’un SIA', params: idParams } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.id);
      return serializeDetail(ctx, system, sections);
    },
  );

  app.get(
    '/:id/history',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Historique des modifications du SIA (journal d’audit filtré)',
        params: idParams,
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
        }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system } = await loadVisible(prisma, ctx, request.params.id);
      const { page, pageSize } = request.query;
      const where: Prisma.AuditEventWhereInput = {
        OR: [{ aiSystemId: system.id }, { entityType: 'AiSystem', entityId: system.id }],
      };
      const [items, total] = await prisma.$transaction([
        prisma.auditEvent.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.auditEvent.count({ where }),
      ]);
      return { items: items.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })), total, page, pageSize };
    },
  );

  // ── Création ───────────────────────────────────────────────────────────────
  app.post(
    '/',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Créer un SIA (fiche vierge, statut Brouillon)',
        body: aiSystemCreateSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:create');
      const input = request.body;
      const ownerId = input.ownerId === undefined ? ctx.user.id : input.ownerId;
      const created = await prisma.$transaction(async (tx) => {
        const unit = await tx.organizationUnit.findUnique({ where: { id: input.orgUnitId } });
        if (!unit || !unit.isActive) throw badRequest('Unité organisationnelle inconnue ou désactivée');
        requireUnitPermission(ctx, 'aiSystem:create', unit.path, ownerId);
        await assertActiveUsers(tx, [ownerId, input.businessOwnerId]);
        const reference = input.reference ?? (await nextReference(tx));
        if (await tx.aiSystem.findUnique({ where: { reference } }))
          throw conflict(`Référence déjà utilisée : ${reference}`);
        // Création à partir d'un gabarit interne : seuls les champs autorisés sont recopiés.
        let fromTemplate: Record<string, unknown> = {};
        if (input.templateId) {
          const tpl = await tx.systemTemplate.findUnique({ where: { id: input.templateId } });
          if (!tpl || !tpl.isActive) throw badRequest('Gabarit inconnu ou désactivé');
          const data = (tpl.data ?? {}) as Record<string, unknown>;
          fromTemplate = Object.fromEntries(TEMPLATE_FIELDS.filter((f) => f in data).map((f) => [f, data[f]]));
        }
        const s = await tx.aiSystem.create({
          data: {
            ...(fromTemplate as Prisma.AiSystemUncheckedCreateInput),
            reference,
            name: input.name,
            purpose: input.purpose || (fromTemplate.purpose as string | undefined) || '',
            description: input.description || (fromTemplate.description as string | undefined) || '',
            orgUnitId: unit.id,
            ownerId,
            businessOwnerId: input.businessOwnerId ?? null,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        await refreshCompleteness(tx, s.id);
        const full = await reload(tx, s.id);
        await snapshot(tx, full, ctx.user.id, 'création');
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'AiSystem',
          entityId: s.id,
          aiSystemId: s.id,
          justification: input.templateId ? `Créé à partir du gabarit ${input.templateId}` : null,
          changes: diff(null, s, [
            'reference',
            'name',
            'purpose',
            'description',
            'orgUnitId',
            'ownerId',
            'businessOwnerId',
            'status',
          ]),
        });
        return full;
      });
      return reply.status(201).send(serializeDetail(ctx, created, []));
    },
  );

  // ── Modification (verrou optimiste, contrôle par section) ────────────────
  app.patch(
    '/:id',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Modifier un SIA (sauvegarde partielle, version obligatoire)',
        params: idParams,
        body: aiSystemUpdateSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { version, tagIds, ...fields } = request.body;
      const updated = await prisma.$transaction(async (tx) => {
        const { system: before, sections } = await loadVisible(tx, ctx, request.params.id);
        if (before.archivedAt) throw conflict('SIA archivé : restaurez-le avant toute modification');
        if (before.version !== version) {
          throw new AppError(
            409,
            'VERSION_CONFLICT',
            'La fiche a été modifiée entre-temps : rechargez-la avant d’enregistrer',
            {
              currentVersion: before.version,
            },
          );
        }
        const touched = [
          ...Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined),
          ...(tagIds ? ['tagIds'] : []),
        ];
        if (!touched.length) throw badRequest('Aucune modification');
        for (const f of touched) {
          if (!can(ctx, 'aiSystem:update', targetOf(before, sections, sectionOfField(f)))) {
            throw forbidden(`Modification non autorisée (section « ${sectionOfField(f)} »)`);
          }
        }
        if (fields.orgUnitId && fields.orgUnitId !== before.orgUnitId) {
          const unit = await tx.organizationUnit.findUnique({ where: { id: fields.orgUnitId } });
          if (!unit || !unit.isActive) throw badRequest('Unité organisationnelle inconnue ou désactivée');
          requireUnitPermission(ctx, 'aiSystem:update', unit.path, fields.ownerId ?? before.ownerId);
        }
        await assertActiveUsers(tx, [fields.ownerId, fields.businessOwnerId]);
        if (tagIds) await assertTags(tx, tagIds);

        const data: Prisma.AiSystemUncheckedUpdateInput = {
          ...fields,
          status: fields.status as (typeof AI_SYSTEM_STATUSES)[number] | undefined,
          firstDeploymentDate: dateOrNull(fields.firstDeploymentDate),
          productionDate: dateOrNull(fields.productionDate),
          plannedRetirementDate: dateOrNull(fields.plannedRetirementDate),
          actualRetirementDate: dateOrNull(fields.actualRetirementDate),
          nextReviewDate: dateOrNull(fields.nextReviewDate),
          // Détails de valeur : fusion avec l'existant (sauvegarde partielle).
          valueDetails: fields.valueDetails
            ? ({ ...((before.valueDetails as object | null) ?? {}), ...fields.valueDetails } as Prisma.InputJsonValue)
            : undefined,
          version: { increment: 1 },
          updatedById: ctx.user.id,
        };
        // Verrou optimiste au niveau SQL : la mise à jour échoue si la version a bougé entre-temps.
        const res = await tx.aiSystem.updateMany({ where: { id: before.id, version }, data });
        if (res.count !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'Conflit de version : rechargez la fiche');

        const changes = diff(
          before as unknown as Record<string, unknown>,
          (await tx.aiSystem.findUniqueOrThrow({ where: { id: before.id } })) as unknown as Record<string, unknown>,
          [...TRACKED_FIELDS],
        );
        if (tagIds) {
          const oldTags = before.tags.map((t) => t.tag.label).sort();
          await tx.aiSystemTag.deleteMany({ where: { aiSystemId: before.id } });
          if (tagIds.length)
            await tx.aiSystemTag.createMany({
              data: [...new Set(tagIds)].map((tagId) => ({ aiSystemId: before.id, tagId })),
            });
          const newTags = (await tx.tag.findMany({ where: { id: { in: tagIds } } })).map((t) => t.label).sort();
          if (JSON.stringify(oldTags) !== JSON.stringify(newTags)) changes.tags = { old: oldTags, new: newTags };
        }
        await refreshCompleteness(tx, before.id);
        const after = await reload(tx, before.id);
        await snapshot(tx, after, ctx.user.id, 'modification');
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'AiSystem',
          entityId: before.id,
          aiSystemId: before.id,
          changes,
        });
        // Modification substantielle d'un SIA validé → revue exceptionnelle (F-040).
        await triggerExceptionalReview(
          tx,
          actorOf(request),
          after,
          Object.keys(changes)
            .map((k) => SUBSTANTIAL_FIELDS[k])
            .filter((t): t is NonNullable<typeof t> => !!t),
        );
        return { after, sections };
      });
      return serializeDetail(ctx, updated.after, updated.sections);
    },
  );

  // ── Archivage / restauration motivés ───────────────────────────────────────
  async function archiveOne(
    tx: Tx,
    ctx: AccessContext,
    s: SystemRow,
    sections: string[],
    reason: string,
    actor: ReturnType<typeof actorOf>,
  ) {
    if (!can(ctx, 'aiSystem:archive', targetOf(s, sections)))
      throw forbidden(`Archivage non autorisé : ${s.reference}`);
    if (s.archivedAt) throw conflict(`SIA déjà archivé : ${s.reference}`);
    await tx.aiSystem.update({
      where: { id: s.id },
      data: {
        archivedAt: new Date(),
        archivedById: ctx.user.id,
        archiveReason: reason,
        statusBeforeArchive: s.status,
        status: 'ARCHIVED',
        version: { increment: 1 },
        updatedById: ctx.user.id,
      },
    });
    const after = await reload(tx, s.id);
    await snapshot(tx, after, ctx.user.id, 'archivage');
    await recordAudit(tx, actor, {
      action: 'archive',
      entityType: 'AiSystem',
      entityId: s.id,
      aiSystemId: s.id,
      justification: reason,
      changes: { status: { old: s.status, new: 'ARCHIVED' } },
    });
    return after;
  }

  app.post(
    '/:id/archive',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Archiver (suppression logique, justification obligatoire)',
        params: idParams,
        body: archiveSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:archive');
      const after = await prisma.$transaction(async (tx) => {
        const { system, sections } = await loadVisible(tx, ctx, request.params.id);
        return archiveOne(tx, ctx, system, sections, request.body.reason, actorOf(request));
      });
      return serializeDetail(ctx, after, await assignedSections(prisma, after.id, ctx.user.id));
    },
  );

  app.post(
    '/:id/restore',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Restaurer un SIA archivé (justification obligatoire)',
        params: idParams,
        body: archiveSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:archive');
      const after = await prisma.$transaction(async (tx) => {
        const { system: s, sections } = await loadVisible(tx, ctx, request.params.id);
        if (!can(ctx, 'aiSystem:archive', targetOf(s, sections))) throw forbidden();
        if (!s.archivedAt) throw conflict('Ce SIA n’est pas archivé');
        const status = s.statusBeforeArchive ?? 'DRAFT';
        await tx.aiSystem.update({
          where: { id: s.id },
          data: {
            archivedAt: null,
            archivedById: null,
            archiveReason: null,
            statusBeforeArchive: null,
            status,
            version: { increment: 1 },
            updatedById: ctx.user.id,
          },
        });
        const after = await reload(tx, s.id);
        await snapshot(tx, after, ctx.user.id, 'restauration');
        await recordAudit(tx, actorOf(request), {
          action: 'restore',
          entityType: 'AiSystem',
          entityId: s.id,
          aiSystemId: s.id,
          justification: request.body.reason,
          changes: { status: { old: 'ARCHIVED', new: status } },
        });
        return after;
      });
      return serializeDetail(ctx, after, await assignedSections(prisma, after.id, ctx.user.id));
    },
  );

  // ── Actions de masse (tout ou rien) ────────────────────────────────────────
  app.post(
    '/bulk',
    {
      schema: {
        tags: ['Systèmes d’IA'],
        summary: 'Actions de masse transactionnelles : refus global si un seul SIA n’est pas autorisé',
        body: bulkSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const input = request.body;
      const ids = [...new Set(input.ids)];
      const result = await prisma.$transaction(
        async (tx) => {
          const rows = await tx.aiSystem.findMany({
            where: { id: { in: ids } },
            include: {
              ...systemInclude,
              sectionAssignments: { where: { userId: ctx.user.id }, select: { section: true } },
            },
          });
          if (rows.length !== ids.length) throw notFound('SIA introuvable dans la sélection');
          const sectionsOf = (r: (typeof rows)[number]) => r.sectionAssignments.map((a) => a.section);
          const visible = rows.filter((r) => can(ctx, 'aiSystem:read', targetOf(r, sectionsOf(r))));
          if (visible.length !== rows.length) throw notFound('SIA introuvable dans la sélection');

          let targetUnitPath: string | null = null;
          if (input.action === 'setOrgUnit') {
            const unit = await tx.organizationUnit.findUnique({ where: { id: input.orgUnitId } });
            if (!unit || !unit.isActive) throw badRequest('Unité organisationnelle inconnue ou désactivée');
            targetUnitPath = unit.path;
          }
          if (input.action === 'assignOwner') await assertActiveUsers(tx, [input.ownerId]);
          if (input.action === 'addTags' || input.action === 'removeTags') await assertTags(tx, input.tagIds);
          if (input.action === 'startReview') await assertActiveUsers(tx, [input.reviewerId]);

          const section = input.action === 'assignOwner' ? 'responsibility' : 'general';
          const denied = rows.filter((r) => {
            if (input.action === 'archive')
              return !can(ctx, 'aiSystem:archive', targetOf(r, sectionsOf(r))) || !!r.archivedAt;
            if (input.action === 'startReview')
              return !can(ctx, 'review:manage', targetOf(r, sectionsOf(r))) || !!r.archivedAt;
            if (r.archivedAt) return true;
            if (!can(ctx, 'aiSystem:update', targetOf(r, sectionsOf(r), section))) return true;
            if (
              targetUnitPath &&
              !can(ctx, 'aiSystem:update', {
                orgUnitPath: targetUnitPath,
                ownerId: r.ownerId,
                section,
                assignedSections: sectionsOf(r),
              })
            )
              return true;
            return false;
          });
          if (denied.length) {
            throw new AppError(
              403,
              'FORBIDDEN',
              'Action refusée : au moins un SIA n’est pas modifiable (droits ou archivage). Aucune modification effectuée.',
              {
                denied: denied.map((d) => d.reference),
              },
            );
          }

          const actor = { ...actorOf(request) };
          for (const r of rows) {
            if (input.action === 'archive') {
              await archiveOne(tx, ctx, r, sectionsOf(r), input.reason, actor);
              continue;
            }
            if (input.action === 'startReview') {
              const review = await tx.review.create({
                data: {
                  aiSystemId: r.id,
                  kind: 'PERIODIC',
                  trigger: 'MANUAL',
                  dueDate: new Date(`T00:00:00Z`),
                  reviewerId: input.reviewerId,
                  createdById: ctx.user.id,
                },
              });
              await recordAudit(tx, actor, {
                action: 'bulk_startReview',
                entityType: 'Review',
                entityId: review.id,
                aiSystemId: r.id,
                changes: { dueDate: { old: null, new: input.dueDate } },
              });
              await notify(
                tx,
                [input.reviewerId ?? r.ownerId],
                {
                  type: 'review',
                  title: `Revue à réaliser — ${r.reference}`,
                  body: `Échéance : ${input.dueDate}`,
                  link: `/systemes/${r.id}?onglet=validation`,
                },
                ctx.user.id,
              );
              continue;
            }
            const changes: Record<string, { old: unknown; new: unknown }> = {};
            const data: Prisma.AiSystemUncheckedUpdateInput = { version: { increment: 1 }, updatedById: ctx.user.id };
            if (input.action === 'assignOwner' && r.ownerId !== input.ownerId) {
              data.ownerId = input.ownerId;
              changes.ownerId = { old: r.ownerId, new: input.ownerId };
            }
            if (input.action === 'setOrgUnit' && r.orgUnitId !== input.orgUnitId) {
              data.orgUnitId = input.orgUnitId;
              changes.orgUnitId = { old: r.orgUnitId, new: input.orgUnitId };
            }
            if (input.action === 'setStatus' && r.status !== input.status) {
              data.status = input.status as (typeof AI_SYSTEM_STATUSES)[number];
              changes.status = { old: r.status, new: input.status };
            }
            if (input.action === 'addTags') {
              const existing = new Set(r.tags.map((t) => t.tagId));
              const toAdd = input.tagIds.filter((t) => !existing.has(t));
              if (toAdd.length) {
                await tx.aiSystemTag.createMany({ data: toAdd.map((tagId) => ({ aiSystemId: r.id, tagId })) });
                changes.tagIds = { old: [...existing], new: [...existing, ...toAdd] };
              }
            }
            if (input.action === 'removeTags') {
              const existing = r.tags.map((t) => t.tagId);
              const kept = existing.filter((t) => !input.tagIds.includes(t));
              if (kept.length !== existing.length) {
                await tx.aiSystemTag.deleteMany({ where: { aiSystemId: r.id, tagId: { in: input.tagIds } } });
                changes.tagIds = { old: existing, new: kept };
              }
            }
            if (!Object.keys(changes).length) continue;
            await tx.aiSystem.update({ where: { id: r.id }, data });
            await refreshCompleteness(tx, r.id);
            await snapshot(tx, await reload(tx, r.id), ctx.user.id, `action de masse : ${input.action}`);
            await recordAudit(tx, actor, {
              action: `bulk_${input.action}`,
              entityType: 'AiSystem',
              entityId: r.id,
              aiSystemId: r.id,
              changes,
            });
          }
          return { action: input.action, count: rows.length };
        },
        { timeout: 60_000 },
      );
      return result;
    },
  );
};
