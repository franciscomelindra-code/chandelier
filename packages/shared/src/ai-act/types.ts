import { z } from 'zod';

/**
 * Format du référentiel réglementaire (données, pas code) — voir docs/AI_ACT_RULES.md.
 * Mini-langage de conditions déclaratif, évalué sans eval().
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { eq: [string, string] }
  | { in: [string, string[]] }
  | { includes: [string, string] }
  | { includesAny: [string, string[]] }
  | { answered: string }
  | { unknown: string }
  | { ref: string }
  | { always: true };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(conditionSchema).min(1) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({ eq: z.tuple([z.string(), z.string()]) }),
    z.strictObject({ in: z.tuple([z.string(), z.array(z.string()).min(1)]) }),
    z.strictObject({ includes: z.tuple([z.string(), z.string()]) }),
    z.strictObject({ includesAny: z.tuple([z.string(), z.array(z.string()).min(1)]) }),
    z.strictObject({ answered: z.string() }),
    z.strictObject({ unknown: z.string() }),
    z.strictObject({ ref: z.string() }),
    z.strictObject({ always: z.literal(true) }),
  ]),
);

export const DIMENSIONS = ['scope', 'roles', 'prohibited', 'highRisk', 'transparency', 'gpai', 'fria'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Valeurs possibles par dimension, de la plus forte à la plus faible (ordre de précédence). */
export const DIMENSION_VALUES = {
  scope: ['OUT_OF_SCOPE', 'UNDETERMINED', 'IN_SCOPE'],
  roles: ['PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR', 'AUTHORISED_REPRESENTATIVE', 'PRODUCT_MANUFACTURER'],
  prohibited: ['POTENTIAL', 'UNDETERMINED', 'NOT_IDENTIFIED'],
  highRisk: ['HIGH_RISK', 'UNDETERMINED', 'NOT_HIGH_RISK_DEROGATION', 'NOT_IDENTIFIED'],
  transparency: ['APPLICABLE', 'UNDETERMINED', 'NONE'],
  gpai: ['PROVIDES_GPAI', 'USES_GPAI', 'UNDETERMINED', 'NONE'],
  fria: ['REQUIRED', 'TO_CONFIRM', 'NOT_REQUIRED'],
} as const satisfies Record<Dimension, readonly string[]>;

/** Dimensions à valeurs multiples (union) plutôt qu'à précédence. */
export const MULTI_DIMENSIONS: readonly Dimension[] = ['roles', 'gpai'];

export const OBLIGATION_ROLES = ['ANY', 'PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR'] as const;

export const questionSchema = z.strictObject({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  section: z.string(),
  text: z.string().min(5),
  help: z.string().default(''),
  legalBasis: z.string().default(''),
  type: z.enum(['tri', 'multi']),
  options: z.array(z.strictObject({ value: z.string(), label: z.string() })).optional(),
  showIf: conditionSchema.optional(),
  /** Une réponse manquante ou « je ne sais pas » est signalée comme information manquante. */
  determinant: z.boolean().default(true),
  /** Source de préremplissage (proposition à confirmer, jamais validée automatiquement). */
  prefill: z.enum(['personalData', 'usesGpai', 'declaredDeployer', 'declaredProvider']).optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const ruleSchema = z.strictObject({
  ruleId: z.string().regex(/^[A-Z0-9-]+$/),
  legalBasis: z.string().min(3),
  version: z.string(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable(),
  condition: conditionSchema,
  output: z.strictObject({
    dimension: z.enum(DIMENSIONS),
    value: z.string(),
    obligations: z.array(z.string()).default([]),
  }),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'INFO']),
  explanation: z.string().min(10),
  sourceUrl: z.url(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const obligationTemplateSchema = z.strictObject({
  key: z.string().regex(/^AIA-OBL-[A-Z0-9-]+$/),
  title: z.string().min(5),
  description: z.string().min(10),
  legalBasis: z.string().min(3),
  category: z.string(),
  roles: z.array(z.enum(OBLIGATION_ROLES)).min(1),
  effectiveFrom: z.iso.date(),
  sourceUrl: z.url(),
});
export type ObligationTemplate = z.infer<typeof obligationTemplateSchema>;

export const frameworkSchema = z.strictObject({
  key: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  label: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']),
  effectiveFrom: z.iso.date(),
  legalText: z.strictObject({ title: z.string(), url: z.url() }),
  disclaimer: z.string(),
  sections: z.array(z.strictObject({ id: z.string(), title: z.string(), description: z.string().default('') })),
  definitions: z.record(z.string(), conditionSchema).default({}),
  questions: z.array(questionSchema).min(1),
  rules: z.array(ruleSchema).min(1),
  obligations: z.array(obligationTemplateSchema),
});
export type Framework = z.infer<typeof frameworkSchema>;

/** Réponses : 'YES' | 'NO' | 'UNKNOWN' pour les questions tri ; string[] pour les choix multiples. */
export type Answers = Record<string, string | string[] | undefined>;

export interface RuleTrace {
  ruleId: string;
  legalBasis: string;
  dimension: Dimension;
  value: string;
  severity: Rule['severity'];
  explanation: string;
  sourceUrl: string;
  effectiveFrom: string;
  /** Réponses ayant conduit au déclenchement (questions citées par la condition). */
  answers: Record<string, string | string[] | null>;
}

export interface DimensionResult {
  value: string;
  values: string[];
  rules: RuleTrace[];
}

export interface GeneratedObligation {
  key: string;
  title: string;
  description: string;
  legalBasis: string;
  category: string;
  applicability: 'YES' | 'TO_CONFIRM';
  effectiveFrom: string;
  upcoming: boolean;
  sourceRuleIds: string[];
  sourceUrl: string;
}

export interface EvaluationResult {
  frameworkKey: string;
  frameworkVersion: string;
  evaluatedAt: string;
  dimensions: Record<Dimension, DimensionResult>;
  displayCategory: 'OUT_OF_SCOPE' | 'MINIMAL' | 'LIMITED' | 'HIGH' | 'PROHIBITED' | 'UNDETERMINED';
  displayJustification: string;
  obligations: GeneratedObligation[];
  missing: { questionId: string; text: string; section: string }[];
  triggeredRules: RuleTrace[];
}
