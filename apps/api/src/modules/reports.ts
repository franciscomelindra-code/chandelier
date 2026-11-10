import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AI_ACT_ROLE_LABELS,
  AI_SYSTEM_STATUS_META,
  APPLICABILITY_LABELS,
  AUTONOMY_LEVEL_LABELS,
  COMPLIANCE_STATUS_META,
  FRIA_SECTIONS,
  OBLIGATION_STATUS_META,
  RISK_CATEGORY_META,
  RISK_STATUS_META,
  RISK_TREATMENT_LABELS,
  RISK_TYPE_LABELS,
  ACTION_STATUS_META,
  PRIORITY_LABELS,
  VALUE_LEVEL_META,
  WORK_STATUS_META,
  levelOf,
  markdownToHtml,
  methodologyConfigSchema,
  type AiActRole,
  type RiskType,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { badRequest, forbidden } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, type AccessContext } from '../rbac/access.js';
import { localStorage } from '../storage.js';
import { toCsv, toXlsx, type Table } from '../export/tabular.js';
import { zip, type ZipEntry } from '../export/zip.js';
import { loadVisible, scopeWhere, systemInclude, targetOf, type SystemRow } from './ai-systems/service.js';
import { dayOf, namesFor, today, type Db } from './common.js';
import { currentQualification } from './compliance.js';

const lbl = <T extends Record<string, { label: string }>>(m: T, k: string) => m[k as keyof T]?.label ?? k;
const RISK_ROWS = ['PROHIBITED', 'HIGH', 'LIMITED', 'MINIMAL', 'UNDETERMINED', 'OUT_OF_SCOPE'];
const VALUE_COLS = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

interface ReportDef {
  key: string;
  title: string;
  description: string;
  build: (db: Db, where: Prisma.AiSystemWhereInput) => Promise<Table>;
}

const sysSelect = {
  id: true,
  reference: true,
  name: true,
  status: true,
  riskCategory: true,
  valueLevel: true,
  complianceStatus: true,
  completeness: true,
  aiActRoles: true,
  nextReviewDate: true,
  lastReviewDate: true,
  createdAt: true,
  updatedAt: true,
  isDemo: true,
  ownerId: true,
  currentAssessmentId: true,
  orgUnit: { select: { name: true } },
  owner: { select: { displayName: true } },
} satisfies Prisma.AiSystemSelect;

const roles = (r: string[]) => r.map((x) => AI_ACT_ROLE_LABELS[x as AiActRole] ?? x).join(', ');

