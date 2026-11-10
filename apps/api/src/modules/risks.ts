import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  RISK_WARNINGS,
  isExistingMeasure,
  isOpenAction,
  levelOf,
  measureCreateSchema,
  measureUpdateSchema,
  methodologyConfigSchema,
  methodologyCreateSchema,
  riskCreateSchema,
  riskListQuerySchema,
  riskRescoreSchema,
  riskUpdateSchema,
  riskWarnings,
  scoringErrors,
  topLevel,
  type MethodologyConfig,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, type AccessContext } from '../rbac/access.js';
import { loadVisible, scopeWhere, targetOf, type SystemRow } from './ai-systems/service.js';
import { dayOf, namesFor, nextSeqReference, requireActiveUser, toDate, today, type Db } from './common.js';

const id = z.uuid();

const riskInclude = {
  methodology: true,
  aiSystem: { select: { id: true, reference: true, name: true, isDemo: true, archivedAt: true } },
  measures: { include: { measure: true }, orderBy: { createdAt: 'asc' } },
  actions: { select: { id: true, reference: true, title: true, status: true, dueDate: true, assigneeId: true } },
} satisfies Prisma.RiskInclude;
type RiskRow = Prisma.RiskGetPayload<{ include: typeof riskInclude }>;

const cfgOf = (m: { config: Prisma.JsonValue }) => methodologyConfigSchema.parse(m.config);

async function activeMethodology(db: Db) {
  const m = await db.riskMethodology.findFirst({ where: { isActive: true } });
  if (!m) throw new AppError(503, 'NO_METHODOLOGY', 'Aucune méthodologie de risque active');
  return m;
}

const SCORE_FIELDS = ['inherentLikelihood', 'inherentSeverity', 'residualLikelihood', 'residualSeverity'] as const;
const AUDITED = [
  'category',
  'title',
  'scenario',
  'cause',
  'event',
  'consequence',
  ...SCORE_FIELDS,
  'inherentScore',
  'residualScore',
  'treatment',
  'treatmentPlan',
  'acceptanceJustification',
  'status',
  'ownerId',
  'dueDate',
] as const;

function serializeRisk(r: RiskRow, names: Map<string, string>, perms?: { canManage: boolean; canAccept: boolean }) {
  const cfg = cfgOf(r.methodology);
  const existingMeasures = r.measures.filter((m) => isExistingMeasure(m.measure.status)).length;
  const dueDate = dayOf(r.dueDate);
  const effectiveScore = r.residualScore ?? r.inherentScore;
  const warnings = riskWarnings(
    { ...r, dueDate, existingMeasures, methodologyActive: r.methodology.isActive },
    today(),
  );
  return {
    id: r.id,
    reference: r.reference,
    aiSystem: { id: r.aiSystem.id, reference: r.aiSystem.reference, name: r.aiSystem.name, isDemo: r.aiSystem.isDemo },
    methodology: {
      id: r.methodology.id,
      name: r.methodology.name,
      version: r.methodology.version,
      isActive: r.methodology.isActive,
    },
    category: r.category,
    title: r.title,
    scenario: r.scenario,
    cause: r.cause,
    event: r.event,
    consequence: r.consequence,
    inherentLikelihood: r.inherentLikelihood,
    inherentSeverity: r.inherentSeverity,
    inherentScore: r.inherentScore,
    inherentLevel: levelOf(cfg, r.inherentScore),
    residualLikelihood: r.residualLikelihood,
    residualSeverity: r.residualSeverity,
    residualScore: r.residualScore,
    residualLevel: levelOf(cfg, r.residualScore),
    effectiveScore,
    effectiveLevel: levelOf(cfg, effectiveScore),
    treatment: r.treatment,
    treatmentPlan: r.treatmentPlan,
    acceptanceJustification: r.acceptanceJustification,
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    acceptedBy: r.acceptedById ? (names.get(r.acceptedById) ?? null) : null,
    status: r.status,
    owner: r.ownerId ? { id: r.ownerId, displayName: names.get(r.ownerId) ?? '—' } : null,
    dueDate,
    version: r.version,
    measures: r.measures.map(({ measure: m }) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      status: m.status,
      isExisting: isExistingMeasure(m.status),
      dueDate: dayOf(m.dueDate),
      owner: m.ownerId ? (names.get(m.ownerId) ?? null) : null,
    })),
    actions: r.actions.map((a) => ({
      id: a.id,
      reference: a.reference,
      title: a.title,
      status: a.status,
      dueDate: dayOf(a.dueDate),
      assignee: a.assigneeId ? (names.get(a.assigneeId) ?? null) : null,
    })),
    openActions: r.actions.filter((a) => isOpenAction(a.status)).length,
    warnings: warnings.map((code) => ({ code, message: RISK_WARNINGS[code] })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(perms ? { permissions: perms } : {}),
  };
}

