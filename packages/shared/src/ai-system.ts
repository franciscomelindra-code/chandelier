import { z } from 'zod';
import { AI_SYSTEM_STATUSES, RISK_CATEGORIES, type EnumMeta } from './labels.js';

export const AI_ACT_ROLES = [
  'PROVIDER',
  'DEPLOYER',
  'IMPORTER',
  'DISTRIBUTOR',
  'AUTHORISED_REPRESENTATIVE',
  'PRODUCT_MANUFACTURER',
  'OTHER',
] as const;
export type AiActRole = (typeof AI_ACT_ROLES)[number];
export const AI_ACT_ROLE_LABELS: Record<AiActRole, string> = {
  PROVIDER: 'Fournisseur',
  DEPLOYER: 'Déployeur',
  IMPORTER: 'Importateur',
  DISTRIBUTOR: 'Distributeur',
  AUTHORISED_REPRESENTATIVE: 'Mandataire',
  PRODUCT_MANUFACTURER: 'Fabricant de produit',
  OTHER: 'Autre',
};

export const VALUE_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const;
export type ValueLevel = (typeof VALUE_LEVELS)[number];
export const VALUE_LEVEL_META: Record<ValueLevel, EnumMeta> = {
  LOW: { label: 'Faible', tone: 'gray' },
  MEDIUM: { label: 'Moyenne', tone: 'blue' },
  HIGH: { label: 'Élevée', tone: 'green' },
  UNKNOWN: { label: 'Non évaluée', tone: 'gray' },
};

export const COMPLIANCE_STATUSES = ['NOT_ASSESSED', 'NON_COMPLIANT', 'PARTIAL', 'COMPLIANT'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];
export const COMPLIANCE_STATUS_META: Record<ComplianceStatus, EnumMeta> = {
  NOT_ASSESSED: { label: 'Non évaluée', tone: 'gray' },
  NON_COMPLIANT: { label: 'Non conforme', tone: 'red' },
  PARTIAL: { label: 'Partielle', tone: 'yellow' },
  COMPLIANT: { label: 'Conforme', tone: 'green' },
};

export const AUTONOMY_LEVELS = [
  'ASSISTIVE',
  'HUMAN_IN_THE_LOOP',
  'HUMAN_ON_THE_LOOP',
  'AUTONOMOUS',
  'UNKNOWN',
] as const;
export const AUTONOMY_LEVEL_LABELS: Record<(typeof AUTONOMY_LEVELS)[number], string> = {
  ASSISTIVE: 'Aide (l’humain décide)',
  HUMAN_IN_THE_LOOP: 'Humain dans la boucle',
  HUMAN_ON_THE_LOOP: 'Humain en supervision',
  AUTONOMOUS: 'Autonome',
  UNKNOWN: 'Non renseigné',
};

/** Statuts saisissables directement (ARCHIVED passe exclusivement par l'archivage motivé). */
export const EDITABLE_STATUSES = AI_SYSTEM_STATUSES.filter((s) => s !== 'ARCHIVED');

/**
 * Sections de la fiche (wizard 12 étapes, S3). Sert à l'affectation des contributeurs
 * et au contrôle "aiSystem:update:assigned" champ par champ.
 */
export const SECTIONS = [
  'general',
  'responsibility',
  'models',
  'stakeholders',
  'assets',
  'processing',
  'data',
  'subjects',
  'classification',
  'value',
  'documentation',
  'summary',
] as const;
export type SectionKey = (typeof SECTIONS)[number];

export const FIELD_SECTION: Record<string, SectionKey> = {
  name: 'general',
  description: 'general',
  purpose: 'general',
  objectives: 'general',
  useCases: 'general',
  functioning: 'general',
  scope: 'general',
  operationalContext: 'general',
  countries: 'general',
  targetPopulations: 'general',
  status: 'general',
  orgUnitId: 'general',
  firstDeploymentDate: 'general',
  productionDate: 'general',
  plannedRetirementDate: 'general',
  actualRetirementDate: 'general',
  nextReviewDate: 'general',
  autonomyLevel: 'general',
  tagIds: 'general',
  ownerId: 'responsibility',
  businessOwnerId: 'responsibility',
  aiActRoles: 'responsibility',
  raciEnabled: 'responsibility',
  processesPersonalData: 'subjects',
  includesMinors: 'subjects',
  includesVulnerable: 'subjects',
  affectedVolumeEstimate: 'subjects',
  potentialConsequences: 'subjects',
  valueLevel: 'value',
  valueJustification: 'value',
  valueDetails: 'value',
};