const REPORTS: ReportDef[] = [
  {
    key: 'registre',
    title: 'Registre complet des SIA',
    description: 'Tous les SIA non archivés du périmètre, avec qualification, valeur, conformité et revue.',
    build: async (db, where) => {
      const rows = await db.aiSystem.findMany({ where, select: sysSelect, orderBy: { reference: 'asc' } });
      return {
        title: 'Registre',
        columns: [
          'Référence',
          'Nom',
          'DEMO',
          'Unité',
          'Propriétaire',
          'Statut',
          'Catégorie AI Act',
          'Rôles AI Act',
          'Valeur',
          'Conformité',
          'Complétude (%)',
          'Prochaine revue',
          'Créé le',
          'Modifié le',
        ],
        rows: rows.map((s) => [
          s.reference,
          s.name,
          s.isDemo ? 'oui' : '',
          s.orgUnit.name,
          s.owner?.displayName ?? '',
          lbl(AI_SYSTEM_STATUS_META, s.status),
          lbl(RISK_CATEGORY_META, s.riskCategory),
          roles(s.aiActRoles),
          lbl(VALUE_LEVEL_META, s.valueLevel),
          lbl(COMPLIANCE_STATUS_META, s.complianceStatus),
          s.completeness,
          dayOf(s.nextReviewDate),
          dayOf(s.createdAt),
          dayOf(s.updatedAt),
        ]),
      };
    },
  },
  {
    key: 'portefeuille-risque',
    title: 'Portefeuille par niveau de risque',
    description: 'Nombre de SIA et références par catégorie AI Act effective.',
    build: async (db, where) => {
      const rows = await db.aiSystem.findMany({
        where,
        select: { reference: true, riskCategory: true },
        orderBy: { reference: 'asc' },
      });
      return {
        title: 'Par niveau de risque',
        columns: ['Catégorie AI Act', 'Nombre de SIA', 'Références'],
        rows: RISK_ROWS.map((r) => {
          const refs = rows.filter((s) => s.riskCategory === r).map((s) => s.reference);
          return [lbl(RISK_CATEGORY_META, r), refs.length, refs.join(', ')];
        }),
      };
    },
  },
  {
    key: 'haut-risque',
    title: 'Systèmes à haut risque',
    description: 'SIA de catégorie « Haut risque » : rôles, conformité, obligations, FRIA.',
    build: async (db, where) => {
      const rows = await db.aiSystem.findMany({
        where: { AND: [where, { riskCategory: 'HIGH' }] },
        select: {
          ...sysSelect,
          obligations: { select: { status: true, applicability: true } },
          frias: { orderBy: { version: 'desc' }, take: 1, select: { status: true, version: true } },
        },
        orderBy: { reference: 'asc' },
      });
      return {
        title: 'Haut risque',
        columns: [
          'Référence',
          'Nom',
          'Unité',
          'Propriétaire',
          'Rôles AI Act',
          'Conformité',
          'Obligations applicables',
          'Obligations conformes',
          'Dernière FRIA',
        ],
        rows: rows.map((s) => {
          const app = s.obligations.filter((o) => o.applicability !== 'NO' && o.status !== 'NOT_APPLICABLE');
          return [
            s.reference,
            s.name,
            s.orgUnit.name,
            s.owner?.displayName ?? '',
            roles(s.aiActRoles),
            lbl(COMPLIANCE_STATUS_META, s.complianceStatus),
            app.length,
            app.filter((o) => o.status === 'COMPLIANT').length,
            s.frias[0] ? `v${s.frias[0].version} ${lbl(WORK_STATUS_META, s.frias[0].status)}` : 'aucune',
          ];
        }),
      };
    },
  },
  {
    key: 'potentiellement-interdits',
    title: 'Systèmes potentiellement interdits',
    description: 'SIA de catégorie « Potentiellement interdit » et règles de l’art. 5 déclenchées.',
    build: async (db, where) => {
      const rows = await db.aiSystem.findMany({
        where: { AND: [where, { riskCategory: 'PROHIBITED' }] },
        select: sysSelect,
        orderBy: { reference: 'asc' },
      });
      const out: Table['rows'] = [];
      for (const s of rows) {
        const q = await currentQualification(db, s);
        out.push([
          s.reference,
          s.name,
          s.orgUnit.name,
          s.owner?.displayName ?? '',
          lbl(AI_SYSTEM_STATUS_META, s.status),
          q ? q.effective.dimensions.prohibited.rules.map((r) => `${r.ruleId} (${r.legalBasis})`).join(', ') : '',
          q
            ? q.effective.dimensions.prohibited.rules.map((r) => r.explanation).join(' ') ||
              q.effective.displayJustification
            : 'Sans qualification enregistrée',
        ]);
      }
      return {
        title: 'Potentiellement interdits',
        columns: ['Référence', 'Nom', 'Unité', 'Propriétaire', 'Statut', 'Règles', 'Justification'],
        rows: out,
      };
    },
  },
  {
    key: 'fria',
    title: 'FRIA',
    description: 'Exigence de FRIA issue de la qualification et état de la dernière version.',
    build: async (db, where) => {
      const rows = await db.aiSystem.findMany({
        where,
        select: { ...sysSelect, frias: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { reference: 'asc' },
      });
      const out: Table['rows'] = [];
      for (const s of rows) {
        const q = await currentQualification(db, s);
        const req = q?.effective.dimensions.fria.value ?? null;
        const f = s.frias[0];
        if (!f && req !== 'REQUIRED' && req !== 'TO_CONFIRM') continue;
        out.push([
          s.reference,
          s.name,
          req ?? 'non qualifié',
          f ? f.version : '',
          f ? lbl(WORK_STATUS_META, f.status) : 'aucune',
          dayOf(f?.validatedAt),
          dayOf(f?.notifiedAuthorityAt),
        ]);
      }
      return {
        title: 'FRIA',
        columns: [
          'Référence',
          'Nom',
          'Exigence (qualification)',
          'Version',
          'Statut',
          'Validée le',
          'Notifiée à l’autorité le',
        ],
        rows: out,
      };
    },
  },
  {
    key: 'conformite-obligations',
    title: 'Conformité par obligation',
    description:
      'Chaque obligation de chaque SIA : base légale, applicabilité, statut, responsable, échéance, preuves.',
    build: async (db, where) => {
      const rows = await db.obligation.findMany({
        where: { aiSystem: where },
        include: { aiSystem: { select: { reference: true, name: true } }, _count: { select: { evidences: true } } },
        orderBy: [{ aiSystem: { reference: 'asc' } }, { templateKey: 'asc' }],
      });
      const names = await namesFor(
        db,
        rows.map((o) => o.responsibleId),
      );
      return {
        title: 'Obligations',
        columns: [
          'SIA',
          'Nom du SIA',
          'Obligation',
          'Base légale',
          'Applicable',
          'Statut',
          'Responsable',
          'Échéance',
          'Preuves',
          'Référentiel',
        ],
        rows: rows.map((o) => [
          o.aiSystem.reference,
          o.aiSystem.name,
          o.title,
          o.legalBasis,
          APPLICABILITY_LABELS[o.applicability],
          lbl(OBLIGATION_STATUS_META, o.status),
          o.responsibleId ? (names.get(o.responsibleId) ?? '') : '',
          dayOf(o.targetDate),
          o._count.evidences,
          o.frameworkVersion,
        ]),
      };
    },
  },
  {
    key: 'risques-ouverts',
    title: 'Risques ouverts',
    description: 'Risques non clos avec cotation inhérente et résiduelle, traitement, propriétaire, échéance.',
    build: async (db, where) => {
      const rows = await db.risk.findMany({
        where: { aiSystem: where, status: { not: 'CLOSED' } },
        include: { aiSystem: { select: { reference: true } }, methodology: true },
        orderBy: [{ residualScore: { sort: 'desc', nulls: 'last' } }, { reference: 'asc' }],
      });
      const names = await namesFor(
        db,
        rows.map((r) => r.ownerId),
      );
      return {
        title: 'Risques ouverts',
        columns: [
          'Risque',
          'SIA',
          'Intitulé',
          'Catégorie',
          'Score inhérent',
          'Score résiduel',
          'Niveau',
          'Traitement',
          'Statut',
          'Propriétaire',
          'Échéance',
          'Méthodologie',
        ],
        rows: rows.map((r) => {
          const cfg = methodologyConfigSchema.safeParse(r.methodology.config);
          const level = cfg.success ? levelOf(cfg.data, r.residualScore ?? r.inherentScore)?.label : '';
          return [
            r.reference,
            r.aiSystem.reference,
            r.title,
            RISK_TYPE_LABELS[r.category as RiskType],
            r.inherentScore,
            r.residualScore,
            level ?? '',
            r.treatment ? RISK_TREATMENT_LABELS[r.treatment] : '',
            lbl(RISK_STATUS_META, r.status),
            r.ownerId ? (names.get(r.ownerId) ?? '') : '',
            dayOf(r.dueDate),
            `${r.methodology.name} v${r.methodology.version}`,
          ];
        }),
      };
    },
  },
  {
    key: 'actions-echues',
    title: 'Actions échues',
    description: 'Actions ouvertes dont l’échéance est dépassée.',
    build: async (db, where) => {
      const rows = await db.action.findMany({
        where: {
          aiSystem: where,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          dueDate: { lt: new Date(`${today()}T00:00:00Z`) },
        },
        include: {
          aiSystem: { select: { reference: true } },
          risk: { select: { reference: true } },
          obligation: { select: { title: true } },
        },
        orderBy: { dueDate: 'asc' },
      });
      const names = await namesFor(
        db,
        rows.map((a) => a.assigneeId),
      );
      return {
        title: 'Actions échues',
        columns: ['Action', 'SIA', 'Intitulé', 'Priorité', 'Responsable', 'Échéance', 'Statut', 'Risque', 'Obligation'],
        rows: rows.map((a) => [
          a.reference,
          a.aiSystem.reference,
          a.title,
          PRIORITY_LABELS[a.priority],
          a.assigneeId ? (names.get(a.assigneeId) ?? '') : '',
          dayOf(a.dueDate),
          lbl(ACTION_STATUS_META, a.status),
          a.risk?.reference ?? '',
          a.obligation?.title ?? '',
        ]),
      };
    },
  },
  {
    key: 'matrice-valeur-risque',
    title: 'Matrice valeur / risque',
    description: 'Nombre de SIA par catégorie AI Act et niveau de valeur ajoutée.',
    build: async (db, where) => {
      const rows = await db.aiSystem.findMany({ where, select: { riskCategory: true, valueLevel: true } });
      return {
        title: 'Matrice valeur-risque',
        columns: ['Catégorie AI Act', ...VALUE_COLS.map((v) => `Valeur ${lbl(VALUE_LEVEL_META, v).toLowerCase()}`)],
        rows: RISK_ROWS.map((r) => [
          lbl(RISK_CATEGORY_META, r),
          ...VALUE_COLS.map((v) => rows.filter((s) => s.riskCategory === r && s.valueLevel === v).length),
        ]),
      };
    },
  },
  {
    key: 'revue-annuelle',
    title: 'Revue annuelle',
    description: 'Dernière et prochaine revue de chaque SIA, revues ouvertes et retards.',
    build: async (db, where) => {
      const rows = await db.aiSystem.findMany({
        where,
        select: {
          ...sysSelect,
          reviews: { where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } }, select: { dueDate: true, kind: true } },
        },
        orderBy: [{ nextReviewDate: { sort: 'asc', nulls: 'first' } }, { reference: 'asc' }],
      });
      const t = today();
      return {
        title: 'Revue annuelle',
        columns: [
          'Référence',
          'Nom',
          'Catégorie AI Act',
          'Propriétaire',
          'Dernière revue',
          'Prochaine revue',
          'En retard',
          'Revues ouvertes',
        ],
        rows: rows.map((s) => [
          s.reference,
          s.name,
          lbl(RISK_CATEGORY_META, s.riskCategory),
          s.owner?.displayName ?? '',
          dayOf(s.lastReviewDate),
          dayOf(s.nextReviewDate),
          (s.nextReviewDate && dayOf(s.nextReviewDate)! < t) || s.reviews.some((r) => dayOf(r.dueDate)! < t)
            ? 'oui'
            : '',
          s.reviews.length,
        ]),
      };
    },
  },
];

