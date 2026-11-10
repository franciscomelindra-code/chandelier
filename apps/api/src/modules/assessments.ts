import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  OVERRIDABLE,
  applyOverrides,
  evaluate,
  frameworkSchema,
  isVisible,
  type Answers,
  type EvaluationResult,
  type Framework,
} from '@chandelier/shared';
import type { AiActAssessment, AssessmentOverride, Prisma, PrismaClient } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, type AccessContext } from '../rbac/access.js';
import { loadVisible, scopeWhere, snapshot, systemInclude, targetOf, type SystemRow } from './ai-systems/service.js';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;
const id = z.uuid();
const today = () => new Date().toISOString().slice(0, 10);

async function frameworkOf(db: Db, frameworkId: string): Promise<Framework> {
  const f = await db.regulatoryFramework.findUniqueOrThrow({ where: { id: frameworkId } });
  return frameworkSchema.parse(f.content);
}

/** Propositions issues de la fiche (à confirmer par l'utilisateur, jamais appliquées automatiquement). */
function prefillSuggestions(fw: Framework, s: SystemRow): Record<string, { value: string; source: string }> {
  const out: Record<string, { value: string; source: string }> = {};
  for (const q of fw.questions) {
    if (q.prefill === 'personalData' && s.processesPersonalData !== 'UNKNOWN') {
      out[q.id] = { value: s.processesPersonalData, source: 'Étape 8 — traitement de données personnelles' };
    }
    if (q.prefill === 'declaredDeployer' && s.aiActRoles.includes('DEPLOYER')) {
      out[q.id] = { value: 'YES', source: 'Étape 2 — rôle « Déployeur » déclaré' };
    }
    if (q.prefill === 'declaredProvider' && s.aiActRoles.includes('PROVIDER')) {
      out[q.id] = { value: 'YES', source: 'Étape 2 — rôle « Fournisseur » déclaré' };
    }
    if (q.prefill === 'usesGpai' && s.models.length) {
      const flags = s.models.map((m) => m.aiModel.isGpai);
      if (flags.includes('YES')) out[q.id] = { value: 'YES', source: 'Étape 3 — modèle lié marqué GPAI' };
      else if (flags.every((f) => f === 'NO'))
        out[q.id] = { value: 'NO', source: 'Étape 3 — aucun modèle lié marqué GPAI' };
    }
  }
  return out;
}

/** Vérifie que les réponses correspondent aux questions et aux valeurs admises du référentiel. */
function validateAnswers(fw: Framework, answers: Answers) {
  for (const [k, v] of Object.entries(answers)) {
    const q = fw.questions.find((x) => x.id === k);
    if (!q) throw badRequest(`Question inconnue : ${k}`);
    if (v === undefined || v === null) continue;
    if (q.type === 'tri' && !['YES', 'NO', 'UNKNOWN'].includes(v as string))
      throw badRequest(`Réponse invalide pour ${k}`);
    if (q.type === 'multi') {
      if (!Array.isArray(v)) throw badRequest(`Réponse multiple attendue pour ${k}`);
      const allowed = new Set(q.options!.map((o) => o.value));
      if (v.some((x) => !allowed.has(x))) throw badRequest(`Option invalide pour ${k}`);
      if (v.includes('NONE') && v.length > 1) throw badRequest(`« Aucun » est exclusif pour ${k}`);
    }
  }
}

function overridesInput(list: (AssessmentOverride & { author?: { displayName: string } | null })[]) {
  return list.map((o) => ({
    dimension: o.dimension,
    newValue: o.newValue as string,
    justification: o.justification,
    authorId: o.authorId,
    createdAt: o.createdAt.toISOString(),
  }));
}

/** Statut de conformité global du SIA, dérivé de ses obligations applicables. */
export async function refreshCompliance(tx: Tx, aiSystemId: string) {
  const obls = await tx.obligation.findMany({ where: { aiSystemId }, select: { applicability: true, status: true } });
  const relevant = obls.filter((o) => o.applicability !== 'NO' && o.status !== 'NOT_APPLICABLE');
  let status: 'NOT_ASSESSED' | 'NON_COMPLIANT' | 'PARTIAL' | 'COMPLIANT' = 'NOT_ASSESSED';
  if (obls.length) {
    if (relevant.some((o) => o.status === 'NON_COMPLIANT')) status = 'NON_COMPLIANT';
    else if (relevant.every((o) => o.status === 'COMPLIANT')) status = 'COMPLIANT';
    else status = 'PARTIAL';
  }
  await tx.aiSystem.update({ where: { id: aiSystemId }, data: { complianceStatus: status } });
}

