import { Readable } from 'node:stream';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AUTONOMY_LEVEL_LABELS,
  FRIA_MIN_SECTION_LENGTH,
  FRIA_SECTIONS,
  RISK_TYPE_LABELS,
  applyOverrides,
  dpiaSchema,
  dpiaUpdateSchema,
  friaMissingSections,
  friaUpdateSchema,
  generateNotice,
  markdownToHtml,
  noticeSettingsSchema,
  noticeUpdateSchema,
  suggestedBlocks,
  type EvaluationResult,
  type NoticeBlock,
  type RiskType,
} from '@chandelier/shared';
import type { AiActAssessment, AssessmentOverride, Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, hasPermission, type AccessContext } from '../rbac/access.js';
import { localStorage } from '../storage.js';
import { loadVisible, scopeWhere, targetOf, type SystemRow } from './ai-systems/service.js';
import { dayOf, namesFor, nextSeqReference, type Db, type Tx } from './common.js';
import { notify } from './notify.js';

const id = z.uuid();
const NOTICE_SETTINGS = 'notice.defaults';

/** Qualification effective courante (surcharges comprises) et réponses ; null si aucune. */
export async function currentQualification(db: Db, s: { currentAssessmentId: string | null }) {
  if (!s.currentAssessmentId) return null;
  const a = (await db.aiActAssessment.findUnique({
    where: { id: s.currentAssessmentId },
    include: { overrides: true },
  })) as (AiActAssessment & { overrides: AssessmentOverride[] }) | null;
  if (!a?.computedResult) return null;
  const effective = applyOverrides(
    a.computedResult as unknown as EvaluationResult,
    a.overrides.map((o) => ({
      dimension: o.dimension,
      newValue: o.newValue as string,
      justification: o.justification,
      authorId: o.authorId,
      createdAt: o.createdAt.toISOString(),
    })),
  );
  return { answers: a.answers as Record<string, unknown>, effective };
}

async function noticeSettings(db: Db) {
  const s = await db.appSetting.findUnique({ where: { key: NOTICE_SETTINGS } });
  const parsed = noticeSettingsSchema.safeParse(s?.value);
  return parsed.success ? parsed.data : { organization: 'GLS France', contact: '' };
}

