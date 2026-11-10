import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AUTONOMY_LEVEL_LABELS,
  RISK_TYPES,
  RISK_TYPE_LABELS,
  RISK_CATEGORY_META,
  type RiskType,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, type AccessContext } from '../rbac/access.js';
import { loadVisible, targetOf, type SystemRow } from './ai-systems/service.js';
import { namesFor, nextSeqReference } from './common.js';

const id = z.uuid();

/** Champs de la fiche que l'assistant peut proposer (étape 1), jamais appliqués sans action humaine. */
const EXTRACT_FIELDS = [
  'description',
  'purpose',
  'functioning',
  'useCases',
  'operationalContext',
  'objectives',
] as const;
type ExtractField = (typeof EXTRACT_FIELDS)[number];
const FIELD_LABELS: Record<ExtractField, string> = {
  description: 'Description',
  purpose: 'Finalité',
  functioning: 'Fonctionnement',
  useCases: 'Cas d’usage',
  operationalContext: 'Contexte opérationnel',
  objectives: 'Objectifs',
};

const suggestionItem = z.object({
  value: z.string().max(4000),
  sourceExcerpt: z.string().max(1000),
  uncertainty: z.string().max(500),
});
const extractResult = z.object({
  fields: z.array(suggestionItem.extend({ field: z.enum(EXTRACT_FIELDS) })).max(EXTRACT_FIELDS.length),
});
const extractSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'sourceExcerpt', 'uncertainty'],
        properties: {
          field: { type: 'string', enum: [...EXTRACT_FIELDS] },
          value: { type: 'string' },
          sourceExcerpt: { type: 'string' },
          uncertainty: { type: 'string' },
        },
      },
    },
  },
};

