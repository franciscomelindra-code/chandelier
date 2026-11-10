import { z } from 'zod';
import type { EnumMeta, Tone } from './labels.js';
import { PRIORITIES } from './catalog.js';

/** Registre des risques SIA (CDC §5.9), mesures et plans d'action. */

export const RISK_TYPES = [
  'FUNDAMENTAL_RIGHTS',
  'PRIVACY',
  'BIAS_DISCRIMINATION',
  'SECURITY',
  'HALLUCINATION_ACCURACY',
  'CONFIDENTIALITY',
  'INTELLECTUAL_PROPERTY',
  'VENDOR_DEPENDENCY',
  'TRANSPARENCY',
  'HUMAN_OVERSIGHT',
  'ROBUSTNESS',
  'REPUTATION',
  'BUSINESS_CONTINUITY',
] as const;
export type RiskType = (typeof RISK_TYPES)[number];
export const RISK_TYPE_LABELS: Record<RiskType, string> = {
  FUNDAMENTAL_RIGHTS: 'Droits fondamentaux',
  PRIVACY: 'Vie privée',
  BIAS_DISCRIMINATION: 'Discrimination / biais',
  SECURITY: 'Sécurité / cybersécurité',
  HALLUCINATION_ACCURACY: 'Hallucination / inexactitude',
  CONFIDENTIALITY: 'Confidentialité',
  INTELLECTUAL_PROPERTY: 'Propriété intellectuelle',
  VENDOR_DEPENDENCY: 'Dépendance fournisseur',
  TRANSPARENCY: 'Transparence',
  HUMAN_OVERSIGHT: 'Surveillance humaine',
  ROBUSTNESS: 'Robustesse',
  REPUTATION: 'Réputation',
  BUSINESS_CONTINUITY: 'Métier / continuité',
};

export const RISK_STATUSES = ['IDENTIFIED', 'ASSESSED', 'IN_TREATMENT', 'ACCEPTED', 'CLOSED'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const RISK_STATUS_META: Record<RiskStatus, EnumMeta> = {
  IDENTIFIED: { label: 'Identifié', tone: 'gray' },
  ASSESSED: { label: 'Évalué', tone: 'blue' },
  IN_TREATMENT: { label: 'En traitement', tone: 'yellow' },
  ACCEPTED: { label: 'Accepté', tone: 'orange' },
  CLOSED: { label: 'Clos', tone: 'green' },
};

export const RISK_TREATMENTS = ['REDUCE', 'ACCEPT', 'TRANSFER', 'AVOID'] as const;
export type RiskTreatment = (typeof RISK_TREATMENTS)[number];
export const RISK_TREATMENT_LABELS: Record<RiskTreatment, string> = {
  REDUCE: 'Réduire',
  ACCEPT: 'Accepter',
  TRANSFER: 'Transférer',
  AVOID: 'Éviter (renoncer à l’usage)',
};

export const MEASURE_TYPES = ['PREVENTIVE', 'DETECTIVE', 'CORRECTIVE', 'ORGANISATIONAL', 'TECHNICAL'] as const;
export const MEASURE_TYPE_LABELS: Record<(typeof MEASURE_TYPES)[number], string> = {
  PREVENTIVE: 'Préventive',
  DETECTIVE: 'Détective',
  CORRECTIVE: 'Corrective',
  ORGANISATIONAL: 'Organisationnelle',
  TECHNICAL: 'Technique',
};
export const MEASURE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'ABANDONED'] as const;
export type MeasureStatus = (typeof MEASURE_STATUSES)[number];
export const MEASURE_STATUS_META: Record<MeasureStatus, EnumMeta> = {
  PLANNED: { label: 'Planifiée', tone: 'gray' },
  IN_PROGRESS: { label: 'En cours', tone: 'yellow' },
  IMPLEMENTED: { label: 'En place', tone: 'green' },
  VERIFIED: { label: 'En place et vérifiée', tone: 'green' },
  ABANDONED: { label: 'Abandonnée', tone: 'gray' },
};
/** Une mesure « existante » (prise en compte dans le risque résiduel) est en place ou vérifiée. */
export const isExistingMeasure = (status: string) => status === 'IMPLEMENTED' || status === 'VERIFIED';