// ── Schémas de saisie ────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.iso.date().nullable();
const uuid = z.uuid();
const triState = z.enum(['YES', 'NO', 'UNKNOWN']);

export const aiSystemCreateSchema = z.strictObject({
  name: text(200).min(3, '3 caractères minimum'),
  reference: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Majuscules, chiffres, - et _ uniquement')
    .optional(),
  orgUnitId: uuid,
  purpose: text(4000).default(''),
  description: text(8000).default(''),
  ownerId: uuid.nullable().optional(),
  businessOwnerId: uuid.nullable().optional(),
  /** Création à partir d'un gabarit interne (CDC §5.3, mode 2). */
  templateId: uuid.optional(),
});

export const aiSystemUpdateSchema = z.strictObject({
  /** Verrou optimiste : version lue par le client. */
  version: z.number().int().min(1),
  name: text(200).min(3).optional(),
  description: text(8000).optional(),
  purpose: text(4000).optional(),
  objectives: text(4000).optional(),
  useCases: text(4000).optional(),
  functioning: text(8000).optional(),
  scope: text(4000).optional(),
  operationalContext: text(4000).optional(),
  countries: z.array(z.string().trim().length(2).toUpperCase()).max(60).optional(),
  targetPopulations: text(2000).optional(),
  status: z.enum(EDITABLE_STATUSES as [string, ...string[]]).optional(),
  autonomyLevel: z.enum(AUTONOMY_LEVELS).optional(),
  orgUnitId: uuid.optional(),
  ownerId: uuid.nullable().optional(),
  businessOwnerId: uuid.nullable().optional(),
  aiActRoles: z.array(z.enum(AI_ACT_ROLES)).max(7).optional(),
  firstDeploymentDate: isoDate.optional(),
  productionDate: isoDate.optional(),
  plannedRetirementDate: isoDate.optional(),
  actualRetirementDate: isoDate.optional(),
  nextReviewDate: isoDate.optional(),
  processesPersonalData: triState.optional(),
  includesMinors: triState.optional(),
  includesVulnerable: triState.optional(),
  affectedVolumeEstimate: text(500).optional(),
  potentialConsequences: text(4000).optional(),
  valueLevel: z.enum(VALUE_LEVELS).optional(),
  valueJustification: text(4000).optional(),
  valueDetails: z
    .strictObject({
      benefits: text(4000),
      kpis: text(2000),
      estimatedGains: text(2000),
      quality: text(2000),
      productivity: text(2000),
      experience: text(2000),
      safety: text(2000),
      avoidedCosts: text(2000),
    })
    .partial()
    .optional(),
  raciEnabled: z.boolean().optional(),
  tagIds: z.array(uuid).max(50).optional(),
});

export const archiveSchema = z.strictObject({
  reason: z.string().trim().min(10, 'Justification de 10 caractères minimum').max(2000),
});

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const parts = v.split(',').filter(Boolean);
      for (const p of parts) {
        if (!(values as readonly string[]).includes(p)) {
          ctx.addIssue({ code: 'custom', message: `Valeur inconnue : ${p}` });
          return z.NEVER;
        }
      }
      return parts as T[];
    });

export const AI_SYSTEM_SORT_FIELDS = [
  'reference',
  'name',
  'status',
  'riskCategory',
  'valueLevel',
  'completeness',
  'nextReviewDate',
  'updatedAt',
  'createdAt',
] as const;

export const aiSystemListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csv(AI_SYSTEM_STATUSES),
  risk: csv(RISK_CATEGORIES),
  value: csv(VALUE_LEVELS),
  role: csv(AI_ACT_ROLES),
  compliance: csv(COMPLIANCE_STATUSES),
  orgUnitId: uuid.optional(),
  ownerId: uuid.optional(),
  tagId: uuid.optional(),
  vendorId: uuid.optional(),
  modelId: uuid.optional(),
  personalData: triState.optional(),
  reviewBefore: z.iso.date().optional(),
  /** Filtres ouverts par le tableau de bord (S8). */
  completenessMax: z.coerce.number().int().min(0).max(100).optional(),
  noOwner: z.enum(['true']).optional(),
  qualified: z.enum(['yes', 'no']).optional(),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
  archived: z.enum(['exclude', 'only', 'include']).default('exclude'),
  demo: z.enum(['include', 'exclude', 'only']).default('include'),
  sort: z.enum(AI_SYSTEM_SORT_FIELDS).default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type AiSystemListQuery = z.infer<typeof aiSystemListQuerySchema>;

