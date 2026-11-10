import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  aiSystemListQuerySchema,
  applyOverrides,
  levelOf,
  methodologyConfigSchema,
  topLevel,
  type EvaluationResult,
} from '@chandelier/shared';
import { requirePermission } from '../http.js';
import { buildListWhere } from './ai-systems/service.js';
import { addDays, today } from './common.js';

/** Filtres du tableau de bord : ceux du registre (hors tri, pagination, archivage). */
const dashboardQuery = aiSystemListQuerySchema.omit({
  sort: true,
  dir: true,
  page: true,
  pageSize: true,
  archived: true,
});

type Severity = 'critical' | 'serious' | 'warning';
interface Alert {
  code: string;
  severity: Severity;
  message: string;
  count: number;
  link: string;
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/**
 * Indicateurs du tableau de bord (F-048 à F-050) : chaque valeur est calculée à la demande à partir
 * des données du périmètre de l'utilisateur et des filtres ; aucune valeur n'est stockée ni simulée.
 */
export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;

  app.get(
    '/dashboard',
    {
      schema: {
        tags: ['Tableau de bord'],
        summary: 'Indicateurs calculés sur le périmètre et les filtres (mêmes filtres que le registre)',
        querystring: dashboardQuery,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const q = request.query;
      const day = today();
      const todayDate = new Date(`${day}T00:00:00Z`);
      const where = await buildListWhere(prisma, ctx, { ...q, archived: 'exclude' });
      const systems = await prisma.aiSystem.findMany({
        where,
        select: {
          id: true,
          status: true,
          riskCategory: true,
          valueLevel: true,
          complianceStatus: true,
          completeness: true,
          ownerId: true,
          currentAssessmentId: true,
          nextReviewDate: true,
          createdAt: true,
          version: true,
          lockedVersion: true,
          orgUnit: { select: { id: true, name: true } },
        },
        take: 10_000,
      });
      const ids = systems.map((s) => s.id);
      const inSystems = { aiSystemId: { in: ids } };

      const count = <K extends string>(keyOf: (s: (typeof systems)[number]) => K) => {
        const m: Record<string, number> = {};
        for (const s of systems) m[keyOf(s)] = (m[keyOf(s)] ?? 0) + 1;
        return m;
      };
      const matrix: Record<string, Record<string, number>> = {};
      for (const s of systems) {
        matrix[s.riskCategory] ??= {};
        matrix[s.riskCategory]![s.valueLevel] = (matrix[s.riskCategory]![s.valueLevel] ?? 0) + 1;
      }
      const units = Object.values(
        systems.reduce<Record<string, { id: string; name: string; count: number }>>((acc, s) => {
          acc[s.orgUnit.id] ??= { id: s.orgUnit.id, name: s.orgUnit.name, count: 0 };
          acc[s.orgUnit.id]!.count++;
          return acc;
        }, {}),
      ).sort((a, b) => b.count - a.count);

      // Évolution : SIA créés par mois sur 12 mois glissants (et cumul).
      const months: string[] = [];
      const start = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - 11, 1));
      for (let i = 0; i < 12; i++)
        months.push(monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
      const createdBefore = systems.filter((s) => s.createdAt < start).length;
      let cumul = createdBefore;
      const evolution = months.map((m) => {
        const created = systems.filter((s) => monthKey(s.createdAt) === m).length;
        cumul += created;
        return { month: m, created, total: cumul };
      });

      // Qualification effective courante (surcharges juridiques comprises) : FRIA et transparence.
      const assessments = await prisma.aiActAssessment.findMany({
        where: { id: { in: systems.map((s) => s.currentAssessmentId).filter((x): x is string => !!x) } },
        include: { overrides: true },
      });
      const friaRequired = new Set<string>();
      const transparencyApplicable = new Set<string>();
      for (const a of assessments) {
        if (!a.computedResult) continue;
        const eff = applyOverrides(
          a.computedResult as unknown as EvaluationResult,
          a.overrides.map((o) => ({
            dimension: o.dimension,
            newValue: o.newValue as string,
            justification: o.justification,
            authorId: o.authorId,
            createdAt: o.createdAt.toISOString(),
          })),
        );
        if (eff.dimensions.fria.value === 'REQUIRED') friaRequired.add(a.aiSystemId);
        if (eff.dimensions.transparency.value === 'APPLICABLE') transparencyApplicable.add(a.aiSystemId);
      }
      const [validatedFrias, validNotices] = await Promise.all([
        prisma.fria.findMany({ where: { ...inSystems, status: 'VALIDATED' }, select: { aiSystemId: true } }),
        prisma.transparencyNotice.findMany({
          where: { ...inSystems, status: 'VALIDATED', withdrawnAt: null },
          select: { aiSystemId: true },
        }),
      ]);
      const friaMissing = [...friaRequired].filter((id) => !validatedFrias.some((f) => f.aiSystemId === id)).length;
      const noticeMissing = [...transparencyApplicable].filter(
        (id) => !validNotices.some((n) => n.aiSystemId === id),
      ).length;

      const [
        actionsOpen,
        actionsOverdue,
        reviewsOverdue,
        obligationsNonCompliant,
        obligationsOverdue,
        pendingApprovals,
        openRisks,
      ] = await Promise.all([
        prisma.action.count({ where: { ...inSystems, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        prisma.action.count({
          where: { ...inSystems, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: todayDate } },
        }),
        prisma.review.count({
          where: { ...inSystems, status: { in: ['PLANNED', 'IN_PROGRESS'] }, dueDate: { lt: todayDate } },
        }),
        prisma.obligation.count({ where: { ...inSystems, status: 'NON_COMPLIANT', applicability: { not: 'NO' } } }),
        prisma.obligation.count({
          where: {
            ...inSystems,
            applicability: { not: 'NO' },
            status: { notIn: ['COMPLIANT', 'NOT_APPLICABLE'] },
            targetDate: { lt: todayDate },
          },
        }),
        prisma.approval.count({ where: { ...inSystems, status: 'PENDING' } }),
        prisma.risk.findMany({
          where: { ...inSystems, status: { not: 'CLOSED' } },
          select: { residualScore: true, inherentScore: true, methodology: { select: { config: true } } },
        }),
      ]);
      const active = await prisma.riskMethodology.findFirst({ where: { isActive: true } });
      const activeTop = active ? topLevel(methodologyConfigSchema.parse(active.config)) : null;
      let criticalRisks = 0;
      for (const r of openRisks) {
        const cfg = methodologyConfigSchema.safeParse(r.methodology.config);
        if (!cfg.success) continue;
        if (levelOf(cfg.data, r.residualScore ?? r.inherentScore)?.level === topLevel(cfg.data)) criticalRisks++;
      }
      const reviewDue = systems.filter((s) => s.nextReviewDate && s.nextReviewDate < todayDate).length;
      const reviewSoon = systems.filter(
        (s) =>
          s.nextReviewDate &&
          s.nextReviewDate >= todayDate &&
          s.nextReviewDate <= new Date(`${addDays(day, 30)}T00:00:00Z`),
      ).length;
      const notQualified = systems.filter((s) => !s.currentAssessmentId).length;
      const noOwner = systems.filter((s) => !s.ownerId).length;
      const incomplete = systems.filter((s) => s.completeness < 50).length;
      const validated = systems.filter((s) => s.lockedVersion != null && s.lockedVersion === s.version).length;
      const byRisk = count((s) => s.riskCategory);

      const alerts: Alert[] = [
        {
          code: 'PROHIBITED',
          severity: 'critical' as const,
          message: 'SIA potentiellement interdits (art. 5) : analyse juridique immédiate',
          count: byRisk.PROHIBITED ?? 0,
          link: '/systemes?risk=PROHIBITED',
        },
        {
          code: 'CRITICAL_RISKS',
          severity: 'critical' as const,
          message: 'Risques ouverts au niveau le plus élevé',
          count: criticalRisks,
          link: activeTop ? `/risques?level=${activeTop}` : '/risques',
        },
        {
          code: 'FRIA_MISSING',
          severity: 'serious' as const,
          message: 'FRIA requise sans FRIA validée',
          count: friaMissing,
          link: '/documentation/fria',
        },
        {
          code: 'NOTICE_MISSING',
          severity: 'serious' as const,
          message: 'Obligations de transparence sans notice validée',
          count: noticeMissing,
          link: '/documentation/notices',
        },
        {
          code: 'OBLIGATIONS_NON_COMPLIANT',
          severity: 'serious' as const,
          message: 'Obligations non conformes',
          count: obligationsNonCompliant,
          link: '/evaluations',
        },
        {
          code: 'ACTIONS_OVERDUE',
          severity: 'serious' as const,
          message: 'Actions échues',
          count: actionsOverdue,
          link: '/actions?overdue=true',
        },
        {
          code: 'REVIEWS_OVERDUE',
          severity: 'warning' as const,
          message: 'Revues en retard (revue planifiée échue ou date de prochaine revue dépassée)',
          count: reviewsOverdue + reviewDue,
          link: `/systemes?reviewBefore=${addDays(day, -1)}`,
        },
        {
          code: 'OBLIGATIONS_OVERDUE',
          severity: 'warning' as const,
          message: 'Obligations dont la date cible est dépassée',
          count: obligationsOverdue,
          link: '/evaluations',
        },
        {
          code: 'NOT_QUALIFIED',
          severity: 'warning' as const,
          message: 'SIA sans qualification AI Act',
          count: notQualified,
          link: '/systemes?qualified=no',
        },
        {
          code: 'NO_OWNER',
          severity: 'warning' as const,
          message: 'SIA sans propriétaire',
          count: noOwner,
          link: '/systemes?noOwner=true',
        },
        {
          code: 'INCOMPLETE',
          severity: 'warning' as const,
          message: 'Fiches complètes à moins de 50 %',
          count: incomplete,
          link: '/systemes?completenessMax=49',
        },
      ].filter((a) => a.count > 0);

      return {
        generatedAt: new Date().toISOString(),
        total: systems.length,
        truncated: systems.length === 10_000,
        byStatus: count((s) => s.status),
        byRisk,
        byValue: count((s) => s.valueLevel),
        byCompliance: count((s) => s.complianceStatus),
        byUnit: units.slice(0, 12),
        otherUnits: units.slice(12).reduce((n, u) => n + u.count, 0),
        matrix,
        evolution,
        kpis: {
          prohibited: byRisk.PROHIBITED ?? 0,
          highRisk: byRisk.HIGH ?? 0,
          notQualified,
          friaRequired: friaRequired.size,
          friaMissing,
          noticeRequired: transparencyApplicable.size,
          noticeMissing,
          averageCompleteness: systems.length
            ? Math.round(systems.reduce((n, s) => n + s.completeness, 0) / systems.length)
            : null,
          incomplete,
          noOwner,
          validated,
          pendingApprovals,
          reviewsOverdue: reviewsOverdue + reviewDue,
          reviewsNext30Days: reviewSoon,
          actionsOpen,
          actionsOverdue,
          openRisks: openRisks.length,
          criticalRisks,
          obligationsNonCompliant,
        },
        alerts,
      };
    },
  );
};