export const ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS_META: Record<ActionStatus, EnumMeta> = {
  OPEN: { label: 'À faire', tone: 'gray' },
  IN_PROGRESS: { label: 'En cours', tone: 'yellow' },
  DONE: { label: 'Terminée', tone: 'green' },
  CANCELLED: { label: 'Annulée', tone: 'gray' },
};
export const isOpenAction = (status: string) => status === 'OPEN' || status === 'IN_PROGRESS';
/** Échue : ouverte et échéance strictement passée (date du jour au format AAAA-MM-JJ). */
export const isOverdue = (status: string, dueDate: string | null, today: string) =>
  isOpenAction(status) && !!dueDate && dueDate < today;

// ───────────── Méthodologie de cotation ─────────────

const TONES = ['green', 'yellow', 'orange', 'red'] as const satisfies readonly Tone[];

const scaleSchema = z
  .array(
    z.strictObject({
      value: z.int().min(1).max(10),
      label: z.string().trim().min(1).max(60),
      description: z.string().trim().max(400).optional(),
    }),
  )
  .min(2, 'Au moins 2 niveaux')
  .max(10, 'Au plus 10 niveaux');

export const methodologyConfigSchema = z
  .strictObject({
    likelihood: scaleSchema,
    severity: scaleSchema,
    thresholds: z
      .array(
        z.strictObject({
          min: z.int().min(1),
          level: z.string().regex(/^[A-Z_]{2,30}$/, 'Code en majuscules'),
          label: z.string().trim().min(1).max(40),
          tone: z.enum(TONES),
        }),
      )
      .min(2, 'Au moins 2 seuils')
      .max(6, 'Au plus 6 seuils'),
  })
  .superRefine((c, ctx) => {
    for (const axis of ['likelihood', 'severity'] as const) {
      c[axis].forEach((l, i) => {
        if (l.value !== i + 1)
          ctx.addIssue({ code: 'custom', path: [axis, i, 'value'], message: 'Valeurs attendues : 1, 2, 3… sans trou' });
      });
    }
    const max = c.likelihood.length * c.severity.length;
    if (c.thresholds[0]?.min !== 1)
      ctx.addIssue({ code: 'custom', path: ['thresholds', 0, 'min'], message: 'Le premier seuil doit commencer à 1' });
    c.thresholds.forEach((t, i) => {
      if (i > 0 && t.min <= c.thresholds[i - 1]!.min)
        ctx.addIssue({ code: 'custom', path: ['thresholds', i, 'min'], message: 'Seuils strictement croissants' });
      if (t.min > max)
        ctx.addIssue({
          code: 'custom',
          path: ['thresholds', i, 'min'],
          message: `Seuil supérieur au score maximal (${max})`,
        });
    });
    const levels = c.thresholds.map((t) => t.level);
    if (new Set(levels).size !== levels.length)
      ctx.addIssue({ code: 'custom', path: ['thresholds'], message: 'Codes de niveau en double' });
  });
export type MethodologyConfig = z.infer<typeof methodologyConfigSchema>;

export const methodologyCreateSchema = z.strictObject({
  name: z.string().trim().min(3).max(120),
  config: methodologyConfigSchema,
});

/** Score = vraisemblance × gravité (méthode multiplicative, documentée dans docs/RISK_METHOD.md). */
export function scoreOf(cfg: MethodologyConfig, likelihood: number, severity: number): number {
  if (!cfg.likelihood.some((l) => l.value === likelihood)) throw new RangeError('Vraisemblance hors échelle');
  if (!cfg.severity.some((l) => l.value === severity)) throw new RangeError('Gravité hors échelle');
  return likelihood * severity;
}

export interface RiskLevel {
  level: string;
  label: string;
  tone: Tone;
}
export function levelOf(cfg: MethodologyConfig, score: number | null | undefined): RiskLevel | null {
  if (score == null) return null;
  let found: MethodologyConfig['thresholds'][number] | undefined;
  for (const t of cfg.thresholds) if (score >= t.min) found = t;
  return found ? { level: found.level, label: found.label, tone: found.tone } : null;
}
/** Niveau le plus élevé de la méthodologie (acceptation réservée aux rôles de validation). */
export const topLevel = (cfg: MethodologyConfig) => cfg.thresholds[cfg.thresholds.length - 1]!.level;

export interface ScoredRisk {
  inherentLikelihood: number | null;
  inherentSeverity: number | null;
  residualLikelihood: number | null;
  residualSeverity: number | null;
}