export const BULK_ACTIONS = [
  'assignOwner',
  'setOrgUnit',
  'setStatus',
  'addTags',
  'removeTags',
  'startReview',
  'archive',
] as const;
export const bulkSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('assignOwner'), ids: z.array(uuid).min(1).max(200), ownerId: uuid }),
  z.strictObject({ action: z.literal('setOrgUnit'), ids: z.array(uuid).min(1).max(200), orgUnitId: uuid }),
  z.strictObject({
    action: z.literal('setStatus'),
    ids: z.array(uuid).min(1).max(200),
    status: z.enum(EDITABLE_STATUSES as [string, ...string[]]),
  }),
  z.strictObject({ action: z.literal('addTags'), ids: z.array(uuid).min(1).max(200), tagIds: z.array(uuid).min(1) }),
  z.strictObject({ action: z.literal('removeTags'), ids: z.array(uuid).min(1).max(200), tagIds: z.array(uuid).min(1) }),
  z.strictObject({
    action: z.literal('archive'),
    ids: z.array(uuid).min(1).max(200),
    reason: z.string().trim().min(10).max(2000),
  }),
  /** Lancer une revue périodique (S7) : review:manage requis sur chaque SIA. */
  z.strictObject({
    action: z.literal('startReview'),
    ids: z.array(uuid).min(1).max(200),
    dueDate: z.iso.date(),
    reviewerId: uuid.nullable().default(null),
  }),
]);
export type BulkInput = z.infer<typeof bulkSchema>;

export const tagCreateSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

export const savedViewSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['ai-systems']),
  /** Paramètres d'URL de la liste (filtres, tri) + colonnes + disposition. */
  state: z.strictObject({
    query: z.string().max(2000),
    columns: z.array(z.string().max(40)).max(30),
    layout: z.enum(['table', 'cards']),
  }),
  isShared: z.boolean().default(false),
});

// ── Complétude ───────────────────────────────────────────────────────────────

export interface CompletenessInput {
  name: string;
  description: string;
  purpose: string;
  useCases: string;
  functioning: string;
  operationalContext: string;
  status: string;
  ownerId: string | null;
  businessOwnerId: string | null;
  aiActRoles: string[];
  autonomyLevel: string;
  countries: string[];
  processesPersonalData: string;
  valueLevel: string;
  valueJustification: string;
  nextReviewDate: Date | string | null;
  productionDate: Date | string | null;
  firstDeploymentDate: Date | string | null;
  valueDetails?: unknown;
  /** Liens des sections relationnelles (S3) ; absent = critères non évalués. */
  relations?: CompletenessRelations;
}

export interface CompletenessRelations {
  functions: string[];
  models: number;
  stakeholders: number;
  assets: number;
  processing: number;
  datasets: number;
  dataCategories: number;
  dataSubjects: number;
}

export interface CompletenessCheck {
  key: string;
  label: string;
  section: SectionKey;
  ok: boolean;
}

const filled = (s: string | null | undefined, min = 1) => !!s && s.trim().length >= min;

/**
 * Contrôle de complétude du registre (critères S2, étendus en S3 aux 12 sections).
 * Chaque critère est explicite et affiché : aucun score opaque.
 */