/**
 * Génération idempotente des obligations : création des nouvelles, mise à jour des références
 * (sans toucher statut, responsable, preuves), passage « à confirmer » de celles qui ne sont plus déclenchées.
 */
async function syncObligations(tx: Tx, s: SystemRow, assessmentId: string, result: EvaluationResult, actorId: string) {
  const existing = await tx.obligation.findMany({ where: { aiSystemId: s.id } });
  const keys = new Set(result.obligations.map((o) => o.key));
  let created = 0;
  for (const o of result.obligations) {
    const prev = existing.find((e) => e.templateKey === o.key);
    const common = {
      assessmentId,
      frameworkVersion: result.frameworkVersion,
      sourceRuleIds: o.sourceRuleIds,
      legalBasis: o.legalBasis,
      title: o.title,
      description: o.description,
      category: o.category as never,
      updatedById: actorId,
    };
    if (!prev) {
      await tx.obligation.create({
        data: {
          ...common,
          aiSystemId: s.id,
          templateKey: o.key,
          applicability: o.applicability,
          targetDate: new Date(`${o.effectiveFrom}T00:00:00Z`),
          createdById: actorId,
        },
      });
      created++;
    } else {
      await tx.obligation.update({
        where: { id: prev.id },
        // L'applicabilité saisie par un utilisateur est conservée, sauf passage de « à confirmer » à « oui ».
        data: {
          ...common,
          ...(prev.applicability === 'TO_CONFIRM' && o.applicability === 'YES' ? { applicability: 'YES' } : {}),
        },
      });
    }
  }
  let orphaned = 0;
  for (const e of existing.filter((x) => !keys.has(x.templateKey) && x.applicability !== 'TO_CONFIRM')) {
    await tx.obligation.update({
      where: { id: e.id },
      data: {
        applicability: 'TO_CONFIRM',
        comment: `${e.comment ? `${e.comment}\n` : ''}[Système ${today()}] Obligation non déclenchée par la dernière évaluation : applicabilité à confirmer.`,
        updatedById: actorId,
      },
    });
    orphaned++;
  }
  return { created, orphaned };
}

function serializeAssessment(
  a: AiActAssessment & {
    framework: { id: string; key: string; version: string; label: string };
    overrides: AssessmentOverride[];
  },
  names: Map<string, string>,
  extra: Record<string, unknown> = {},
) {
  const computed = a.computedResult as unknown as EvaluationResult | null;
  return {
    id: a.id,
    aiSystemId: a.aiSystemId,
    status: a.status,
    framework: a.framework,
    answers: a.answers,
    computedResult: computed,
    effectiveResult: computed ? applyOverrides(computed, overridesInput(a.overrides)) : null,
    computedCategory: a.computedCategory,
    effectiveCategory: a.effectiveCategory,
    computedAt: a.computedAt?.toISOString() ?? null,
    computedBy: a.computedById ? (names.get(a.computedById) ?? a.computedById) : null,
    validatedAt: a.validatedAt?.toISOString() ?? null,
    validatedBy: a.validatedById ? (names.get(a.validatedById) ?? a.validatedById) : null,
    createdAt: a.createdAt.toISOString(),
    createdBy: a.createdById ? (names.get(a.createdById) ?? a.createdById) : null,
    overrides: a.overrides
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .map((o) => ({
        id: o.id,
        dimension: o.dimension,
        previousValue: o.previousValue,
        newValue: o.newValue,
        justification: o.justification,
        author: names.get(o.authorId) ?? o.authorId,
        createdAt: o.createdAt.toISOString(),
      })),
    ...extra,
  };
}