const PLACEHOLDER = /\[À compléter/;

export const complianceRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma, config } = app.deps;
  const storage = localStorage(config.STORAGE_DIR);
  const tags = ['FRIA, DPIA, notices'];

  async function sys(db: Db, ctx: AccessContext, systemId: string) {
    const { system, sections } = await loadVisible(db, ctx, systemId);
    return { system, target: targetOf(system, sections) };
  }
  const writable = (
    ctx: AccessContext,
    s: SystemRow,
    perm: 'fria:manage' | 'dpia:manage' | 'notice:manage',
    t: ReturnType<typeof targetOf>,
  ) => !s.archivedAt && can(ctx, perm, t);
  const requireWrite = (
    ctx: AccessContext,
    s: SystemRow,
    perm: 'fria:manage' | 'dpia:manage' | 'notice:manage',
    t: ReturnType<typeof targetOf>,
  ) => {
    if (s.archivedAt) throw conflict('SIA archivé');
    if (!can(ctx, perm, t)) throw forbidden(`Droit requis : ${perm}`);
  };

  // ═════════════════════════════ FRIA ═════════════════════════════
  type FriaRow = Prisma.FriaGetPayload<{ include: { dpia: true } }>;
  const friaOut = (f: FriaRow, names: Map<string, string>) => {
    const sections = (f.sections ?? {}) as Record<string, string>;
    return {
      id: f.id,
      aiSystemId: f.aiSystemId,
      version: f.version,
      status: f.status,
      sections,
      dpia: f.dpia
        ? { id: f.dpia.id, reference: f.dpia.reference, title: f.dpia.title, coveredTopics: f.dpia.coveredTopics }
        : null,
      coveredByDpia: f.coveredByDpia,
      conclusion: f.conclusion,
      missingSections: friaMissingSections(sections, f.coveredByDpia, f.dpia?.coveredTopics ?? null),
      validatedAt: f.validatedAt?.toISOString() ?? null,
      validatedBy: f.validatedById ? (names.get(f.validatedById) ?? null) : null,
      notifiedAuthorityAt: f.notifiedAuthorityAt?.toISOString() ?? null,
      updatedAt: f.updatedAt.toISOString(),
      updatedBy: f.updatedById ? (names.get(f.updatedById) ?? null) : null,
      updatedById: f.updatedById,
    };
  };

  /** Propositions issues des données de la fiche (à insérer par l'utilisateur, jamais automatiquement). */
  async function friaSuggestions(db: Db, s: SystemRow): Promise<Record<string, string>> {
    const [risks, measures] = await Promise.all([
      db.risk.findMany({
        where: { aiSystemId: s.id, status: { not: 'CLOSED' } },
        select: { reference: true, title: true, category: true, consequence: true },
      }),
      db.measure.findMany({
        where: { aiSystemId: s.id, status: { not: 'ABANDONED' } },
        select: { title: true, status: true },
      }),
    ]);
    const out: Record<string, string> = {};
    const process = [s.purpose, s.operationalContext, s.useCases]
      .map((x) => x.trim())
      .filter(Boolean)
      .join('\n\n');
    if (process) out.process = process;
    const persons = [
      s.dataSubjects.map((d) => d.dataSubject.label).join(', '),
      s.targetPopulations.trim() ? `Populations visées : ${s.targetPopulations.trim()}` : '',
      s.affectedVolumeEstimate ? `Volume estimé : ${s.affectedVolumeEstimate}` : '',
      s.includesMinors === 'YES' ? 'Inclut des mineurs.' : '',
      s.includesVulnerable === 'YES' ? 'Inclut des personnes vulnérables.' : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (persons) out.affectedPersons = persons;
    if (risks.length)
      out.specificRisks = risks
        .map(
          (r) =>
            `- ${r.reference} — ${RISK_TYPE_LABELS[r.category as RiskType]} : ${r.title}${r.consequence ? ` (${r.consequence})` : ''}`,
        )
        .join('\n');
    if (s.autonomyLevel !== 'UNKNOWN')
      out.humanOversight = `Niveau d’autonomie déclaré (étape 1) : ${AUTONOMY_LEVEL_LABELS[s.autonomyLevel]}. [À compléter : qui exerce le contrôle humain, comment, avec quelle formation]`;
    if (measures.length) out.mitigation = measures.map((m) => `- ${m.title} (${m.status})`).join('\n');
    return out;
  }

  app.get(
    '/ai-systems/:sid/frias',
    {
      schema: {
        tags,
        summary: 'FRIA du SIA (versions), exigence issue de la qualification, propositions',
        params: z.object({ sid: id }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, target } = await sys(prisma, ctx, request.params.sid);
      const list = await prisma.fria.findMany({
        where: { aiSystemId: system.id },
        include: { dpia: true },
        orderBy: { version: 'desc' },
      });
      const names = await namesFor(
        prisma,
        list.flatMap((f) => [f.validatedById, f.updatedById]),
      );
      const q = await currentQualification(prisma, system);
      const canManage = writable(ctx, system, 'fria:manage', target);
      return {
        items: list.map((f) => friaOut(f, names)),
        requirement: q ? q.effective.dimensions.fria : null,
        suggestions: canManage ? await friaSuggestions(prisma, system) : {},
        sectionsDef: FRIA_SECTIONS,
        minLength: FRIA_MIN_SECTION_LENGTH,
        canManage,
        canValidate: canManage,
      };
    },
  );

  app.post(
    '/ai-systems/:sid/frias',
    { schema: { tags, summary: 'Nouvelle version de FRIA (reprend la précédente)', params: z.object({ sid: id }) } },
    async (request, reply) => {
      const ctx = requirePermission(request, 'fria:manage');
      const f = await prisma.$transaction(async (tx) => {
        const { system, target } = await sys(tx, ctx, request.params.sid);
        requireWrite(ctx, system, 'fria:manage', target);
        const latest = await tx.fria.findFirst({ where: { aiSystemId: system.id }, orderBy: { version: 'desc' } });
        if (latest && ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW'].includes(latest.status))
          throw conflict('Une FRIA en cours existe déjà pour ce SIA');
        const f = await tx.fria.create({
          data: {
            aiSystemId: system.id,
            version: (latest?.version ?? 0) + 1,
            status: 'IN_PROGRESS',
            sections: (latest?.sections ?? {}) as Prisma.InputJsonValue,
            dpiaId: latest?.dpiaId ?? null,
            coveredByDpia: latest?.coveredByDpia ?? [],
            conclusion: latest?.conclusion ?? '',
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
          include: { dpia: true },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'Fria',
          entityId: f.id,
          aiSystemId: system.id,
          changes: { version: { old: latest?.version ?? null, new: f.version } },
        });
        return f;
      });
      return reply.status(201).send(friaOut(f, await namesFor(prisma, [f.updatedById])));
    },
  );

  async function loadFria(tx: Tx, ctx: AccessContext, fid: string) {
    const f = await tx.fria.findUnique({ where: { id: fid }, include: { dpia: true } });
    if (!f) throw notFound();
    const { system, target } = await sys(tx, ctx, f.aiSystemId).catch(() => {
      throw notFound();
    });
    requireWrite(ctx, system, 'fria:manage', target);
    return { f, system };
  }
  const friaResponse = async (fid: string) => {
    const f = await prisma.fria.findUniqueOrThrow({ where: { id: fid }, include: { dpia: true } });
    return friaOut(f, await namesFor(prisma, [f.validatedById, f.updatedById]));
  };

  app.patch(
    '/frias/:fid',
    {
      schema: {
        tags,
        summary: 'Renseigner la FRIA (brouillon)',
        params: z.object({ fid: id }),
        body: friaUpdateSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'fria:manage');
      const b = request.body;
      await prisma.$transaction(async (tx) => {
        const { f, system } = await loadFria(tx, ctx, request.params.fid);
        if (!['NOT_STARTED', 'IN_PROGRESS'].includes(f.status)) throw conflict('FRIA non modifiable dans cet état');
        const dpiaId = b.dpiaId === undefined ? f.dpiaId : b.dpiaId;
        const dpia = dpiaId ? await tx.dpia.findUnique({ where: { id: dpiaId } }) : null;
        if (dpiaId && (!dpia || dpia.aiSystemId !== system.id)) throw badRequest('DPIA inconnue pour ce SIA');
        const covered = b.coveredByDpia ?? (dpiaId ? f.coveredByDpia : []);
        const notCovered = covered.filter((k) => !dpia?.coveredTopics.includes(k));
        if (notCovered.length) throw badRequest(`Sections non traitées par la DPIA liée : ${notCovered.join(', ')}`);
        const sections = { ...((f.sections ?? {}) as Record<string, string>), ...(b.sections ?? {}) };
        await tx.fria.update({
          where: { id: f.id },
          data: {
            sections,
            dpiaId,
            coveredByDpia: covered,
            conclusion: b.conclusion ?? f.conclusion,
            status: 'IN_PROGRESS',
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'Fria',
          entityId: f.id,
          aiSystemId: system.id,
          changes: {
            ...Object.fromEntries(Object.keys(b.sections ?? {}).map((k) => [`sections.${k}`, { old: '…', new: '…' }])),
            ...(b.dpiaId !== undefined ? { dpiaId: { old: f.dpiaId, new: dpiaId } } : {}),
            ...(b.coveredByDpia ? { coveredByDpia: { old: f.coveredByDpia, new: covered } } : {}),
            ...(b.conclusion !== undefined ? { conclusion: { old: '…', new: '…' } } : {}),
          },
        });
      });
      return friaResponse(request.params.fid);
    },
  );

  const transition = (
    path: string,
    summary: string,
    from: string[],
    to: 'IN_REVIEW' | 'IN_PROGRESS' | 'VALIDATED',
    extra?: (f: FriaRow, ctx: AccessContext) => void,
  ) =>
    app.post(
      `/frias/:fid/${path}`,
      {
        schema: {
          tags,
          summary,
          params: z.object({ fid: id }),
          body: z.strictObject({ comment: z.string().trim().max(2000).default('') }),
        },
      },
      async (request) => {
        const ctx = requirePermission(request, 'fria:manage');
        await prisma.$transaction(async (tx) => {
          const { f, system } = await loadFria(tx, ctx, request.params.fid);
          if (!from.includes(f.status)) throw conflict('Transition impossible dans cet état');
          extra?.(f, ctx);
          if (to === 'VALIDATED')
            await tx.fria.updateMany({
              where: { aiSystemId: system.id, status: 'VALIDATED' },
              data: { status: 'WITHDRAWN' },
            });
          await tx.fria.update({
            where: { id: f.id },
            data: {
              status: to,
              ...(to === 'VALIDATED'
                ? { validatedAt: new Date(), validatedById: ctx.user.id }
                : { updatedById: ctx.user.id }),
            },
          });
          await recordAudit(tx, actorOf(request), {
            action: `fria_${path}`,
            entityType: 'Fria',
            entityId: f.id,
            aiSystemId: system.id,
            justification: request.body.comment || null,
            changes: { status: { old: f.status, new: to } },
          });
          if (to === 'IN_REVIEW' || to === 'IN_PROGRESS')
            await notify(
              tx,
              [system.ownerId],
              {
                type: 'review',
                title: `FRIA v${f.version} ${to === 'IN_REVIEW' ? 'soumise à validation' : 'renvoyée en rédaction'} — ${system.reference}`,
                body: request.body.comment,
                link: `/systemes/${system.id}?etape=documentation`,
              },
              ctx.user.id,
            );
        });
        return friaResponse(request.params.fid);
      },
    );

  transition(
    'submit',
    'Soumettre la FRIA à validation (sections complètes ou couvertes par la DPIA, conclusion)',
    ['IN_PROGRESS'],
    'IN_REVIEW',
    (f) => {
      const missing = friaMissingSections(
        (f.sections ?? {}) as Record<string, string>,
        f.coveredByDpia,
        f.dpia?.coveredTopics ?? null,
      );
      if (missing.length) throw badRequest(`Sections incomplètes : ${missing.join(', ')}`, { missing });
      if (f.conclusion.trim().length < FRIA_MIN_SECTION_LENGTH) throw badRequest('Conclusion de 30 caractères minimum');
    },
  );
  transition('return', 'Renvoyer la FRIA en rédaction', ['IN_REVIEW'], 'IN_PROGRESS');
  transition('validate', 'Valider la FRIA (validateur ≠ dernier rédacteur)', ['IN_REVIEW'], 'VALIDATED', (f, ctx) => {
    if (f.updatedById === ctx.user.id)
      throw forbidden(
        'Principe des quatre yeux : la FRIA doit être validée par une autre personne que son dernier rédacteur',
      );
  });

  app.post(
    '/frias/:fid/authority-notification',
    {
      schema: {
        tags,
        summary: 'Enregistrer la notification des résultats à l’autorité de surveillance (art. 27(3))',
        params: z.object({ fid: id }),
        body: z.strictObject({ date: z.iso.date() }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'fria:manage');
      await prisma.$transaction(async (tx) => {
        const { f, system } = await loadFria(tx, ctx, request.params.fid);
        if (f.status !== 'VALIDATED') throw conflict('Seule une FRIA validée peut être notifiée');
        await tx.fria.update({
          where: { id: f.id },
          data: { notifiedAuthorityAt: new Date(`${request.body.date}T00:00:00Z`) },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'fria_notified',
          entityType: 'Fria',
          entityId: f.id,
          aiSystemId: system.id,
          changes: { notifiedAuthorityAt: { old: dayOf(f.notifiedAuthorityAt), new: request.body.date } },
        });
      });
      return friaResponse(request.params.fid);
    },
  );

  // ═════════════════════════════ DPIA ═════════════════════════════
  type DpiaRow = Prisma.DpiaGetPayload<{ include: { processingActivity: { select: { id: true; name: true } } } }>;
  const dpiaOut = (d: DpiaRow) => ({
    id: d.id,
    reference: d.reference,
    title: d.title,
    aiSystemId: d.aiSystemId,
    processingActivity: d.processingActivity,
    status: d.status,
    externalUrl: d.externalUrl,
    conductedOn: dayOf(d.conductedOn),
    conclusion: d.conclusion,
    coveredTopics: d.coveredTopics,
    updatedAt: d.updatedAt.toISOString(),
  });
  const dpiaInclude = { processingActivity: { select: { id: true, name: true } } } as const;

  app.get(
    '/ai-systems/:sid/dpias',
    { schema: { tags, summary: 'Références DPIA / AIPD du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, target } = await sys(prisma, ctx, request.params.sid);
      const list = await prisma.dpia.findMany({
        where: { aiSystemId: system.id },
        include: dpiaInclude,
        orderBy: { createdAt: 'desc' },
      });
      return { items: list.map(dpiaOut), canManage: writable(ctx, system, 'dpia:manage', target) };
    },
  );

  app.post(
    '/ai-systems/:sid/dpias',
    {
      schema: {
        tags,
        summary: 'Référencer une DPIA (réalisée ici ou dans un outil tiers)',
        params: z.object({ sid: id }),
        body: dpiaSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'dpia:manage');
      const b = request.body;
      const d = await prisma.$transaction(async (tx) => {
        const { system, target } = await sys(tx, ctx, request.params.sid);
        requireWrite(ctx, system, 'dpia:manage', target);
        if (
          b.processingActivityId &&
          !(await tx.processingActivity.findUnique({ where: { id: b.processingActivityId } }))
        )
          throw badRequest('Traitement inconnu');
        const d = await tx.dpia.create({
          data: {
            ...b,
            reference: await nextSeqReference(tx, 'dpia', 'DPIA'),
            aiSystemId: system.id,
            conductedOn: b.conductedOn ? new Date(`${b.conductedOn}T00:00:00Z`) : null,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
          include: dpiaInclude,
        });
        await recordAudit(tx, actorOf(request), {
          action: 'create',
          entityType: 'Dpia',
          entityId: d.id,
          aiSystemId: system.id,
          changes: { reference: { old: null, new: d.reference }, title: { old: null, new: d.title } },
        });
        return d;
      });
      return reply.status(201).send(dpiaOut(d));
    },
  );

  app.patch(
    '/dpias/:did',
    { schema: { tags, summary: 'Modifier une référence DPIA', params: z.object({ did: id }), body: dpiaUpdateSchema } },
    async (request) => {
      const ctx = requirePermission(request, 'dpia:manage');
      const b = request.body;
      const d = await prisma.$transaction(async (tx) => {
        const d = await tx.dpia.findUnique({ where: { id: request.params.did } });
        if (!d) throw notFound();
        const { system, target } = await sys(tx, ctx, d.aiSystemId).catch(() => {
          throw notFound();
        });
        requireWrite(ctx, system, 'dpia:manage', target);
        // Retirer un thème encore revendiqué par une FRIA en cours la rendrait incohérente.
        if (b.coveredTopics) {
          const removed = d.coveredTopics.filter((t) => !b.coveredTopics!.includes(t as never));
          if (removed.length) {
            const users = await tx.fria.count({
              where: {
                dpiaId: d.id,
                status: { in: ['IN_PROGRESS', 'IN_REVIEW', 'VALIDATED'] },
                coveredByDpia: { hasSome: removed },
              },
            });
            if (users) throw conflict('Une FRIA s’appuie sur ces thèmes : retirez-les d’abord de la FRIA');
          }
        }
        const u = await tx.dpia.update({
          where: { id: d.id },
          data: {
            ...b,
            conductedOn:
              b.conductedOn === undefined ? undefined : b.conductedOn ? new Date(`${b.conductedOn}T00:00:00Z`) : null,
            updatedById: ctx.user.id,
          },
          include: dpiaInclude,
        });
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const k of Object.keys(b) as (keyof typeof b)[]) {
          const o = (d as Record<string, unknown>)[k];
          const oo = o instanceof Date ? dayOf(o) : o;
          if (JSON.stringify(oo ?? null) !== JSON.stringify(b[k] ?? null))
            changes[k] = { old: oo ?? null, new: b[k] ?? null };
        }
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'Dpia',
          entityId: d.id,
          aiSystemId: system.id,
          changes,
        });
        return u;
      });
      return dpiaOut(d);
    },
  );

  // ═════════════════════════════ Notices ═════════════════════════════
  type NoticeRow = Prisma.TransparencyNoticeGetPayload<object>;
  const noticeOut = (n: NoticeRow, names: Map<string, string>) => ({
    id: n.id,
    aiSystemId: n.aiSystemId,
    language: n.language,
    version: n.version,
    status: n.status,
    origin: n.origin,
    blocks: n.blocks,
    contentMarkdown: n.contentMarkdown,
    placeholders: (n.contentMarkdown.match(/\[À compléter[^\]]*\]/g) ?? []).length,
    validatedAt: n.validatedAt?.toISOString() ?? null,
    validatedBy: n.validatedById ? (names.get(n.validatedById) ?? null) : null,
    withdrawnAt: n.withdrawnAt?.toISOString() ?? null,
    documentId: n.documentId,
    updatedAt: n.updatedAt.toISOString(),
    updatedBy: n.updatedById ? (names.get(n.updatedById) ?? null) : null,
  });

  async function noticeSource(db: Db, s: SystemRow) {
    const settings = await noticeSettings(db);
    return {
      organization: settings.organization,
      contact: settings.contact,
      system: { name: s.name, reference: s.reference, purpose: s.purpose, functioning: s.functioning },
      models: s.models.map((m) => ({ name: m.aiModel.name, vendor: m.aiModel.vendor?.name ?? null })),
      processesPersonalData: s.processesPersonalData,
      hasHumanOversight: ['ASSISTIVE', 'HUMAN_IN_THE_LOOP'].includes(s.autonomyLevel),
    };
  }

  app.get(
    '/ai-systems/:sid/notices',
    { schema: { tags, summary: 'Notices de transparence du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, target } = await sys(prisma, ctx, request.params.sid);
      const list = await prisma.transparencyNotice.findMany({
        where: { aiSystemId: system.id },
        orderBy: { version: 'desc' },
      });
      const names = await namesFor(
        prisma,
        list.flatMap((n) => [n.validatedById, n.updatedById]),
      );
      const q = await currentQualification(prisma, system);
      return {
        items: list.map((n) => noticeOut(n, names)),
        transparency: q ? q.effective.dimensions.transparency : null,
        suggestedBlocks: suggestedBlocks(q?.answers ?? null),
        canManage: writable(ctx, system, 'notice:manage', target),
        canValidate: !system.archivedAt && can(ctx, 'notice:validate', target),
      };
    },
  );

  app.post(
    '/ai-systems/:sid/notices',
    {
      schema: {
        tags,
        summary: 'Générer une nouvelle version de notice depuis les données structurées',
        params: z.object({ sid: id }),
        body: z.strictObject({ blocks: noticeUpdateSchema.shape.blocks }),
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const n = await prisma.$transaction(async (tx) => {
        const { system, target } = await sys(tx, ctx, request.params.sid);
        requireWrite(ctx, system, 'notice:manage', target);
        const latest = await tx.transparencyNotice.findFirst({
          where: { aiSystemId: system.id, language: 'fr' },
          orderBy: { version: 'desc' },
        });
        if (latest && ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW'].includes(latest.status))
          throw conflict('Une notice en cours existe déjà pour ce SIA');
        const q = await currentQualification(tx, system);
        const blocks = (request.body.blocks ?? suggestedBlocks(q?.answers ?? null)) as NoticeBlock[];
        const source = await noticeSource(tx, system);
        const n = await tx.transparencyNotice.create({
          data: {
            aiSystemId: system.id,
            language: 'fr',
            version: (latest?.version ?? 0) + 1,
            status: 'IN_PROGRESS',
            origin: 'SYSTEM',
            blocks,
            contentMarkdown: generateNotice(source, blocks),
            sourceSnapshot: source as unknown as Prisma.InputJsonValue,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'generate',
          entityType: 'TransparencyNotice',
          entityId: n.id,
          aiSystemId: system.id,
          changes: { version: { old: latest?.version ?? null, new: n.version }, blocks: { old: null, new: blocks } },
        });
        return n;
      });
      return reply.status(201).send(noticeOut(n, await namesFor(prisma, [n.updatedById])));
    },
  );

  async function loadNotice(tx: Tx, ctx: AccessContext, nid: string, perm: 'notice:manage' | 'notice:validate') {
    const n = await tx.transparencyNotice.findUnique({ where: { id: nid } });
    if (!n) throw notFound();
    const { system, target } = await sys(tx, ctx, n.aiSystemId).catch(() => {
      throw notFound();
    });
    if (system.archivedAt) throw conflict('SIA archivé');
    if (!can(ctx, perm, target)) throw forbidden(`Droit requis : ${perm}`);
    return { n, system };
  }
  const noticeResponse = async (nid: string) => {
    const n = await prisma.transparencyNotice.findUniqueOrThrow({ where: { id: nid } });
    return noticeOut(n, await namesFor(prisma, [n.validatedById, n.updatedById]));
  };

  app.patch(
    '/notices/:nid',
    {
      schema: {
        tags,
        summary: 'Modifier le texte ou les blocs (brouillon)',
        params: z.object({ nid: id }),
        body: noticeUpdateSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { n, system } = await loadNotice(tx, ctx, request.params.nid, 'notice:manage');
        if (n.status !== 'IN_PROGRESS' && n.status !== 'NOT_STARTED')
          throw conflict('Notice non modifiable dans cet état');
        await tx.transparencyNotice.update({
          where: { id: n.id },
          data: {
            ...request.body,
            origin: request.body.contentMarkdown !== undefined ? 'USER' : n.origin,
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'TransparencyNotice',
          entityId: n.id,
          aiSystemId: system.id,
          changes: {
            ...(request.body.blocks ? { blocks: { old: n.blocks, new: request.body.blocks } } : {}),
            ...(request.body.contentMarkdown !== undefined
              ? {
                  contentMarkdown: {
                    old: `${n.contentMarkdown.length} car.`,
                    new: `${request.body.contentMarkdown.length} car.`,
                  },
                }
              : {}),
          },
        });
      });
      return noticeResponse(request.params.nid);
    },
  );

  app.post(
    '/notices/:nid/regenerate',
    {
      schema: {
        tags,
        summary: 'Régénérer le texte depuis les données (remplace les modifications manuelles)',
        params: z.object({ nid: id }),
        body: z.strictObject({ blocks: noticeUpdateSchema.shape.blocks }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { n, system } = await loadNotice(tx, ctx, request.params.nid, 'notice:manage');
        if (n.status !== 'IN_PROGRESS' && n.status !== 'NOT_STARTED')
          throw conflict('Notice non modifiable dans cet état');
        const blocks = (request.body.blocks ?? n.blocks) as NoticeBlock[];
        const source = await noticeSource(tx, system);
        await tx.transparencyNotice.update({
          where: { id: n.id },
          data: {
            blocks,
            contentMarkdown: generateNotice(source, blocks),
            sourceSnapshot: source as unknown as Prisma.InputJsonValue,
            origin: 'SYSTEM',
            updatedById: ctx.user.id,
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'regenerate',
          entityType: 'TransparencyNotice',
          entityId: n.id,
          aiSystemId: system.id,
          changes: { blocks: { old: n.blocks, new: blocks } },
        });
      });
      return noticeResponse(request.params.nid);
    },
  );

  app.post(
    '/notices/:nid/submit',
    {
      schema: {
        tags,
        summary: 'Soumettre à validation (aucun « [À compléter] » restant)',
        params: z.object({ nid: id }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { n, system } = await loadNotice(tx, ctx, request.params.nid, 'notice:manage');
        if (n.status !== 'IN_PROGRESS') throw conflict('Transition impossible dans cet état');
        if (PLACEHOLDER.test(n.contentMarkdown))
          throw badRequest('Complétez les mentions « [À compléter : …] » avant de soumettre');
        if (n.contentMarkdown.trim().length < 100) throw badRequest('Notice trop courte');
        await tx.transparencyNotice.update({
          where: { id: n.id },
          data: { status: 'IN_REVIEW', updatedById: ctx.user.id },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'notice_submit',
          entityType: 'TransparencyNotice',
          entityId: n.id,
          aiSystemId: system.id,
          changes: { status: { old: n.status, new: 'IN_REVIEW' } },
        });
      });
      return noticeResponse(request.params.nid);
    },
  );

  app.post(
    '/notices/:nid/return',
    {
      schema: {
        tags,
        summary: 'Renvoyer en rédaction',
        params: z.object({ nid: id }),
        body: z.strictObject({ comment: z.string().trim().min(10).max(2000) }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { n, system } = await loadNotice(tx, ctx, request.params.nid, 'notice:validate');
        if (n.status !== 'IN_REVIEW') throw conflict('Transition impossible dans cet état');
        await tx.transparencyNotice.update({ where: { id: n.id }, data: { status: 'IN_PROGRESS' } });
        await recordAudit(tx, actorOf(request), {
          action: 'notice_return',
          entityType: 'TransparencyNotice',
          entityId: n.id,
          aiSystemId: system.id,
          justification: request.body.comment,
          changes: { status: { old: n.status, new: 'IN_PROGRESS' } },
        });
        await notify(
          tx,
          [n.updatedById],
          {
            type: 'review',
            title: `Notice v${n.version} renvoyée en rédaction — ${system.reference}`,
            body: request.body.comment,
            link: `/systemes/${system.id}?etape=documentation`,
          },
          ctx.user.id,
        );
      });
      return noticeResponse(request.params.nid);
    },
  );

  app.post(
    '/notices/:nid/validate',
    {
      schema: {
        tags,
        summary: 'Valider (notice:validate, validateur ≠ dernier rédacteur) ; la notice est ajoutée aux pièces du SIA',
        params: z.object({ nid: id }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'notice:validate');
      // Le fichier Markdown est écrit avant la transaction ; supprimé si elle échoue.
      const pre = await prisma.transparencyNotice.findUnique({ where: { id: request.params.nid } });
      if (!pre) throw notFound();
      const stored = await storage.save(Readable.from(Buffer.from(pre.contentMarkdown, 'utf8')));
      try {
        await prisma.$transaction(async (tx) => {
          const { n, system } = await loadNotice(tx, ctx, request.params.nid, 'notice:validate');
          if (n.status !== 'IN_REVIEW') throw conflict('Seule une notice en relecture peut être validée');
          if (n.updatedById === ctx.user.id)
            throw forbidden(
              'Principe des quatre yeux : la notice doit être validée par une autre personne que son dernier rédacteur',
            );
          if (n.contentMarkdown !== pre.contentMarkdown) throw conflict('La notice a changé : rechargez la page');
          const now = new Date();
          await tx.transparencyNotice.updateMany({
            where: { aiSystemId: system.id, language: n.language, status: 'VALIDATED' },
            data: { status: 'WITHDRAWN', withdrawnAt: now },
          });
          const fileName = `notice-transparence-${system.reference}-v${n.version}.md`;
          const doc = await tx.document.create({
            data: {
              title: `Notice de transparence v${n.version}`,
              type: 'TRANSPARENCY_NOTICE',
              description: `Version validée le ${now.toISOString().slice(0, 10)} (générée par Chandelier).`,
              aiSystemId: system.id,
              isDemo: system.isDemo,
              currentVersionNo: 1,
              createdById: ctx.user.id,
              updatedById: ctx.user.id,
              versions: {
                create: {
                  versionNo: 1,
                  storageKey: stored.storageKey,
                  fileName,
                  mimeType: 'text/markdown; charset=utf-8',
                  sizeBytes: stored.sizeBytes,
                  sha256: stored.sha256,
                  uploadedById: ctx.user.id,
                },
              },
            },
          });
          await tx.transparencyNotice.update({
            where: { id: n.id },
            data: {
              status: 'VALIDATED',
              validatedAt: now,
              validatedById: ctx.user.id,
              publishedAt: now,
              documentId: doc.id,
            },
          });
          await recordAudit(tx, actorOf(request), {
            action: 'notice_validate',
            entityType: 'TransparencyNotice',
            entityId: n.id,
            aiSystemId: system.id,
            changes: {
              status: { old: 'IN_REVIEW', new: 'VALIDATED' },
              document: { old: null, new: `${fileName} (sha256 ${stored.sha256.slice(0, 12)}…)` },
            },
          });
        });
      } catch (e) {
        await storage.remove(stored.storageKey);
        throw e;
      }
      return noticeResponse(request.params.nid);
    },
  );

  app.post(
    '/notices/:nid/withdraw',
    {
      schema: {
        tags,
        summary: 'Retirer une notice validée',
        params: z.object({ nid: id }),
        body: z.strictObject({ reason: z.string().trim().min(10).max(2000) }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { n, system } = await loadNotice(tx, ctx, request.params.nid, 'notice:validate');
        if (n.status !== 'VALIDATED') throw conflict('Seule une notice validée peut être retirée');
        await tx.transparencyNotice.update({
          where: { id: n.id },
          data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'notice_withdraw',
          entityType: 'TransparencyNotice',
          entityId: n.id,
          aiSystemId: system.id,
          justification: request.body.reason,
          changes: { status: { old: 'VALIDATED', new: 'WITHDRAWN' } },
        });
      });
      return noticeResponse(request.params.nid);
    },
  );

  app.get(
    '/notices/:nid/export',
    {
      schema: {
        tags,
        summary: 'Exporter la notice (Markdown ou HTML échappé) — PDF/DOCX non implémentés',
        params: z.object({ nid: id }),
        querystring: z.object({ format: z.enum(['md', 'html']).default('md') }),
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const n = await prisma.transparencyNotice.findUnique({ where: { id: request.params.nid } });
      if (!n) throw notFound();
      const { system } = await sys(prisma, ctx, n.aiSystemId).catch(() => {
        throw notFound();
      });
      const base = `notice-transparence-${system.reference}-v${n.version}`;
      const html = request.query.format === 'html';
      const body = html ? markdownToHtml(n.contentMarkdown, `Notice — ${system.name}`) : n.contentMarkdown;
      await prisma.$transaction((tx) =>
        recordAudit(tx, actorOf(request), {
          action: 'export',
          entityType: 'TransparencyNotice',
          entityId: n.id,
          aiSystemId: system.id,
          changes: { format: { old: null, new: request.query.format } },
        }),
      );
      return reply
        .header('Content-Type', html ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${base}.${html ? 'html' : 'md'}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(body);
    },
  );

  app.get(
    '/settings/notice',
    { schema: { tags, summary: 'Mentions par défaut des notices (organisation, contact)' } },
    async (request) => {
      requirePermission(request, 'aiSystem:read');
      return noticeSettings(prisma);
    },
  );
  app.put(
    '/settings/notice',
    { schema: { tags, summary: 'Modifier les mentions par défaut (settings:manage)', body: noticeSettingsSchema } },
    async (request) => {
      const ctx = requirePermission(request, 'settings:manage');
      await prisma.$transaction(async (tx) => {
        const before = await noticeSettings(tx);
        await tx.appSetting.upsert({
          where: { key: NOTICE_SETTINGS },
          update: { value: request.body, updatedById: ctx.user.id },
          create: { key: NOTICE_SETTINGS, value: request.body, updatedById: ctx.user.id },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'AppSetting',
          changes: { [NOTICE_SETTINGS]: { old: before, new: request.body } },
        });
      });
      return noticeSettings(prisma);
    },
  );

  // ═════════════════════════════ Portefeuilles ═════════════════════════════
  app.get(
    '/compliance-portfolio',
    { schema: { tags, summary: 'FRIA, DPIA et notices des SIA du périmètre (exigences issues de la qualification)' } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const systems = await prisma.aiSystem.findMany({
        where: { AND: [scopeWhere(ctx), { archivedAt: null }] },
        select: {
          id: true,
          reference: true,
          name: true,
          isDemo: true,
          currentAssessmentId: true,
          frias: {
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true, version: true, status: true, notifiedAuthorityAt: true },
          },
          notices: { orderBy: { version: 'desc' }, take: 2, select: { id: true, version: true, status: true } },
          dpias: {
            select: { id: true, reference: true, title: true, status: true, externalUrl: true, conductedOn: true },
          },
        },
        orderBy: { reference: 'asc' },
      });
      const items = [];
      for (const s of systems) {
        const q = await currentQualification(prisma, s);
        items.push({
          system: { id: s.id, reference: s.reference, name: s.name, isDemo: s.isDemo },
          fria: { requirement: q?.effective.dimensions.fria.value ?? null, latest: s.frias[0] ?? null },
          notice: {
            transparency: q?.effective.dimensions.transparency.value ?? null,
            latest: s.notices[0] ?? null,
            hasValidated: s.notices.some((n) => n.status === 'VALIDATED'),
          },
          dpias: s.dpias.map((d) => ({ ...d, conductedOn: dayOf(d.conductedOn) })),
        });
      }
      return { items, canSeeAll: hasPermission(ctx, 'aiSystem:read') };
    },
  );
};