export function computeCompleteness(s: CompletenessInput): { percent: number; checks: CompletenessCheck[] } {
  const deployed = ['PILOT', 'ACTIVE', 'SUSPENDED', 'RETIRED'].includes(s.status);
  const checks: CompletenessCheck[] = [
    {
      key: 'description',
      label: 'Description (20 caractères min.)',
      section: 'general',
      ok: filled(s.description, 20),
    },
    { key: 'purpose', label: 'Finalité', section: 'general', ok: filled(s.purpose, 10) },
    { key: 'useCases', label: 'Cas d’usage', section: 'general', ok: filled(s.useCases) },
    { key: 'functioning', label: 'Fonctionnement', section: 'general', ok: filled(s.functioning) },
    { key: 'operationalContext', label: 'Contexte opérationnel', section: 'general', ok: filled(s.operationalContext) },
    { key: 'countries', label: 'Pays concernés', section: 'general', ok: s.countries.length > 0 },
    { key: 'autonomyLevel', label: 'Niveau d’autonomie', section: 'general', ok: s.autonomyLevel !== 'UNKNOWN' },
    { key: 'nextReviewDate', label: 'Prochaine revue planifiée', section: 'general', ok: !!s.nextReviewDate },
    ...(deployed
      ? [
          {
            key: 'deploymentDate',
            label: 'Date de premier déploiement ou de mise en production',
            section: 'general' as const,
            ok: !!s.firstDeploymentDate || !!s.productionDate,
          },
        ]
      : []),
    { key: 'ownerId', label: 'Propriétaire', section: 'responsibility', ok: !!s.ownerId },
    { key: 'businessOwnerId', label: 'Responsable métier', section: 'responsibility', ok: !!s.businessOwnerId },
    {
      key: 'aiActRoles',
      label: 'Rôle(s) AI Act de l’organisation',
      section: 'responsibility',
      ok: s.aiActRoles.length > 0,
    },
    {
      key: 'processesPersonalData',
      label: 'Traitement de données personnelles (oui/non)',
      section: 'subjects',
      ok: s.processesPersonalData !== 'UNKNOWN',
    },
    { key: 'valueLevel', label: 'Niveau de valeur ajoutée', section: 'value', ok: s.valueLevel !== 'UNKNOWN' },
    {
      key: 'valueJustification',
      label: 'Justification de la valeur',
      section: 'value',
      ok: filled(s.valueJustification, 10),
    },
  ];
  // Critères des sections relationnelles (S3) : évalués seulement quand les liens sont fournis.
  const r = s.relations;
  if (r) {
    const personal = s.processesPersonalData === 'YES';
    const benefits = (s.valueDetails as { benefits?: string } | null | undefined)?.benefits;
    checks.push(
      {
        key: 'dpoLegal',
        label: 'Interlocuteur DPO / Juridique désigné',
        section: 'responsibility',
        ok: r.functions.includes('DPO_LEGAL'),
      },
      { key: 'itLead', label: 'Référent DSI désigné', section: 'responsibility', ok: r.functions.includes('IT_LEAD') },
      {
        key: 'models',
        label: 'Au moins un modèle d’IA lié (avec description de l’usage)',
        section: 'models',
        ok: r.models > 0,
      },
      { key: 'stakeholders', label: 'Au moins une partie prenante', section: 'stakeholders', ok: r.stakeholders > 0 },
      { key: 'assets', label: 'Au moins un actif / dépendance', section: 'assets', ok: r.assets > 0 },
      {
        key: 'processing',
        label: personal
          ? 'Traitement(s) RGPD lié(s) (données personnelles déclarées)'
          : 'Traitements RGPD : sans objet tant qu’aucune donnée personnelle n’est déclarée',
        section: 'processing',
        ok: personal ? r.processing > 0 : s.processesPersonalData === 'NO',
      },
      { key: 'datasets', label: 'Au moins une source de données (dataset)', section: 'data', ok: r.datasets > 0 },
      {
        key: 'dataCategories',
        label: 'Catégories de données personnelles',
        section: 'data',
        ok: personal ? r.dataCategories > 0 : s.processesPersonalData === 'NO',
      },
      {
        key: 'dataSubjects',
        label: 'Catégories de personnes concernées',
        section: 'subjects',
        ok: personal ? r.dataSubjects > 0 : s.processesPersonalData === 'NO',
      },
      { key: 'benefits', label: 'Bénéfices attendus décrits', section: 'value', ok: filled(benefits, 10) },
    );
  }
  const percent = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { percent, checks };
}

/** En-têtes d'export compatibles avec le format d'échange du cahier des charges (§5.12). */
export const COMPAT_EXPORT_HEADERS = [
  'Label',
  'Ref',
  'Description',
  'State',
  'RiskLevel',
  'RiskLevelJustification',
  'BenefitLevel',
  'BenefitLevelJustification',
  'DateArchived',
  'DateCreation',
  'DateUpdate',
  'DateDeployment',
  'DateRetirement',
  'TransparencyNoticeDone',
  'TransparencyNoticeHtml',
] as const;