async function namesFor(db: Db, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const users = await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

const assessmentInclude = {
  framework: { select: { id: true, key: true, version: true, label: true } },
  overrides: true,
} as const;

export const assessmentRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;
  const tags = ['Qualification AI Act'];

  async function load(db: Db, ctx: AccessContext, systemId: string, assessmentId: string) {
    const { system, sections } = await loadVisible(db, ctx, systemId);
    const a = await db.aiActAssessment.findUnique({ where: { id: assessmentId }, include: assessmentInclude });
    if (!a || a.aiSystemId !== system.id) throw notFound('Évaluation introuvable');
    return { system, sections, a };
  }
  const requireRun = (ctx: AccessContext, s: SystemRow, sections: string[]) => {
    if (!can(ctx, 'assessment:run', targetOf(s, sections))) throw forbidden('Droit de qualification requis sur ce SIA');
    if (s.archivedAt) throw conflict('SIA archivé');
  };
  async function detail(db: Db, a: Parameters<typeof serializeAssessment>[0], s: SystemRow) {
    const names = await namesFor(db, [
      a.computedById,
      a.validatedById,
      a.createdById,
      ...a.overrides.map((o) => o.authorId),
    ]);
    const fw = await frameworkOf(db, a.framework.id);
    return serializeAssessment(a, names, {
      // Aperçu pour un brouillon : calculé à la volée, non enregistré.
      preview: a.status === 'DRAFT' ? evaluate(fw, a.answers as Answers, { date: today() }) : null,
      suggestions: a.status === 'DRAFT' ? prefillSuggestions(fw, s) : {},
      isCurrent: s.currentAssessmentId === a.id,
    });
  }

  // ── Référentiels réglementaires ──
  app.get(
    '/regulatory-frameworks',
    { schema: { tags, summary: 'Versions du référentiel réglementaire' } },
    async (request) => {
      requirePermission(request, 'aiSystem:read');
      const items = await prisma.regulatoryFramework.findMany({
        orderBy: [{ key: 'asc' }, { importedAt: 'desc' }],
        select: {
          id: true,
          key: true,
          version: true,
          label: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          checksum: true,
          importedAt: true,
        },
      });
      return { items };
    },
  );
  app.get(
    '/regulatory-frameworks/:fid',
    {
      schema: {
        tags,
        summary: 'Contenu d’une version (questions, règles, obligations)',
        params: z.object({ fid: id }),
      },
    },
    async (request) => {
      requirePermission(request, 'aiSystem:read');
      const f = await prisma.regulatoryFramework.findUnique({ where: { id: request.params.fid } });
      if (!f) throw notFound();
      return { id: f.id, status: f.status, checksum: f.checksum, importedAt: f.importedAt, content: f.content };
    },
  );

  // ── Portefeuille des évaluations ──
  app.get(
    '/assessments',
    {
      schema: {
        tags,
        summary: 'Qualification courante de chaque SIA du périmètre',
        querystring: z.object({ status: z.enum(['NONE', 'DRAFT', 'COMPLETED', 'VALIDATED']).optional() }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const systems = await prisma.aiSystem.findMany({
        where: { AND: [scopeWhere(ctx), { archivedAt: null }] },
        select: {
          id: true,
          reference: true,
          name: true,
          status: true,
          riskCategory: true,
          complianceStatus: true,
          currentAssessmentId: true,
          isDemo: true,
          assessments: {
            where: { status: { in: ['DRAFT', 'COMPLETED', 'VALIDATED'] } },
            orderBy: { createdAt: 'desc' },
            take: 2,
          },
          _count: { select: { obligations: true } },
        },
        orderBy: { reference: 'asc' },
      });
      const items = systems.map((s) => {
        const current = s.assessments.find((a) => a.id === s.currentAssessmentId) ?? null;
        const draft = s.assessments.find((a) => a.status === 'DRAFT') ?? null;
        const state = draft ? 'DRAFT' : (current?.status ?? 'NONE');
        return {
          system: { id: s.id, reference: s.reference, name: s.name, status: s.status, isDemo: s.isDemo },
          riskCategory: s.riskCategory,
          complianceStatus: s.complianceStatus,
          state,
          currentAssessment: current
            ? {
                id: current.id,
                status: current.status,
                computedAt: current.computedAt?.toISOString() ?? null,
                effectiveCategory: current.effectiveCategory,
              }
            : null,
          draftId: draft?.id ?? null,
          obligationCount: s._count.obligations,
        };
      });
      return { items: request.query.status ? items.filter((i) => i.state === request.query.status) : items };
    },
  );

  // ── Évaluations d'un SIA ──
  app.get(
    '/ai-systems/:sid/assessments',
    { schema: { tags, summary: 'Évaluations du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system } = await loadVisible(prisma, ctx, request.params.sid);
      const list = await prisma.aiActAssessment.findMany({
        where: { aiSystemId: system.id },
        include: assessmentInclude,
        orderBy: { createdAt: 'desc' },
      });
      const names = await namesFor(
        prisma,
        list.flatMap((a) => [a.computedById, a.validatedById, a.createdById]),
      );
      return {
        items: list.map((a) => ({
          id: a.id,
          status: a.status,
          framework: a.framework,
          effectiveCategory: a.effectiveCategory,
          computedCategory: a.computedCategory,
          computedAt: a.computedAt?.toISOString() ?? null,
          computedBy: a.computedById ? names.get(a.computedById) : null,
          validatedAt: a.validatedAt?.toISOString() ?? null,
          validatedBy: a.validatedById ? names.get(a.validatedById) : null,
          overrideCount: a.overrides.length,
          isCurrent: system.currentAssessmentId === a.id,
          createdAt: a.createdAt.toISOString(),
        })),
        canRun: can(ctx, 'assessment:run', targetOf(system, [])),
      };
    },
  );

  app.get(
    '/ai-systems/:sid/assessments/:aid',
    {
      schema: {
        tags,
        summary: 'Détail d’une évaluation (réponses, résultat calculé et effectif, surcharges)',
        params: z.object({ sid: id, aid: id }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, a } = await load(prisma, ctx, request.params.sid, request.params.aid);
      return detail(prisma, a, system);
    },
  );

  app.post(
    '/ai-systems/:sid/assessments',
    {
      schema: {
        tags,
        summary: 'Démarrer une qualification (brouillon, référentiel actif)',
        params: z.object({ sid: id }),
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const created = await prisma.$transaction(async (tx) => {
        const { system, sections } = await loadVisible(tx, ctx, request.params.sid);
        requireRun(ctx, system, sections);
        const draft = await tx.aiActAssessment.findFirst({ where: { aiSystemId: system.id, status: 'DRAFT' } });
        if (draft) throw conflict('Une qualification en brouillon existe déjà pour ce SIA', { assessmentId: draft.id });
        const fw = await tx.regulatoryFramework.findFirst({
          where: { key: 'EU_AI_ACT', status: 'ACTIVE' },
          orderBy: { importedAt: 'desc' },
        });
        if (!fw) throw new AppError(503, 'NO_FRAMEWORK', 'Aucun référentiel AI Act actif');
        // Reprise des réponses de la qualification courante, le cas échéant (réévaluation).
        const previous = system.currentAssessmentId
          ? await tx.aiActAssessment.findUnique({ where: { id: system.currentAssessmentId } })
          : null;
        const a = await tx.aiActAssessment.create({
          data: {
            aiSystemId: system.id,
            frameworkId: fw.id,
            answers: (previous?.answers ?? {}) as Prisma.InputJsonValue,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
          include: assessmentInclude,
        });
        await recordAudit(tx, actorOf(request), {
          action: 'start_assessment',
          entityType: 'AiActAssessment',
          entityId: a.id,
          aiSystemId: system.id,
          changes: {
            framework: { old: null, new: `${fw.key} ${fw.version}` },
            reusedFrom: { old: null, new: previous?.id ?? null },
          },
        });
        return { a, system };
      });
      return reply.status(201).send(await detail(prisma, created.a, created.system));
    },
  );

  app.patch(
    '/ai-systems/:sid/assessments/:aid',
    {
      schema: {
        tags,
        summary: 'Enregistrer des réponses (brouillon uniquement)',
        params: z.object({ sid: id, aid: id }),
        body: z.strictObject({
          answers: z.record(
            z.string(),
            z.union([z.enum(['YES', 'NO', 'UNKNOWN']), z.array(z.string()).max(20), z.null()]),
          ),
        }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const out = await prisma.$transaction(async (tx) => {
        const { system, sections, a } = await load(tx, ctx, request.params.sid, request.params.aid);
        requireRun(ctx, system, sections);
        if (a.status !== 'DRAFT')
          throw conflict('Seul un brouillon est modifiable : démarrez une nouvelle qualification');
        const fw = await frameworkOf(tx, a.frameworkId);
        const incoming = request.body.answers as Answers;
        validateAnswers(fw, incoming);
        const merged: Answers = { ...(a.answers as Answers) };
        for (const [k, v] of Object.entries(incoming)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        const updated = await tx.aiActAssessment.update({
          where: { id: a.id },
          data: { answers: merged as Prisma.InputJsonValue, updatedById: ctx.user.id },
          include: assessmentInclude,
        });
        return { updated, system };
      });
      return detail(prisma, out.updated, out.system);
    },
  );

  app.post(
    '/ai-systems/:sid/assessments/:aid/complete',
    {
      schema: {
        tags,
        summary: 'Calculer et enregistrer le résultat ; génère les obligations',
        params: z.object({ sid: id, aid: id }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const out = await prisma.$transaction(
        async (tx) => {
          const { system, sections, a } = await load(tx, ctx, request.params.sid, request.params.aid);
          requireRun(ctx, system, sections);
          if (a.status !== 'DRAFT') throw conflict('Évaluation déjà terminée');
          const fw = await frameworkOf(tx, a.frameworkId);
          const answers = a.answers as Answers;
          // Les réponses aux questions masquées sont écartées du calcul (et signalées comme telles).
          const result = evaluate(fw, answers, { date: today() });
          await tx.aiActAssessment.updateMany({
            where: { aiSystemId: system.id, status: { in: ['COMPLETED', 'VALIDATED'] } },
            data: { status: 'SUPERSEDED' },
          });
          const updated = await tx.aiActAssessment.update({
            where: { id: a.id },
            data: {
              status: 'COMPLETED',
              computedResult: result as unknown as Prisma.InputJsonValue,
              computedCategory: result.displayCategory,
              effectiveCategory: result.displayCategory,
              computedAt: new Date(),
              computedById: ctx.user.id,
              updatedById: ctx.user.id,
            },
            include: assessmentInclude,
          });
          const hidden = Object.keys(answers).filter((k) => {
            const q = fw.questions.find((x) => x.id === k);
            return q && !isVisible(q, answers, fw.definitions);
          });
          await tx.aiSystem.update({
            where: { id: system.id },
            data: {
              riskCategory: result.displayCategory,
              riskJustification: result.displayJustification,
              currentAssessmentId: a.id,
              version: { increment: 1 },
              updatedById: ctx.user.id,
            },
          });
          const sync = await syncObligations(tx, system, a.id, result, ctx.user.id);
          await refreshCompliance(tx, system.id);
          const after = await tx.aiSystem.findUniqueOrThrow({ where: { id: system.id }, include: systemInclude });
          await snapshot(tx, after, ctx.user.id, `qualification AI Act ${fw.version}`);
          await recordAudit(tx, actorOf(request), {
            action: 'complete_assessment',
            entityType: 'AiActAssessment',
            entityId: a.id,
            aiSystemId: system.id,
            changes: {
              riskCategory: { old: system.riskCategory, new: result.displayCategory },
              framework: { old: null, new: `${fw.key} ${fw.version}` },
              rules: { old: null, new: result.triggeredRules.map((t) => t.ruleId) },
              obligations: { old: null, new: `${sync.created} créée(s), ${sync.orphaned} à confirmer` },
              ...(hidden.length ? { ignoredAnswers: { old: null, new: hidden } } : {}),
            },
          });
          return { updated, after };
        },
        { timeout: 30_000 },
      );
      return detail(prisma, out.updated, out.after);
    },
  );

  app.post(
    '/ai-systems/:sid/assessments/:aid/overrides',
    {
      schema: {
        tags,
        summary: 'Surcharger une conclusion (juriste) — justification obligatoire, historisée, immuable',
        params: z.object({ sid: id, aid: id }),
        body: z.strictObject({
          dimension: z.enum(Object.keys(OVERRIDABLE) as [string, ...string[]]),
          value: z.string(),
          justification: z.string().trim().min(20, 'Justification de 20 caractères minimum').max(4000),
        }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'assessment:override');
      const { dimension, value, justification } = request.body;
      if (!OVERRIDABLE[dimension]!.includes(value)) throw badRequest(`Valeur non admise pour ${dimension}`);
      const out = await prisma.$transaction(async (tx) => {
        const { system, sections, a } = await load(tx, ctx, request.params.sid, request.params.aid);
        if (!can(ctx, 'assessment:override', targetOf(system, sections))) throw forbidden();
        if (a.status !== 'COMPLETED' && a.status !== 'VALIDATED')
          throw conflict('Seule une évaluation terminée et courante peut être surchargée');
        const computed = a.computedResult as unknown as EvaluationResult;
        const before = applyOverrides(computed, overridesInput(a.overrides));
        const previousValue =
          dimension === 'displayCategory'
            ? before.displayCategory
            : before.dimensions[dimension as keyof EvaluationResult['dimensions']].value;
        if (previousValue === value) throw badRequest('La valeur est identique au résultat actuel');
        await tx.assessmentOverride.create({
          data: { assessmentId: a.id, dimension, previousValue, newValue: value, justification, authorId: ctx.user.id },
        });
        const fresh = await tx.aiActAssessment.findUniqueOrThrow({ where: { id: a.id }, include: assessmentInclude });
        const effective = applyOverrides(computed, overridesInput(fresh.overrides));
        // Une surcharge invalide la validation éventuelle : nouvelle validation nécessaire.
        const updated = await tx.aiActAssessment.update({
          where: { id: a.id },
          data: {
            effectiveCategory: effective.displayCategory,
            ...(a.status === 'VALIDATED' ? { status: 'COMPLETED', validatedAt: null, validatedById: null } : {}),
            updatedById: ctx.user.id,
          },
          include: assessmentInclude,
        });
        await tx.aiSystem.update({
          where: { id: system.id },
          data: {
            riskCategory: effective.displayCategory,
            riskJustification: effective.displayJustification,
            version: { increment: 1 },
            updatedById: ctx.user.id,
          },
        });
        const after = await tx.aiSystem.findUniqueOrThrow({ where: { id: system.id }, include: systemInclude });
        await snapshot(tx, after, ctx.user.id, `surcharge juridique : ${dimension}`);
        await recordAudit(tx, actorOf(request), {
          action: 'override',
          entityType: 'AiActAssessment',
          entityId: a.id,
          aiSystemId: system.id,
          justification,
          changes: {
            [dimension]: { old: previousValue, new: value },
            ...(a.status === 'VALIDATED' ? { status: { old: 'VALIDATED', new: 'COMPLETED' } } : {}),
          },
        });
        return { updated, after };
      });
      return detail(prisma, out.updated, out.after);
    },
  );

  app.post(
    '/ai-systems/:sid/assessments/:aid/validate',
    {
      schema: {
        tags,
        summary: 'Valider la qualification (principe des quatre yeux : validateur ≠ auteur du calcul)',
        params: z.object({ sid: id, aid: id }),
        body: z.strictObject({ comment: z.string().trim().max(2000).default('') }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'assessment:validate');
      const out = await prisma.$transaction(async (tx) => {
        const { system, sections, a } = await load(tx, ctx, request.params.sid, request.params.aid);
        if (!can(ctx, 'assessment:validate', targetOf(system, sections))) throw forbidden();
        if (a.status !== 'COMPLETED') throw conflict('Seule une évaluation terminée peut être validée');
        if (a.computedById === ctx.user.id) {
          throw forbidden(
            'Principe des quatre yeux : la validation doit être faite par une autre personne que l’auteur du calcul',
          );
        }
        const updated = await tx.aiActAssessment.update({
          where: { id: a.id },
          data: { status: 'VALIDATED', validatedAt: new Date(), validatedById: ctx.user.id, updatedById: ctx.user.id },
          include: assessmentInclude,
        });
        await recordAudit(tx, actorOf(request), {
          action: 'validate_assessment',
          entityType: 'AiActAssessment',
          entityId: a.id,
          aiSystemId: system.id,
          justification: request.body.comment || null,
          changes: { status: { old: 'COMPLETED', new: 'VALIDATED' } },
        });
        return { updated, system };
      });
      return detail(prisma, out.updated, out.system);
    },
  );

  // ── Obligations ──
  const obligationOut = (
    o: Prisma.ObligationGetPayload<object> & {
      evidences?: { document: { id: string; title: string; type: string; archivedAt: Date | null } }[];
    },
    names: Map<string, string>,
  ) => ({
    ...o,
    evidences: (o.evidences ?? []).map((e) => ({
      ...e.document,
      archivedAt: e.document.archivedAt?.toISOString() ?? null,
    })),
    targetDate: o.targetDate ? o.targetDate.toISOString().slice(0, 10) : null,
    validatedAt: o.validatedAt?.toISOString() ?? null,
    validatedBy: o.validatedById ? (names.get(o.validatedById) ?? null) : null,
    responsible: o.responsibleId ? (names.get(o.responsibleId) ?? null) : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  });

  app.get(
    '/ai-systems/:sid/obligations',
    { schema: { tags, summary: 'Obligations applicables au SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      const items = await prisma.obligation.findMany({
        where: { aiSystemId: system.id },
        include: {
          evidences: { include: { document: { select: { id: true, title: true, type: true, archivedAt: true } } } },
        },
        orderBy: [{ category: 'asc' }, { templateKey: 'asc' }],
      });
      const names = await namesFor(
        prisma,
        items.flatMap((o) => [o.responsibleId, o.validatedById]),
      );
      return {
        items: items.map((o) => obligationOut(o, names)),
        canUpdate: !system.archivedAt && can(ctx, 'obligation:update', targetOf(system, sections)),
        complianceStatus: system.complianceStatus,
      };
    },
  );

  app.patch(
    '/obligations/:oid',
    {
      schema: {
        tags,
        summary: 'Mettre à jour une obligation (applicabilité, statut, responsable, échéance, commentaire)',
        params: z.object({ oid: id }),
        body: z.strictObject({
          applicability: z.enum(['YES', 'NO', 'TO_CONFIRM']).optional(),
          status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE']).optional(),
          responsibleId: id.nullable().optional(),
          targetDate: z.iso.date().nullable().optional(),
          comment: z.string().trim().max(4000).optional(),
        }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const out = await prisma.$transaction(async (tx) => {
        const o = await tx.obligation.findUnique({ where: { id: request.params.oid } });
        if (!o) throw notFound();
        const { system, sections } = await loadVisible(tx, ctx, o.aiSystemId);
        if (system.archivedAt) throw conflict('SIA archivé');
        if (!can(ctx, 'obligation:update', targetOf(system, sections))) throw forbidden();
        const b = request.body;
        if ((b.applicability === 'NO' || b.status === 'NOT_APPLICABLE') && !(b.comment ?? o.comment).trim()) {
          throw badRequest('Justifiez en commentaire une obligation déclarée non applicable');
        }
        if (b.responsibleId && !(await tx.user.findFirst({ where: { id: b.responsibleId, isActive: true } }))) {
          throw badRequest('Responsable inconnu ou désactivé');
        }
        const becomesCompliant = b.status === 'COMPLIANT' && o.status !== 'COMPLIANT';
        const updated = await tx.obligation.update({
          where: { id: o.id },
          data: {
            ...b,
            targetDate:
              b.targetDate === undefined ? undefined : b.targetDate ? new Date(`${b.targetDate}T00:00:00Z`) : null,
            ...(becomesCompliant ? { validatedAt: new Date(), validatedById: ctx.user.id } : {}),
            ...(b.status && b.status !== 'COMPLIANT' ? { validatedAt: null, validatedById: null } : {}),
            updatedById: ctx.user.id,
          },
        });
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const k of Object.keys(b) as (keyof typeof b)[]) {
          const before = o[k] instanceof Date ? (o[k] as Date).toISOString().slice(0, 10) : o[k];
          if (b[k] !== undefined && b[k] !== before)
            changes[`${o.templateKey}.${k}`] = { old: before ?? null, new: b[k] };
        }
        await refreshCompliance(tx, system.id);
        await recordAudit(tx, actorOf(request), {
          action: 'update_obligation',
          entityType: 'Obligation',
          entityId: o.id,
          aiSystemId: system.id,
          changes,
        });
        return updated;
      });
      const names = await namesFor(prisma, [out.responsibleId, out.validatedById]);
      return obligationOut(out, names);
    },
  );
};