/** Contrôles de cohérence de la cotation ; retournent des messages (erreurs bloquantes). */
export function scoringErrors(cfg: MethodologyConfig, r: ScoredRisk): string[] {
  const errors: string[] = [];
  const inScale = (axis: 'likelihood' | 'severity', v: number | null) =>
    v == null || cfg[axis].some((l) => l.value === v);
  if (!inScale('likelihood', r.inherentLikelihood) || !inScale('likelihood', r.residualLikelihood))
    errors.push('Vraisemblance hors de l’échelle de la méthodologie');
  if (!inScale('severity', r.inherentSeverity) || !inScale('severity', r.residualSeverity))
    errors.push('Gravité hors de l’échelle de la méthodologie');
  if ((r.inherentLikelihood == null) !== (r.inherentSeverity == null))
    errors.push('Risque inhérent : renseignez vraisemblance et gravité');
  if ((r.residualLikelihood == null) !== (r.residualSeverity == null))
    errors.push('Risque résiduel : renseignez vraisemblance et gravité');
  if (r.residualLikelihood != null && r.inherentLikelihood == null)
    errors.push('Le risque résiduel suppose un risque inhérent coté');
  if (
    r.residualLikelihood != null &&
    r.inherentLikelihood != null &&
    (r.residualLikelihood > r.inherentLikelihood || r.residualSeverity! > r.inherentSeverity!)
  )
    errors.push('Le risque résiduel ne peut pas dépasser le risque inhérent (vraisemblance et gravité)');
  return errors;
}

/** Avertissements non bloquants, recalculés à chaque lecture. */
export const RISK_WARNINGS = {
  RESIDUAL_WITHOUT_MEASURE: 'Résiduel inférieur à l’inhérent sans mesure en place : réduction non justifiée',
  NOT_SCORED: 'Risque non coté',
  NO_OWNER: 'Aucun propriétaire',
  TREATMENT_MISSING: 'Risque coté sans décision de traitement',
  OVERDUE: 'Échéance de traitement dépassée',
  REPLACED_METHODOLOGY: 'Coté avec une méthodologie remplacée : à recoter',
} as const;
export type RiskWarning = keyof typeof RISK_WARNINGS;

export function riskWarnings(
  r: ScoredRisk & {
    ownerId: string | null;
    treatment: string | null;
    status: string;
    dueDate: string | null;
    existingMeasures: number;
    methodologyActive: boolean;
  },
  today: string,
): RiskWarning[] {
  const w: RiskWarning[] = [];
  if (r.status === 'CLOSED') return w;
  if (r.inherentLikelihood == null) w.push('NOT_SCORED');
  if (
    r.residualLikelihood != null &&
    r.inherentLikelihood != null &&
    r.residualLikelihood * r.residualSeverity! < r.inherentLikelihood * r.inherentSeverity! &&
    r.existingMeasures === 0
  )
    w.push('RESIDUAL_WITHOUT_MEASURE');
  if (!r.ownerId) w.push('NO_OWNER');
  if (r.inherentLikelihood != null && !r.treatment) w.push('TREATMENT_MISSING');
  if (r.dueDate && r.dueDate < today && r.status !== 'ACCEPTED') w.push('OVERDUE');
  if (!r.methodologyActive) w.push('REPLACED_METHODOLOGY');
  return w;
}

// ───────────── Schémas d'API ─────────────

const text = (max: number) => z.string().trim().max(max);
const level = z.int().min(1).max(10).nullable();
const isoDate = z.iso.date().nullable();

export const riskCreateSchema = z.strictObject({
  category: z.enum(RISK_TYPES),
  title: z.string().trim().min(3, '3 caractères minimum').max(200),
  scenario: text(4000).default(''),
  cause: text(2000).default(''),
  event: text(2000).default(''),
  consequence: text(2000).default(''),
  inherentLikelihood: level.default(null),
  inherentSeverity: level.default(null),
  ownerId: z.uuid().nullable().default(null),
  dueDate: isoDate.default(null),
});