/** Fiche SIA en Markdown (export MD / HTML). */
export function systemSheetMarkdown(
  s: SystemRow,
  extra: { assessment: string; obligations: string[]; risks: string[] },
) {
  const v = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : String(x));
  const lines = [
    `# ${s.reference} — ${s.name}${s.isDemo ? ' [DEMO]' : ''}`,
    '',
    `**Statut :** ${lbl(AI_SYSTEM_STATUS_META, s.status)}`,
    `**Unité :** ${s.orgUnit.name}`,
    `**Propriétaire :** ${v(s.owner?.displayName)}`,
    `**Catégorie AI Act :** ${lbl(RISK_CATEGORY_META, s.riskCategory)}`,
    `**Rôles AI Act :** ${v(roles(s.aiActRoles))}`,
    `**Valeur ajoutée :** ${lbl(VALUE_LEVEL_META, s.valueLevel)}`,
    `**Conformité :** ${lbl(COMPLIANCE_STATUS_META, s.complianceStatus)}`,
    `**Complétude :** ${s.completeness} %`,
    '',
    '## Description',
    v(s.description),
    '',
    '## Finalité',
    v(s.purpose),
    '',
    '## Fonctionnement et autonomie',
    `${v(s.functioning)}`,
    `**Autonomie :** ${AUTONOMY_LEVEL_LABELS[s.autonomyLevel]}`,
    '',
    '## Modèles et fournisseurs',
    ...(s.models.length
      ? s.models.map(
          (m) => `- ${m.aiModel.name}${m.aiModel.vendor ? ` (${m.aiModel.vendor.name})` : ''} — ${m.usageDescription}`,
        )
      : ['—']),
    ...s.vendors.map((x) => `- Fournisseur : ${x.vendor.name} (${x.relation})`),
    '',
    '## Données et personnes concernées',
    `**Données personnelles :** ${s.processesPersonalData}`,
    ...(s.dataCategories.length
      ? [`**Catégories :** ${s.dataCategories.map((d) => d.dataCategory.label).join(', ')}`]
      : []),
    ...(s.dataSubjects.length ? [`**Personnes :** ${s.dataSubjects.map((d) => d.dataSubject.label).join(', ')}`] : []),
    '',
    '## Qualification AI Act',
    extra.assessment,
    '',
    '## Obligations',
    ...(extra.obligations.length ? extra.obligations.map((o) => `- ${o}`) : ['—']),
    '',
    '## Risques ouverts',
    ...(extra.risks.length ? extra.risks.map((r) => `- ${r}`) : ['—']),
    '',
    '---',
    `Export Chandelier du ${today()} — version ${s.version} de la fiche.`,
  ];
  return lines.join('\n');
}

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma, config } = app.deps;
  const storage = localStorage(config.STORAGE_DIR);
  const tags = ['Rapports et exports'];

  const formatQuery = z.object({
    format: z.enum(['csv', 'xlsx', 'json']).default('xlsx'),
    demo: z.enum(['include', 'exclude']).default('include'),
  });

  app.get('/reports', { schema: { tags, summary: 'Catalogue des rapports standards' } }, async (request) => {
    requirePermission(request, 'report:read');
    return {
      items: [
        ...REPORTS.map(({ key, title, description }) => ({
          key,
          title,
          description,
          formats: ['xlsx', 'csv', 'json'],
          perSystem: false,
        })),
        {
          key: 'dossier-audit',
          title: 'Dossier d’audit d’un SIA',
          description:
            'Archive ZIP : fiche, qualification, obligations, risques, actions, journal, notice et FRIA validées, pièces justificatives (dernière version) et manifeste SHA-256.',
          formats: ['zip'],
          perSystem: true,
        },
      ],
    };
  });

  app.get(
    '/reports/:key',
    {
      schema: {
        tags,
        summary: 'Générer un rapport (XLSX, CSV ou JSON) sur le périmètre',
        params: z.object({ key: z.string().max(60) }),
        querystring: formatQuery,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'report:read');
      const def = REPORTS.find((r) => r.key === request.params.key);
      if (!def) throw badRequest('Rapport inconnu');
      const where: Prisma.AiSystemWhereInput = {
        AND: [scopeWhere(ctx), { archivedAt: null }, ...(request.query.demo === 'exclude' ? [{ isDemo: false }] : [])],
      };
      const table = await def.build(prisma, where);
      await prisma.$transaction((tx) =>
        recordAudit(tx, actorOf(request), {
          action: 'report',
          entityType: 'Report',
          changes: {
            report: { old: null, new: def.key },
            format: { old: null, new: request.query.format },
            rows: { old: null, new: table.rows.length },
          },
        }),
      );
      const base = `chandelier-${def.key}-${today()}`;
      if (request.query.format === 'json')
        return {
          report: def.key,
          title: def.title,
          generatedAt: new Date().toISOString(),
          columns: table.columns,
          rows: table.rows,
        };
      const isCsv = request.query.format === 'csv';
      return reply
        .header(
          'Content-Type',
          isCsv ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header('Content-Disposition', `attachment; filename="${base}.${isCsv ? 'csv' : 'xlsx'}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .send(isCsv ? toCsv(table) : toXlsx([table]));
    },
  );

  async function sheetData(db: Db, s: SystemRow) {
    const q = await currentQualification(db, s);
    const assessment = q
      ? [
          `Catégorie effective : ${lbl(RISK_CATEGORY_META, q.effective.displayCategory)}`,
          ...Object.entries(q.effective.dimensions).map(
            ([k, d]) =>
              `- ${k} : ${d.values.length > 1 ? d.values.join(', ') : d.value} — règles ${d.rules.map((r) => r.ruleId).join(', ') || '—'}`,
          ),
          q.effective.displayJustification,
          `Référentiel ${q.effective.frameworkVersion}.`,
        ].join('\n')
      : 'Aucune qualification enregistrée.';
    const obligations = await db.obligation.findMany({ where: { aiSystemId: s.id }, orderBy: { templateKey: 'asc' } });
    const risks = await db.risk.findMany({
      where: { aiSystemId: s.id, status: { not: 'CLOSED' } },
      orderBy: { reference: 'asc' },
    });
    return {
      q,
      obligations,
      risks,
      md: systemSheetMarkdown(s, {
        assessment,
        obligations: obligations.map(
          (o) =>
            `${o.title} (${o.legalBasis}) — ${APPLICABILITY_LABELS[o.applicability]}, ${lbl(OBLIGATION_STATUS_META, o.status)}`,
        ),
        risks: risks.map(
          (r) =>
            `${r.reference} ${r.title} — score inhérent ${r.inherentScore ?? '—'}, résiduel ${r.residualScore ?? '—'}`,
        ),
      }),
    };
  }

  app.get(
    '/ai-systems/:sid/sheet',
    {
      schema: {
        tags,
        summary: 'Fiche SIA (Markdown ou HTML échappé) — PDF / DOCX non implémentés',
        params: z.object({ sid: z.uuid() }),
        querystring: z.object({ format: z.enum(['md', 'html']).default('md') }),
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:export');
      const { system } = await loadVisible(prisma, ctx, request.params.sid);
      const { md } = await sheetData(prisma, system);
      await prisma.$transaction((tx) =>
        recordAudit(tx, actorOf(request), {
          action: 'export',
          entityType: 'AiSystem',
          entityId: system.id,
          aiSystemId: system.id,
          changes: { format: { old: null, new: `fiche ${request.query.format}` } },
        }),
      );
      const html = request.query.format === 'html';
      return reply
        .header('Content-Type', html ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="fiche-${system.reference}.${html ? 'html' : 'md'}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(html ? markdownToHtml(md, `${system.reference} — ${system.name}`) : md);
    },
  );

  app.get(
    '/ai-systems/:sid/audit-dossier',
    {
      schema: {
        tags,
        summary: 'Dossier d’audit ZIP (aiSystem:export + audit:read sur le SIA)',
        params: z.object({ sid: z.uuid() }),
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:export');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      if (!can(ctx as AccessContext, 'audit:read', targetOf(system, sections)))
        throw forbidden('Le dossier d’audit (journal et pièces) requiert le droit de consultation du journal d’audit');
      const full = await prisma.aiSystem.findUniqueOrThrow({ where: { id: system.id }, include: systemInclude });
      const { q, obligations, risks, md } = await sheetData(prisma, full);
      const [actions, events, notice, fria, docs] = await Promise.all([
        prisma.action.findMany({ where: { aiSystemId: system.id }, orderBy: { reference: 'asc' } }),
        prisma.auditEvent.findMany({ where: { aiSystemId: system.id }, orderBy: { occurredAt: 'asc' }, take: 20_000 }),
        prisma.transparencyNotice.findFirst({
          where: { aiSystemId: system.id, status: 'VALIDATED' },
          orderBy: { version: 'desc' },
        }),
        prisma.fria.findFirst({
          where: { aiSystemId: system.id, status: 'VALIDATED' },
          orderBy: { version: 'desc' },
          include: { dpia: true },
        }),
        prisma.document.findMany({
          where: { aiSystemId: system.id, archivedAt: null },
          include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
        }),
      ]);
      const entries: ZipEntry[] = [
        { name: 'fiche.md', data: md },
        { name: 'qualification.json', data: JSON.stringify(q ?? null, null, 2) },
        {
          name: 'obligations.csv',
          data: toCsv({
            title: 'Obligations',
            columns: ['Obligation', 'Base légale', 'Applicable', 'Statut', 'Échéance', 'Commentaire'],
            rows: obligations.map((o) => [
              o.title,
              o.legalBasis,
              APPLICABILITY_LABELS[o.applicability],
              lbl(OBLIGATION_STATUS_META, o.status),
              dayOf(o.targetDate),
              o.comment,
            ]),
          }),
        },
        {
          name: 'risques-ouverts.csv',
          data: toCsv({
            title: 'Risques',
            columns: ['Risque', 'Intitulé', 'Inhérent', 'Résiduel', 'Statut'],
            rows: risks.map((r) => [
              r.reference,
              r.title,
              r.inherentScore,
              r.residualScore,
              lbl(RISK_STATUS_META, r.status),
            ]),
          }),
        },
        {
          name: 'actions.csv',
          data: toCsv({
            title: 'Actions',
            columns: ['Action', 'Intitulé', 'Statut', 'Échéance'],
            rows: actions.map((a) => [a.reference, a.title, lbl(ACTION_STATUS_META, a.status), dayOf(a.dueDate)]),
          }),
        },
        {
          name: 'journal.csv',
          data: toCsv({
            title: 'Journal',
            columns: ['Date', 'Auteur', 'Origine', 'Action', 'Objet', 'Modifications', 'Motif'],
            rows: events.map((e) => [
              e.occurredAt.toISOString(),
              e.actorLabel,
              e.origin,
              e.action,
              e.entityType,
              JSON.stringify(e.changes ?? {}),
              e.justification ?? '',
            ]),
          }),
        },
      ];
      if (notice) entries.push({ name: `notice-transparence-v${notice.version}.md`, data: notice.contentMarkdown });
      if (fria) {
        const sec = (fria.sections ?? {}) as Record<string, string>;
        entries.push({
          name: `fria-v${fria.version}.md`,
          data: [
            `# FRIA v${fria.version} — ${system.reference}`,
            ...FRIA_SECTIONS.flatMap((s) => [
              '',
              `## ${s.label} (${s.ref})`,
              fria.coveredByDpia.includes(s.key) && fria.dpia
                ? `Traité dans la DPIA ${fria.dpia.reference} — ${fria.dpia.title}`
                : (sec[s.key] ?? ''),
            ]),
            '',
            '## Conclusion',
            fria.conclusion,
            '',
            `Validée le ${dayOf(fria.validatedAt)}.`,
          ].join('\n'),
        });
      }
      const manifest: string[] = [];
      const used = new Set<string>();
      for (const d of docs) {
        const v = d.versions[0];
        if (!v || v.scanStatus === 'INFECTED') continue;
        try {
          const chunks: Buffer[] = [];
          for await (const c of await storage.open(v.storageKey)) chunks.push(c as Buffer);
          let name = `pieces/${v.fileName}`;
          for (let i = 2; used.has(name); i++) name = `pieces/${i}-${v.fileName}`;
          used.add(name);
          entries.push({ name, data: Buffer.concat(chunks) });
          manifest.push(`${v.sha256}  ${name}  (${d.title}, v${v.versionNo})`);
        } catch {
          manifest.push(
            `ABSENT  pieces/${v.fileName}  (${d.title}, v${v.versionNo}) — fichier introuvable dans le stockage`,
          );
        }
      }
      entries.push({
        name: 'MANIFESTE.txt',
        data: `Dossier d’audit ${system.reference} — généré le ${new Date().toISOString()}\nPièces (SHA-256 enregistré au dépôt) :\n${manifest.join('\n') || '(aucune)'}\n`,
      });
      await prisma.$transaction((tx) =>
        recordAudit(tx, actorOf(request), {
          action: 'export',
          entityType: 'AiSystem',
          entityId: system.id,
          aiSystemId: system.id,
          changes: { format: { old: null, new: 'dossier d’audit ZIP' }, files: { old: null, new: entries.length } },
        }),
      );
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="dossier-audit-${system.reference}-${today()}.zip"`)
        .send(zip(entries));
    },
  );
};