async function riskNames(db: Db, rows: RiskRow[]) {
  return namesFor(
    db,
    rows.flatMap((r) => [
      r.ownerId,
      r.acceptedById,
      ...r.measures.map((m) => m.measure.ownerId),
      ...r.actions.map((a) => a.assigneeId),
    ]),
  );
}

/** Méthodologie et carte de chaleur d'un ensemble de risques (méthodologie active uniquement). */
function heatmap(cfg: MethodologyConfig, risks: ReturnType<typeof serializeRisk>[]) {
  const cells: Record<string, number> = {};
  let excluded = 0;
  for (const r of risks) {
    if (!r.methodology.isActive || r.inherentLikelihood == null) {
      excluded++;
      continue;
    }
    const l = r.residualLikelihood ?? r.inherentLikelihood;
    const s = r.residualSeverity ?? r.inherentSeverity!;
    cells[`${l}-${s}`] = (cells[`${l}-${s}`] ?? 0) + 1;
  }
  return { cells, excluded, basis: 'Résiduel, à défaut inhérent' };
}

export const riskRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;
  const tags = ['Risques et mesures'];

  const manageCtx = (ctx: AccessContext, s: SystemRow, sections: string[]) => {
    if (!can(ctx, 'risk:manage', targetOf(s, sections)))
      throw forbidden('Droit de gestion des risques requis sur ce SIA');
    if (s.archivedAt) throw conflict('SIA archivé : registre des risques en lecture seule');
  };
  async function loadRisk(db: Db, ctx: AccessContext, riskId: string) {
    const r = await db.risk.findUnique({ where: { id: riskId }, include: riskInclude });
    if (!r) throw notFound('Risque introuvable');
    // 404 hors périmètre (pas de fuite d'existence).
    const { system, sections } = await loadVisible(db, ctx, r.aiSystemId).catch(() => {
      throw notFound('Risque introuvable');
    });
    return { r, system, sections };
  }
  const permsOf = (ctx: AccessContext, s: SystemRow, sections: string[]) => ({
    canManage: !s.archivedAt && can(ctx, 'risk:manage', targetOf(s, sections)),
    canAccept: can(ctx, 'assessment:validate', targetOf(s, sections)),
  });
  async function riskOut(db: Db, ctx: AccessContext, riskId: string) {
    const { r, system, sections } = await loadRisk(db, ctx, riskId);
    return serializeRisk(r, await riskNames(db, [r]), permsOf(ctx, system, sections));
  }

  // ── Méthodologies ──
  const methodologyOut = async (db: Db, m: Prisma.RiskMethodologyGetPayload<object>) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    isActive: m.isActive,
    config: cfgOf(m),
    riskCount: await db.risk.count({ where: { methodologyId: m.id } }),
    createdAt: m.createdAt.toISOString(),
  });

  app.get(
    '/risk-methodologies',
    { schema: { tags, summary: 'Versions de la méthodologie de cotation' } },
    async (request) => {
      requirePermission(request, 'aiSystem:read');
      const list = await prisma.riskMethodology.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] });
      return { items: await Promise.all(list.map((m) => methodologyOut(prisma, m))) };
    },
  );

  app.post(
    '/risk-methodologies',
    {
      schema: {
        tags,
        summary: 'Nouvelle version (inactive) de méthodologie — administrateur',
        body: methodologyCreateSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'settings:manage');
      const m = await prisma.$transaction(async (tx) => {
        const last = await tx.riskMethodology.findFirst({
          where: { name: request.body.name },
          orderBy: { version: 'desc' },
        });
        const created = await tx.riskMethodology.create({
          data: {
            name: request.body.name,
            version: (last?.version ?? 0) + 1,
            isActive: false,
            config: request.body.config as Prisma.InputJsonValue,
            createdById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'RiskMethodology',
          entityId: created.id,
          changes: { version: { old: null, new: `${created.name} v${created.version}` } },
        });
        return created;
      });
      return reply.status(201).send(await methodologyOut(prisma, m));
    },
  );

  app.patch(
    '/risk-methodologies/:mid',
    {
      schema: {
        tags,
        summary: 'Modifier une version jamais activée et non utilisée',
        params: z.object({ mid: id }),
        body: z.strictObject({ config: methodologyConfigSchema }),
      },
    },
    async (request) => {
      requirePermission(request, 'settings:manage');
      const m = await prisma.$transaction(async (tx) => {
        const m = await tx.riskMethodology.findUnique({ where: { id: request.params.mid } });
        if (!m) throw notFound();
        if (m.isActive || (await tx.risk.count({ where: { methodologyId: m.id } })))
          throw conflict('Version déjà utilisée : créez une nouvelle version');
        const used = await tx.auditEvent.count({
          where: { entityType: 'RiskMethodology', entityId: m.id, action: 'activate' },
        });
        if (used) throw conflict('Version déjà activée par le passé : créez une nouvelle version');
        const updated = await tx.riskMethodology.update({
          where: { id: m.id },
          data: { config: request.body.config as Prisma.InputJsonValue },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'RiskMethodology',
          entityId: m.id,
          changes: { config: { old: m.config, new: request.body.config } },
        });
        return updated;
      });
      return methodologyOut(prisma, m);
    },
  );

  app.post(
    '/risk-methodologies/:mid/activate',
    {
      schema: {
        tags,
        summary: 'Activer une version (les risques existants gardent la leur et sont signalés « à recoter »)',
        params: z.object({ mid: id }),
        body: z.strictObject({ justification: z.string().trim().min(10).max(2000) }),
      },
    },
    async (request) => {
      requirePermission(request, 'settings:manage');
      const m = await prisma.$transaction(async (tx) => {
        const m = await tx.riskMethodology.findUnique({ where: { id: request.params.mid } });
        if (!m) throw notFound();
        if (m.isActive) throw conflict('Version déjà active');
        const previous = await tx.riskMethodology.findFirst({ where: { isActive: true } });
        await tx.riskMethodology.updateMany({ where: { isActive: true }, data: { isActive: false } });
        const updated = await tx.riskMethodology.update({ where: { id: m.id }, data: { isActive: true } });
        await recordAudit(tx, actorOf(request), {
          action: 'activate',
          entityType: 'RiskMethodology',
          entityId: m.id,
          justification: request.body.justification,
          changes: {
            active: {
              old: previous ? `${previous.name} v${previous.version}` : null,
              new: `${m.name} v${m.version}`,
            },
          },
        });
        return updated;
      });
      return methodologyOut(prisma, m);
    },
  );

  // ── Portefeuille des risques ──
  app.get(
    '/risks',
    { schema: { tags, summary: 'Risques du périmètre (filtres, carte de chaleur)', querystring: riskListQuerySchema } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const q = request.query;
      const and: Prisma.RiskWhereInput[] = [{ aiSystem: { AND: [scopeWhere(ctx), { archivedAt: null }] } }];
      if (q.aiSystemId) and.push({ aiSystemId: q.aiSystemId });
      if (q.category) and.push({ category: { in: q.category } });
      if (q.status) and.push({ status: { in: q.status } });
      else if (q.includeClosed === 'false') and.push({ status: { not: 'CLOSED' } });
      if (q.ownerId) and.push({ ownerId: q.ownerId });
      if (q.demo === 'exclude') and.push({ aiSystem: { isDemo: false } });
      if (q.demo === 'only') and.push({ aiSystem: { isDemo: true } });
      if (q.q)
        and.push({
          OR: [
            { reference: { contains: q.q, mode: 'insensitive' } },
            { title: { contains: q.q, mode: 'insensitive' } },
            { scenario: { contains: q.q, mode: 'insensitive' } },
            { aiSystem: { name: { contains: q.q, mode: 'insensitive' } } },
            { aiSystem: { reference: { contains: q.q, mode: 'insensitive' } } },
          ],
        });
      // Le niveau dépend de la méthodologie de chaque risque : filtrage et tri après calcul (plafond 5 000).
      const rows = await prisma.risk.findMany({ where: { AND: and }, include: riskInclude, take: 5000 });
      const names = await riskNames(prisma, rows);
      let items = rows.map((r) => serializeRisk(r, names));
      if (q.level) {
        const levels = q.level.split(',');
        items = items.filter((r) => r.effectiveLevel && levels.includes(r.effectiveLevel.level));
      }
      if (q.warning) items = items.filter((r) => r.warnings.some((w) => w.code === q.warning));
      const active = await activeMethodology(prisma);
      const activeCfg = cfgOf(active);
      const map = heatmap(activeCfg, items);
      const levelCounts: Record<string, number> = {};
      for (const r of items) {
        const k = r.effectiveLevel?.level ?? 'NOT_SCORED';
        levelCounts[k] = (levelCounts[k] ?? 0) + 1;
      }
      if (q.cell) {
        const [l, s] = q.cell.split('-').map(Number);
        items = items.filter(
          (r) =>
            r.methodology.isActive &&
            r.inherentLikelihood != null &&
            (r.residualLikelihood ?? r.inherentLikelihood) === l &&
            (r.residualSeverity ?? r.inherentSeverity) === s,
        );
      }
      const dir = q.dir === 'asc' ? 1 : -1;
      const key = (r: (typeof items)[number]): string | number => {
        switch (q.sort) {
          case 'score':
            return r.effectiveScore ?? -1;
          case 'dueDate':
            return r.dueDate ?? '9999-12-31';
          case 'updatedAt':
            return r.updatedAt;
          case 'title':
            return r.title.toLocaleLowerCase('fr');
          default:
            return r.reference;
        }
      };
      items.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return (x < y ? -1 : x > y ? 1 : a.reference.localeCompare(b.reference)) * (x === y ? 1 : dir);
      });
      const total = items.length;
      const start = (q.page - 1) * q.pageSize;
      return {
        items: items.slice(start, start + q.pageSize),
        total,
        page: q.page,
        pageSize: q.pageSize,
        truncated: rows.length === 5000,
        heatmap: map,
        levelCounts,
        methodology: await methodologyOut(prisma, active),
      };
    },
  );

  // ── Risques d'un SIA ──
  app.get(
    '/ai-systems/:sid/risks',
    { schema: { tags, summary: 'Registre des risques du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      const rows = await prisma.risk.findMany({
        where: { aiSystemId: system.id },
        include: riskInclude,
        orderBy: { reference: 'asc' },
      });
      const names = await riskNames(prisma, rows);
      const items = rows.map((r) => serializeRisk(r, names));
      const active = await activeMethodology(prisma);
      return {
        items,
        heatmap: heatmap(
          cfgOf(active),
          items.filter((r) => r.status !== 'CLOSED'),
        ),
        methodology: await methodologyOut(prisma, active),
        permissions: permsOf(ctx, system, sections),
      };
    },
  );

  app.post(
    '/ai-systems/:sid/risks',
    {
      schema: {
        tags,
        summary: 'Créer un risque (méthodologie active)',
        params: z.object({ sid: id }),
        body: riskCreateSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const b = request.body;
      const riskId = await prisma.$transaction(async (tx) => {
        const { system, sections } = await loadVisible(tx, ctx, request.params.sid);
        manageCtx(ctx, system, sections);
        await requireActiveUser(tx, b.ownerId, 'Propriétaire');
        const m = await activeMethodology(tx);
        const cfg = cfgOf(m);
        const errors = scoringErrors(cfg, { ...b, residualLikelihood: null, residualSeverity: null });
        if (errors.length) throw badRequest(errors.join(' ; '), { errors });
        const scored = b.inherentLikelihood != null && b.inherentSeverity != null;
        const r = await tx.risk.create({
          data: {
            ...b,
            reference: await nextSeqReference(tx, 'risk', 'RSK'),
            aiSystemId: system.id,
            methodologyId: m.id,
            dueDate: toDate(b.dueDate),
            inherentScore: scored ? b.inherentLikelihood! * b.inherentSeverity! : null,
            status: scored ? 'ASSESSED' : 'IDENTIFIED',
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'Risk',
          entityId: r.id,
          aiSystemId: system.id,
          changes: {
            reference: { old: null, new: r.reference },
            title: { old: null, new: r.title },
            category: { old: null, new: r.category },
            inherentScore: { old: null, new: r.inherentScore },
          },
        });
        return r.id;
      });
      return reply.status(201).send(await riskOut(prisma, ctx, riskId));
    },
  );

  app.get(
    '/risks/:rid',
    { schema: { tags, summary: 'Détail d’un risque', params: z.object({ rid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      return riskOut(prisma, ctx, request.params.rid);
    },
  );

  app.get(
    '/risks/:rid/history',
    { schema: { tags, summary: 'Historique du risque (journal d’audit)', params: z.object({ rid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { r } = await loadRisk(prisma, ctx, request.params.rid);
      const events = await prisma.auditEvent.findMany({
        where: { entityType: 'Risk', entityId: r.id },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      });
      return {
        items: events.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt.toISOString(),
          actorLabel: e.actorLabel,
          action: e.action,
          changes: e.changes,
          justification: e.justification,
        })),
      };
    },
  );

  app.patch(
    '/risks/:rid',
    {
      schema: {
        tags,
        summary: 'Modifier un risque (verrou optimiste, règles de cotation et d’acceptation)',
        params: z.object({ rid: id }),
        body: riskUpdateSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { version, acceptanceJustification, ...b } = request.body;
      await prisma.$transaction(async (tx) => {
        const { r, system, sections } = await loadRisk(tx, ctx, request.params.rid);
        manageCtx(ctx, system, sections);
        if (r.version !== version)
          throw conflict('Le risque a été modifié par ailleurs : rechargez la page', { currentVersion: r.version });
        await requireActiveUser(tx, b.ownerId, 'Propriétaire');
        const cfg = cfgOf(r.methodology);
        const next = { ...r, ...b };
        const scoresChanged = SCORE_FIELDS.some((f) => b[f] !== undefined && b[f] !== r[f]);
        if (scoresChanged && !r.methodology.isActive)
          throw conflict('Méthodologie remplacée : utilisez « Recoter » pour passer à la méthodologie active');
        const errors = scoringErrors(cfg, next);
        if (errors.length) throw badRequest(errors.join(' ; '), { errors });
        const inherentScore = next.inherentLikelihood != null ? next.inherentLikelihood * next.inherentSeverity! : null;
        const residualScore = next.residualLikelihood != null ? next.residualLikelihood * next.residualSeverity! : null;

        // Acceptation : décision motivée, réservée aux rôles de validation pour le niveau le plus élevé.
        const data: Prisma.RiskUncheckedUpdateInput = {};
        const effective = levelOf(cfg, residualScore ?? inherentScore);
        let acceptance: 'record' | 'clear' | null = null;
        if (next.treatment === 'ACCEPT') {
          const wasAccepted = r.treatment === 'ACCEPT' && !!r.acceptedAt;
          if (acceptanceJustification !== undefined || !wasAccepted || scoresChanged) {
            const just = (acceptanceJustification ?? (scoresChanged ? '' : r.acceptanceJustification)).trim();
            if (just.length < 20)
              throw badRequest(
                scoresChanged && wasAccepted
                  ? 'Cotation modifiée sur un risque accepté : renouvelez la justification d’acceptation (20 caractères minimum)'
                  : 'Justification d’acceptation obligatoire (20 caractères minimum)',
              );
            if (effective?.level === topLevel(cfg) && !can(ctx, 'assessment:validate', targetOf(system, sections)))
              throw forbidden(
                `L’acceptation d’un risque « ${effective.label} » est réservée aux rôles de validation (DPO, juridique, référent IA)`,
              );
            Object.assign(data, { acceptanceJustification: just, acceptedAt: new Date(), acceptedById: ctx.user.id });
            acceptance = 'record';
          }
        } else if (r.treatment === 'ACCEPT' && b.treatment !== undefined) {
          Object.assign(data, { acceptanceJustification: '', acceptedAt: null, acceptedById: null });
          acceptance = 'clear';
        }

        // Statut : transitions automatiques si non fourni, contrôles sinon.
        let status = b.status ?? r.status;
        if (b.status === undefined) {
          if (status === 'IDENTIFIED' && inherentScore != null) status = 'ASSESSED';
          if (status === 'ASSESSED' && next.treatment && next.treatment !== 'ACCEPT') status = 'IN_TREATMENT';
          if (acceptance === 'record') status = 'ACCEPTED';
          if (acceptance === 'clear' && status === 'ACCEPTED') status = next.treatment ? 'IN_TREATMENT' : 'ASSESSED';
        }
        if (status === 'ACCEPTED' && next.treatment !== 'ACCEPT')
          throw badRequest('Le statut « Accepté » suppose le traitement « Accepter »');
        if (status !== 'IDENTIFIED' && status !== 'CLOSED' && inherentScore == null)
          throw badRequest('Cotez le risque inhérent avant de changer son statut');
        if (status === 'CLOSED' && r.status !== 'CLOSED') {
          const open = r.actions.filter((a) => isOpenAction(a.status)).length;
          if (open) throw conflict(`${open} action(s) ouverte(s) liée(s) : terminez-les ou annulez-les avant de clore`);
        }

        const updated = await tx.risk.update({
          where: { id: r.id },
          data: {
            ...b,
            ...data,
            dueDate: toDate(b.dueDate),
            inherentScore,
            residualScore,
            status,
            version: { increment: 1 },
            updatedById: ctx.user.id,
          },
        });
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const f of AUDITED) {
          const o = r[f] instanceof Date ? dayOf(r[f] as Date) : r[f];
          const n = updated[f] instanceof Date ? dayOf(updated[f] as Date) : updated[f];
          if (JSON.stringify(o ?? null) !== JSON.stringify(n ?? null)) changes[f] = { old: o ?? null, new: n ?? null };
        }
        await recordAudit(tx, actorOf(request), {
          action: acceptance === 'record' ? 'accept_risk' : 'update',
          entityType: 'Risk',
          entityId: r.id,
          aiSystemId: system.id,
          justification: acceptance === 'record' ? (data.acceptanceJustification as string) : null,
          changes,
        });
      });
      return riskOut(prisma, ctx, request.params.rid);
    },
  );

  app.post(
    '/risks/:rid/rescore',
    {
      schema: {
        tags,
        summary: 'Recoter selon la méthodologie active',
        params: z.object({ rid: id }),
        body: riskRescoreSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { version, justification, ...scores } = request.body;
      await prisma.$transaction(async (tx) => {
        const { r, system, sections } = await loadRisk(tx, ctx, request.params.rid);
        manageCtx(ctx, system, sections);
        if (r.version !== version) throw conflict('Le risque a été modifié par ailleurs : rechargez la page');
        const m = await activeMethodology(tx);
        if (m.id === r.methodologyId) throw conflict('Le risque utilise déjà la méthodologie active');
        const errors = scoringErrors(cfgOf(m), scores);
        if (errors.length) throw badRequest(errors.join(' ; '), { errors });
        const inherentScore = scores.inherentLikelihood * scores.inherentSeverity;
        const residualScore =
          scores.residualLikelihood != null ? scores.residualLikelihood * scores.residualSeverity! : null;
        const wasAccepted = r.status === 'ACCEPTED';
        await tx.risk.update({
          where: { id: r.id },
          data: {
            ...scores,
            methodologyId: m.id,
            inherentScore,
            residualScore,
            // Une nouvelle échelle invalide une acceptation antérieure.
            ...(r.acceptedAt ? { acceptedAt: null, acceptedById: null } : {}),
            ...(wasAccepted ? { status: 'ASSESSED' } : r.status === 'IDENTIFIED' ? { status: 'ASSESSED' } : {}),
            version: { increment: 1 },
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'rescore',
          entityType: 'Risk',
          entityId: r.id,
          aiSystemId: system.id,
          justification,
          changes: {
            methodology: { old: `${r.methodology.name} v${r.methodology.version}`, new: `${m.name} v${m.version}` },
            inherentScore: { old: r.inherentScore, new: inherentScore },
            residualScore: { old: r.residualScore, new: residualScore },
            ...(wasAccepted ? { status: { old: 'ACCEPTED', new: 'ASSESSED' } } : {}),
          },
        });
      });
      return riskOut(prisma, ctx, request.params.rid);
    },
  );

  // ── Mesures ──
  const measureOut = (
    m: Prisma.MeasureGetPayload<{
      include: { risks: { include: { risk: { select: { id: true; reference: true; title: true } } } } };
    }>,
    names: Map<string, string>,
  ) => ({
    id: m.id,
    aiSystemId: m.aiSystemId,
    title: m.title,
    description: m.description,
    type: m.type,
    status: m.status,
    isExisting: isExistingMeasure(m.status),
    owner: m.ownerId ? { id: m.ownerId, displayName: names.get(m.ownerId) ?? '—' } : null,
    dueDate: dayOf(m.dueDate),
    risks: m.risks.map((l) => l.risk),
    updatedAt: m.updatedAt.toISOString(),
  });
  const measureInclude = {
    risks: { include: { risk: { select: { id: true, reference: true, title: true } } } },
  } as const;

  app.get(
    '/ai-systems/:sid/measures',
    { schema: { tags, summary: 'Mesures du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      const list = await prisma.measure.findMany({
        where: { aiSystemId: system.id },
        include: measureInclude,
        orderBy: { createdAt: 'asc' },
      });
      const names = await namesFor(
        prisma,
        list.map((m) => m.ownerId),
      );
      return { items: list.map((m) => measureOut(m, names)), permissions: permsOf(ctx, system, sections) };
    },
  );

  app.post(
    '/ai-systems/:sid/measures',
    {
      schema: {
        tags,
        summary: 'Créer une mesure (et la rattacher à un risque)',
        params: z.object({ sid: id }),
        body: measureCreateSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { riskId, ...b } = request.body;
      const out = await prisma.$transaction(async (tx) => {
        const { system, sections } = await loadVisible(tx, ctx, request.params.sid);
        manageCtx(ctx, system, sections);
        await requireActiveUser(tx, b.ownerId, 'Responsable');
        if (riskId) {
          const r = await tx.risk.findUnique({ where: { id: riskId }, select: { aiSystemId: true } });
          if (!r || r.aiSystemId !== system.id) throw badRequest('Risque inconnu pour ce SIA');
        }
        const m = await tx.measure.create({
          data: {
            ...b,
            aiSystemId: system.id,
            dueDate: toDate(b.dueDate),
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
            ...(riskId ? { risks: { create: { riskId } } } : {}),
          },
          include: measureInclude,
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'Measure',
          entityId: m.id,
          aiSystemId: system.id,
          changes: {
            title: { old: null, new: m.title },
            status: { old: null, new: m.status },
            ...(riskId ? { linkedRisk: { old: null, new: riskId } } : {}),
          },
        });
        return m;
      });
      return reply.status(201).send(measureOut(out, await namesFor(prisma, [out.ownerId])));
    },
  );

  app.patch(
    '/measures/:mid',
    { schema: { tags, summary: 'Modifier une mesure', params: z.object({ mid: id }), body: measureUpdateSchema } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const b = request.body;
      const out = await prisma.$transaction(async (tx) => {
        const m = await tx.measure.findUnique({ where: { id: request.params.mid } });
        if (!m) throw notFound();
        const { system, sections } = await loadVisible(tx, ctx, m.aiSystemId).catch(() => {
          throw notFound();
        });
        manageCtx(ctx, system, sections);
        await requireActiveUser(tx, b.ownerId, 'Responsable');
        const updated = await tx.measure.update({
          where: { id: m.id },
          data: { ...b, dueDate: toDate(b.dueDate), updatedById: ctx.user.id },
          include: measureInclude,
        });
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const k of ['title', 'description', 'type', 'status', 'ownerId', 'dueDate'] as const) {
          const o = m[k] instanceof Date ? dayOf(m[k] as Date) : m[k];
          const n = updated[k] instanceof Date ? dayOf(updated[k] as Date) : updated[k];
          if (o !== n) changes[k] = { old: o ?? null, new: n ?? null };
        }
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'Measure',
          entityId: m.id,
          aiSystemId: system.id,
          changes,
        });
        return updated;
      });
      return measureOut(out, await namesFor(prisma, [out.ownerId]));
    },
  );

  app.post(
    '/risks/:rid/measures',
    {
      schema: {
        tags,
        summary: 'Rattacher une mesure existante du SIA',
        params: z.object({ rid: id }),
        body: z.strictObject({ measureId: id }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { r, system, sections } = await loadRisk(tx, ctx, request.params.rid);
        manageCtx(ctx, system, sections);
        const m = await tx.measure.findUnique({ where: { id: request.body.measureId } });
        if (!m || m.aiSystemId !== r.aiSystemId) throw badRequest('Mesure inconnue pour ce SIA');
        if (r.measures.some((x) => x.measureId === m.id)) throw conflict('Mesure déjà rattachée');
        await tx.riskMeasure.create({ data: { riskId: r.id, measureId: m.id } });
        await recordAudit(tx, actorOf(request), {
          action: 'link_measure',
          entityType: 'Risk',
          entityId: r.id,
          aiSystemId: system.id,
          changes: { measure: { old: null, new: m.title } },
        });
      });
      return riskOut(prisma, ctx, request.params.rid);
    },
  );

  app.delete(
    '/risks/:rid/measures/:mid',
    { schema: { tags, summary: 'Détacher une mesure', params: z.object({ rid: id, mid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { r, system, sections } = await loadRisk(tx, ctx, request.params.rid);
        manageCtx(ctx, system, sections);
        const link = r.measures.find((x) => x.measureId === request.params.mid);
        if (!link) throw notFound('Mesure non rattachée');
        await tx.riskMeasure.delete({ where: { riskId_measureId: { riskId: r.id, measureId: link.measureId } } });
        await recordAudit(tx, actorOf(request), {
          action: 'unlink_measure',
          entityType: 'Risk',
          entityId: r.id,
          aiSystemId: system.id,
          changes: { measure: { old: link.measure.title, new: null } },
        });
      });
      return riskOut(prisma, ctx, request.params.rid);
    },
  );
};