const riskResult = z.object({
  risks: z
    .array(
      z.object({
        category: z.enum(RISK_TYPES),
        title: z.string().min(3).max(200),
        scenario: z.string().max(2000),
        consequence: z.string().max(1000),
        basedOn: z.array(z.string().max(60)).max(10),
        uncertainty: z.string().max(500),
      }),
    )
    .max(10),
});
const riskSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['risks'],
  properties: {
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'title', 'scenario', 'consequence', 'basedOn', 'uncertainty'],
        properties: {
          category: { type: 'string', enum: [...RISK_TYPES] },
          title: { type: 'string' },
          scenario: { type: 'string' },
          consequence: { type: 'string' },
          basedOn: { type: 'array', items: { type: 'string' } },
          uncertainty: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Contexte minimisé transmis au fournisseur : aucune personne (propriétaire, parties prenantes),
 * aucune pièce, aucun identifiant interne ; uniquement les champs descriptifs utiles à la tâche.
 */
function minimizedContext(s: SystemRow) {
  return {
    name: s.name,
    purpose: s.purpose,
    description: s.description,
    functioning: s.functioning,
    useCases: s.useCases,
    operationalContext: s.operationalContext,
    autonomy: AUTONOMY_LEVEL_LABELS[s.autonomyLevel],
    aiActCategory: RISK_CATEGORY_META[s.riskCategory].label,
    personalData: s.processesPersonalData,
    dataCategories: s.dataCategories.map((d) => d.dataCategory.label),
    dataSubjects: s.dataSubjects.map((d) => d.dataSubject.label),
    models: s.models.map((m) => m.aiModel.name),
  };
}

export const assistantRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;
  const llm = app.deps.llm!;
  const tags = ['Assistant IA'];

  app.get(
    '/assistant/status',
    { schema: { tags, summary: 'État de l’assistant (fournisseur, modèle)' } },
    async (request) => {
      requirePermission(request, 'aiSystem:read');
      return { enabled: llm.enabled, provider: llm.name, model: llm.model };
    },
  );

  const requireUse = (
    ctx: AccessContext,
    s: SystemRow,
    sections: string[],
    perm: 'aiSystem:update' | 'risk:manage',
  ) => {
    if (!can(ctx, 'assistant:use', targetOf(s, sections))) throw forbidden('Droit d’utilisation de l’assistant requis');
    if (s.archivedAt) throw conflict('SIA archivé');
    if (!can(ctx, perm, targetOf(s, sections, perm === 'aiSystem:update' ? 'general' : undefined)))
      throw forbidden('Vous ne pouvez pas modifier ce que l’assistant proposerait');
  };

  async function store(
    ctx: AccessContext,
    request: Parameters<typeof actorOf>[0],
    s: SystemRow,
    useCase: string,
    inputChars: number,
    items: {
      field: string;
      proposedValue: Prisma.InputJsonValue;
      sources: Prisma.InputJsonValue;
      uncertainty: string;
    }[],
    meta: { provider: string; model: string; usage: { inputTokens: number; outputTokens: number } },
  ) {
    return prisma.$transaction(async (tx) => {
      // Les propositions précédentes non traitées du même usage sont remplacées.
      await tx.assistantSuggestion.updateMany({
        where: {
          entityType: 'AiSystem',
          entityId: s.id,
          status: 'TO_VERIFY',
          field: useCase === 'risks' ? 'risk' : { in: [...EXTRACT_FIELDS] },
        },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedById: ctx.user.id },
      });
      for (const it of items)
        await tx.assistantSuggestion.create({
          data: {
            entityType: 'AiSystem',
            entityId: s.id,
            ...it,
            provider: meta.provider,
            model: meta.model,
            createdById: ctx.user.id,
          },
        });
      // Journal d'utilisation : jamais le contenu transmis ni reçu, seulement des volumes.
      await recordAudit(
        tx,
        { ...actorOf(request as never), origin: 'ASSISTANT' },
        {
          action: 'assistant_call',
          entityType: 'AiSystem',
          entityId: s.id,
          aiSystemId: s.id,
          changes: {
            useCase: { old: null, new: useCase },
            provider: { old: null, new: `${meta.provider} / ${meta.model}` },
            volume: {
              old: null,
              new: `${inputChars} caractères transmis, ${meta.usage.inputTokens}/${meta.usage.outputTokens} jetons, ${items.length} proposition(s)`,
            },
          },
        },
      );
    });
  }

  app.post(
    '/ai-systems/:sid/assistant/extract',
    {
      schema: {
        tags,
        summary: 'Extraire des propositions de champs depuis un texte fourni (statut « À vérifier »)',
        params: z.object({ sid: id }),
        body: z.strictObject({
          text: z.string().trim().min(50, '50 caractères minimum').max(20_000, '20 000 caractères maximum'),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request) => {
      const ctx = requirePermission(request, 'assistant:use');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      requireUse(ctx, system, sections, 'aiSystem:update');
      const r = await llm.generate({
        instructions: [
          'Tu aides une équipe conformité à documenter un système d’intelligence artificielle.',
          'À partir du texte fourni (documentation, présentation fournisseur…), propose des valeurs pour les champs de la fiche,',
          'en français, uniquement si le texte les étaye. Pour chaque proposition, cite l’extrait source exact et indique ton incertitude.',
          'N’invente rien : omets un champ non étayé. Ne recopie aucune donnée personnelle (noms, adresses, identifiants).',
          `Champs possibles : ${EXTRACT_FIELDS.map((f) => `${f} (${FIELD_LABELS[f]})`).join(', ')}.`,
        ].join(' '),
        input: `Système : ${system.name}\n\nTexte fourni :\n"""\n${request.body.text}\n"""`,
        jsonSchema: extractSchema,
        parse: extractResult,
      });
      await store(
        ctx,
        request,
        system,
        'extract',
        request.body.text.length,
        r.data.fields.map((f) => ({
          field: f.field,
          proposedValue: f.value,
          sources: [{ excerpt: f.sourceExcerpt }],
          uncertainty: f.uncertainty,
        })),
        r,
      );
      return listSuggestions(system.id);
    },
  );

  app.post(
    '/ai-systems/:sid/assistant/risks',
    {
      schema: {
        tags,
        summary: 'Proposer des risques à partir des données de la fiche (statut « À vérifier »)',
        params: z.object({ sid: id }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request) => {
      const ctx = requirePermission(request, 'assistant:use');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      requireUse(ctx, system, sections, 'risk:manage');
      const existing = await prisma.risk.findMany({
        where: { aiSystemId: system.id },
        select: { title: true, category: true },
      });
      const context = minimizedContext(system);
      const input = JSON.stringify(
        { system: context, existingRisks: existing.map((r) => `${r.category}: ${r.title}`) },
        null,
        1,
      );
      if (!context.purpose.trim() && !context.description.trim())
        throw badRequest('Renseignez au moins la finalité ou la description du SIA avant de demander des propositions');
      const r = await llm.generate({
        instructions: [
          'Tu aides une équipe conformité à identifier les risques d’un système d’intelligence artificielle (droits fondamentaux, vie privée, biais, sécurité, exactitude, etc.).',
          `Propose au plus 6 risques nouveaux (absents de existingRisks), chacun avec une catégorie parmi : ${RISK_TYPES.map((c) => `${c} (${RISK_TYPE_LABELS[c]})`).join(', ')}.`,
          'Rédige en français. Indique dans basedOn les champs du contexte sur lesquels tu t’appuies et précise ton incertitude.',
          'Ne cote pas les risques : la cotation relève de l’équipe. N’invente pas de faits absents du contexte.',
        ].join(' '),
        input,
        jsonSchema: riskSchema,
        parse: riskResult,
      });
      await store(
        ctx,
        request,
        system,
        'risks',
        input.length,
        r.data.risks.map((x) => ({
          field: 'risk',
          proposedValue: { category: x.category, title: x.title, scenario: x.scenario, consequence: x.consequence },
          sources: x.basedOn.map((b) => ({ field: b })),
          uncertainty: x.uncertainty,
        })),
        r,
      );
      return listSuggestions(system.id);
    },
  );

  async function listSuggestions(systemId: string) {
    const rows = await prisma.assistantSuggestion.findMany({
      where: { entityType: 'AiSystem', entityId: systemId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const names = await namesFor(
      prisma,
      rows.flatMap((r) => [r.createdById, r.decidedById]),
    );
    return {
      enabled: llm.enabled,
      items: rows.map((r) => ({
        id: r.id,
        field: r.field,
        fieldLabel: FIELD_LABELS[r.field as ExtractField] ?? (r.field === 'risk' ? 'Risque' : r.field),
        proposedValue: r.proposedValue,
        sources: r.sources,
        uncertainty: r.uncertainty,
        status: r.status,
        provider: r.provider,
        model: r.model,
        createdAt: r.createdAt.toISOString(),
        createdBy: names.get(r.createdById) ?? null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      })),
    };
  }

  app.get(
    '/ai-systems/:sid/assistant/suggestions',
    { schema: { tags, summary: 'Propositions de l’assistant pour le SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system } = await loadVisible(prisma, ctx, request.params.sid);
      return listSuggestions(system.id);
    },
  );

  app.post(
    '/assistant/suggestions/:id/decide',
    {
      schema: {
        tags,
        summary:
          'Décision humaine : rejeter, ou accepter (un risque proposé est créé non coté ; une valeur de champ est appliquée par l’utilisateur via la fiche)',
        params: z.object({ id }),
        body: z.strictObject({ decision: z.enum(['ACCEPTED', 'REJECTED']) }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'assistant:use');
      const out = await prisma.$transaction(async (tx) => {
        const sug = await tx.assistantSuggestion.findUnique({ where: { id: request.params.id } });
        if (!sug || sug.entityType !== 'AiSystem' || !sug.entityId) throw notFound();
        const { system, sections } = await loadVisible(tx, ctx, sug.entityId).catch(() => {
          throw notFound();
        });
        if (sug.status !== 'TO_VERIFY') throw conflict('Proposition déjà traitée');
        const isRisk = sug.field === 'risk';
        requireUse(ctx, system, sections, isRisk ? 'risk:manage' : 'aiSystem:update');
        let riskId: string | null = null;
        if (request.body.decision === 'ACCEPTED' && isRisk) {
          const v = sug.proposedValue as { category: RiskType; title: string; scenario: string; consequence: string };
          const m = await tx.riskMethodology.findFirst({ where: { isActive: true } });
          if (!m) throw conflict('Aucune méthodologie active');
          const r = await tx.risk.create({
            data: {
              reference: await nextSeqReference(tx, 'risk', 'RSK'),
              aiSystemId: system.id,
              methodologyId: m.id,
              category: v.category,
              title: v.title.slice(0, 200),
              scenario: v.scenario,
              consequence: v.consequence,
              createdById: ctx.user.id,
              updatedById: ctx.user.id,
            },
          });
          riskId = r.id;
          await recordAudit(
            tx,
            { ...actorOf(request), origin: 'ASSISTANT' },
            {
              action: 'create',
              entityType: 'Risk',
              entityId: r.id,
              aiSystemId: system.id,
              justification: `Proposition de l’assistant (${sug.provider} / ${sug.model}) acceptée par ${ctx.user.displayName}`,
              changes: { reference: { old: null, new: r.reference }, title: { old: null, new: r.title } },
            },
          );
        }
        await tx.assistantSuggestion.update({
          where: { id: sug.id },
          data: { status: request.body.decision, decidedAt: new Date(), decidedById: ctx.user.id },
        });
        await recordAudit(tx, actorOf(request), {
          action: request.body.decision === 'ACCEPTED' ? 'accept_suggestion' : 'reject_suggestion',
          entityType: 'AssistantSuggestion',
          entityId: sug.id,
          aiSystemId: system.id,
          changes: { field: { old: null, new: sug.field } },
        });
        return { riskId };
      });
      return out;
    },
  );
};