export const riskUpdateSchema = z.strictObject({
  version: z.int().min(1),
  category: z.enum(RISK_TYPES).optional(),
  title: z.string().trim().min(3).max(200).optional(),
  scenario: text(4000).optional(),
  cause: text(2000).optional(),
  event: text(2000).optional(),
  consequence: text(2000).optional(),
  inherentLikelihood: level.optional(),
  inherentSeverity: level.optional(),
  residualLikelihood: level.optional(),
  residualSeverity: level.optional(),
  treatment: z.enum(RISK_TREATMENTS).nullable().optional(),
  treatmentPlan: text(4000).optional(),
  /** Obligatoire (20 car. min.) quand le traitement passe à « Accepter ». */
  acceptanceJustification: text(4000).optional(),
  status: z.enum(RISK_STATUSES).optional(),
  ownerId: z.uuid().nullable().optional(),
  dueDate: isoDate.optional(),
});
export type RiskUpdate = z.infer<typeof riskUpdateSchema>;

export const riskRescoreSchema = z.strictObject({
  version: z.int().min(1),
  inherentLikelihood: z.int().min(1).max(10),
  inherentSeverity: z.int().min(1).max(10),
  residualLikelihood: level.default(null),
  residualSeverity: level.default(null),
  justification: z.string().trim().min(10, 'Motif de 10 caractères minimum').max(2000),
});

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length))
    .optional();

export const riskListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  aiSystemId: z.uuid().optional(),
  category: csv(RISK_TYPES),
  status: csv(RISK_STATUSES),
  level: z
    .string()
    .regex(/^[A-Z_,]{1,200}$/)
    .optional(),
  ownerId: z.uuid().optional(),
  warning: z.enum(Object.keys(RISK_WARNINGS) as [RiskWarning, ...RiskWarning[]]).optional(),
  /** Cellule de la carte de chaleur résiduelle : « vraisemblance-gravité ». */
  cell: z
    .string()
    .regex(/^\d{1,2}-\d{1,2}$/)
    .optional(),
  includeClosed: z.enum(['true', 'false']).default('false'),
  demo: z.enum(['include', 'exclude', 'only']).default('include'),
  sort: z.enum(['reference', 'title', 'score', 'dueDate', 'updatedAt']).default('score'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});

export const measureCreateSchema = z.strictObject({
  title: z.string().trim().min(3).max(200),
  description: text(4000).default(''),
  type: z.enum(MEASURE_TYPES),
  status: z.enum(MEASURE_STATUSES).default('PLANNED'),
  ownerId: z.uuid().nullable().default(null),
  dueDate: isoDate.default(null),
  /** Rattache immédiatement la mesure à ce risque (même SIA). */
  riskId: z.uuid().optional(),
});
export const measureUpdateSchema = z.strictObject({
  title: z.string().trim().min(3).max(200).optional(),
  description: text(4000).optional(),
  type: z.enum(MEASURE_TYPES).optional(),
  status: z.enum(MEASURE_STATUSES).optional(),
  ownerId: z.uuid().nullable().optional(),
  dueDate: isoDate.optional(),
});

export const actionCreateSchema = z.strictObject({
  aiSystemId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  description: text(4000).default(''),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  assigneeId: z.uuid().nullable().default(null),
  dueDate: isoDate.default(null),
  riskId: z.uuid().nullable().default(null),
  obligationId: z.uuid().nullable().default(null),
  measureId: z.uuid().nullable().default(null),
});
export const actionUpdateSchema = z.strictObject({
  version: z.int().min(1),
  title: z.string().trim().min(3).max(200).optional(),
  description: text(4000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(ACTION_STATUSES).optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: isoDate.optional(),
  riskId: z.uuid().nullable().optional(),
  obligationId: z.uuid().nullable().optional(),
  measureId: z.uuid().nullable().optional(),
  /** Obligatoire pour annuler une action. */
  closureComment: text(2000).optional(),
});
/** Champs qu'un responsable d'action peut modifier sans droit de gestion des actions. */
export const ASSIGNEE_FIELDS = ['version', 'status', 'closureComment'] as const;

export const actionListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  aiSystemId: z.uuid().optional(),
  riskId: z.uuid().optional(),
  obligationId: z.uuid().optional(),
  status: csv(ACTION_STATUSES),
  priority: csv(PRIORITIES),
  assigneeId: z.uuid().optional(),
  mine: z.enum(['true', 'false']).default('false'),
  overdue: z.enum(['true', 'false']).default('false'),
  demo: z.enum(['include', 'exclude', 'only']).default('include'),
  sort: z.enum(['dueDate', 'priority', 'updatedAt', 'title']).default('dueDate'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});
