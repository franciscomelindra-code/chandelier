import { z } from 'zod';
import { SECTIONS, type SectionKey } from './ai-system.js';

const text = (max: number) => z.string().trim().max(max);
const uuid = z.uuid();
const triState = z.enum(['YES', 'NO', 'UNKNOWN']);

// ── Énumérations et libellés ────────────────────────────────────────────────

export const PARTY_FUNCTIONS = [
  'SPONSOR',
  'BUSINESS_OWNER',
  'IT_LEAD',
  'CISO',
  'DPO_LEGAL',
  'VENDOR_CONTACT',
  'INTEGRATOR',
  'USER_REPRESENTATIVE',
  'OTHER',
] as const;
export type PartyFunction = (typeof PARTY_FUNCTIONS)[number];
export const PARTY_FUNCTION_LABELS: Record<PartyFunction, string> = {
  SPONSOR: 'Sponsor',
  BUSINESS_OWNER: 'Responsable métier',
  IT_LEAD: 'Référent DSI',
  CISO: 'RSSI',
  DPO_LEGAL: 'DPO / Juridique',
  VENDOR_CONTACT: 'Contact fournisseur',
  INTEGRATOR: 'Intégrateur',
  USER_REPRESENTATIVE: 'Représentant des utilisateurs',
  OTHER: 'Autre intervenant',
};
/** Fonctions de l'étape 2 « Responsabilité » ; les autres relèvent de l'étape 4 « Parties prenantes ». */
export const RESPONSIBILITY_FUNCTIONS: readonly PartyFunction[] = [
  'SPONSOR',
  'BUSINESS_OWNER',
  'IT_LEAD',
  'CISO',
  'DPO_LEGAL',
  'VENDOR_CONTACT',
  'INTEGRATOR',
];
export const sectionOfFunction = (f: PartyFunction): SectionKey =>
  RESPONSIBILITY_FUNCTIONS.includes(f) ? 'responsibility' : 'stakeholders';

export const RACI = ['RESPONSIBLE', 'ACCOUNTABLE', 'CONSULTED', 'INFORMED'] as const;
export const RACI_LABELS: Record<(typeof RACI)[number], string> = {
  RESPONSIBLE: 'R — Réalise',
  ACCOUNTABLE: 'A — Approuve',
  CONSULTED: 'C — Consulté',
  INFORMED: 'I — Informé',
};

export const ASSET_TYPES = [
  'APPLICATION',
  'API',
  'SERVER',
  'SAAS',
  'DATABASE',
  'DEVICE',
  'INFRASTRUCTURE',
  'OTHER',
] as const;
export const ASSET_TYPE_LABELS: Record<(typeof ASSET_TYPES)[number], string> = {
  APPLICATION: 'Application',
  API: 'API',
  SERVER: 'Serveur',
  SAAS: 'SaaS',
  DATABASE: 'Base de données',
  DEVICE: 'Appareil',
  INFRASTRUCTURE: 'Infrastructure',
  OTHER: 'Autre',
};

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = {
  LOW: 'Faible',
  MEDIUM: 'Moyenne',
  HIGH: 'Élevée',
  CRITICAL: 'Critique',
};

export const GDPR_ROLES = ['CONTROLLER', 'JOINT_CONTROLLER', 'PROCESSOR'] as const;
export const GDPR_ROLE_LABELS: Record<(typeof GDPR_ROLES)[number], string> = {
  CONTROLLER: 'Responsable de traitement',
  JOINT_CONTROLLER: 'Responsable conjoint',
  PROCESSOR: 'Sous-traitant',
};

export const DATASET_ORIGINS = ['INTERNAL', 'VENDOR', 'PUBLIC', 'PURCHASED', 'SYNTHETIC', 'OTHER'] as const;
export const DATASET_ORIGIN_LABELS: Record<(typeof DATASET_ORIGINS)[number], string> = {
  INTERNAL: 'Interne',
  VENDOR: 'Fournisseur',
  PUBLIC: 'Publique',
  PURCHASED: 'Achetée',
  SYNTHETIC: 'Synthétique',
  OTHER: 'Autre',
};

export const DATASET_USAGES = ['TRAINING', 'FINE_TUNING', 'RAG', 'INFERENCE', 'VALIDATION', 'TESTING'] as const;
export const DATASET_USAGE_LABELS: Record<(typeof DATASET_USAGES)[number], string> = {
  TRAINING: 'Entraînement',
  FINE_TUNING: 'Fine-tuning',
  RAG: 'RAG',
  INFERENCE: 'Inférence',
  VALIDATION: 'Validation',
  TESTING: 'Tests',
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  general: 'Général',
  responsibility: 'Responsabilité',
  models: 'Modèles d’IA',
  stakeholders: 'Parties prenantes',
  assets: 'Actifs',
  processing: 'Traitements de données',
  data: 'Données',
  subjects: 'Personnes concernées',
  classification: 'Classification',
  value: 'Valeur ajoutée',
  documentation: 'Documentation',
  summary: 'Récapitulatif',
};
export const SECTION_ORDER: readonly SectionKey[] = SECTIONS;

// ── Référentiels ────────────────────────────────────────────────────────────

export const stakeholderSchema = z.strictObject({
  kind: z.enum(['INTERNAL', 'EXTERNAL']),
  name: text(160).min(2),
  organization: text(160).default(''),
  /** Coordonnées professionnelles uniquement (minimisation). */
  contact: text(200).default(''),
  userId: uuid.nullable().default(null),
});
export const stakeholderUpdateSchema = stakeholderSchema.partial();

export const assetSchema = z.strictObject({
  name: text(160).min(2),
  type: z.enum(ASSET_TYPES),
  description: text(4000).default(''),
  location: text(200).default(''),
  criticality: z.enum(PRIORITIES).nullable().default(null),
});
export const assetUpdateSchema = assetSchema.partial();

export const processingActivitySchema = z.strictObject({
  reference: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Lettres, chiffres, . - _'),
  name: text(200).min(2),
  purpose: text(4000).default(''),
  legalBasis: text(200).default(''),
  gdprRole: z.enum(GDPR_ROLES).default('CONTROLLER'),
  dpiaRequired: triState.default('UNKNOWN'),
  retention: text(500).default(''),
  externalRef: text(200).default(''),
  dataCategoryIds: z.array(uuid).max(50).default([]),
  dataSubjectIds: z.array(uuid).max(50).default([]),
});
export const processingActivityUpdateSchema = processingActivitySchema.partial();

export const datasetSchema = z.strictObject({
  name: text(200).min(2),
  description: text(4000).default(''),
  origin: z.enum(DATASET_ORIGINS),
  dataType: text(200).default(''),
  containsPersonalData: triState.default('UNKNOWN'),
  containsSpecialCategories: triState.default('UNKNOWN'),
  containsCriminalData: triState.default('UNKNOWN'),
  isSynthetic: z.boolean().default(false),
  provenance: text(1000).default(''),
  license: text(200).default(''),
  qualityNotes: text(4000).default(''),
  representativenessNotes: text(4000).default(''),
  retention: text(500).default(''),
  storageLocation: text(200).default(''),
  transfersOutsideEu: triState.default('UNKNOWN'),
  recipients: text(1000).default(''),
});
export const datasetUpdateSchema = datasetSchema.partial();

export const templateFromSystemSchema = z.strictObject({
  name: text(120).min(2),
  description: text(1000).default(''),
  fromSystemId: uuid,
});

/** Champs recopiés d'un gabarit lors de la création (jamais d'historique, de validations ni de liens). */
export const TEMPLATE_FIELDS = [
  'description',
  'purpose',
  'objectives',
  'useCases',
  'functioning',
  'scope',
  'operationalContext',
  'countries',
  'targetPopulations',
  'autonomyLevel',
  'aiActRoles',
  'processesPersonalData',
  'includesMinors',
  'includesVulnerable',
  'valueLevel',
  'valueJustification',
  'valueDetails',
] as const;

// ── Liens SIA ↔ référentiels ────────────────────────────────────────────────

export const systemStakeholderSchema = z.strictObject({
  stakeholderId: uuid,
  function: z.enum(PARTY_FUNCTIONS),
  responsibility: text(1000).default(''),
  access: text(500).default(''),
  raci: z.enum(RACI).nullable().default(null),
});
export const systemStakeholderUpdateSchema = systemStakeholderSchema
  .omit({ stakeholderId: true, function: true })
  .partial();

export const systemAssetSchema = z.strictObject({ assetId: uuid, dependency: text(1000).default('') });
export const systemProcessingSchema = z.strictObject({ processingActivityId: uuid, notes: text(2000).default('') });
export const systemDatasetSchema = z.strictObject({
  datasetId: uuid,
  usages: z.array(z.enum(DATASET_USAGES)).min(1, 'Au moins un usage').max(6),
  notes: text(2000).default(''),
});
export const systemDataCategoriesSchema = z.strictObject({ ids: z.array(uuid).max(50) });
export const systemDataSubjectsSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        dataSubjectId: uuid,
        volumeEstimate: text(200).default(''),
        consequences: text(2000).default(''),
      }),
    )
    .max(30),
});
export const sectionAssignmentSchema = z.strictObject({
  section: z.enum(SECTIONS),
  userId: uuid,
  dueDate: z.iso.date().nullable().default(null),
});

export const valueDetailsSchema = z.strictObject({
  benefits: text(4000).default(''),
  kpis: text(2000).default(''),
  estimatedGains: text(2000).default(''),
  quality: text(2000).default(''),
  productivity: text(2000).default(''),
  experience: text(2000).default(''),
  safety: text(2000).default(''),
  avoidedCosts: text(2000).default(''),
});
export type ValueDetails = z.infer<typeof valueDetailsSchema>;
export const VALUE_DETAIL_LABELS: Record<keyof ValueDetails, string> = {
  benefits: 'Bénéfices attendus',
  kpis: 'Indicateurs (KPI)',
  estimatedGains: 'Gains estimés',
  quality: 'Qualité',
  productivity: 'Productivité',
  experience: 'Expérience (client / collaborateur)',
  safety: 'Sécurité',
  avoidedCosts: 'Coûts évités',
};

// ── Fournisseurs et modèles d'IA (S4) ───────────────────────────────────────

export const VENDOR_RELATIONS = ['PROVIDER', 'INTEGRATOR', 'HOSTING', 'RESELLER', 'OTHER'] as const;
export const VENDOR_RELATION_LABELS: Record<(typeof VENDOR_RELATIONS)[number], string> = {
  PROVIDER: 'Fournisseur / éditeur',
  INTEGRATOR: 'Intégrateur',
  HOSTING: 'Hébergeur',
  RESELLER: 'Revendeur',
  OTHER: 'Autre',
};

export const MODEL_TYPES = [
  'LLM',
  'VISION',
  'CLASSIFICATION',
  'RECOMMENDATION',
  'SPEECH',
  'MULTIMODAL',
  'OTHER',
] as const;
export const MODEL_TYPE_LABELS: Record<(typeof MODEL_TYPES)[number], string> = {
  LLM: 'Modèle de langage (LLM)',
  VISION: 'Vision',
  CLASSIFICATION: 'Classification',
  RECOMMENDATION: 'Recommandation',
  SPEECH: 'Parole',
  MULTIMODAL: 'Multimodal',
  OTHER: 'Autre',
};

export const MODEL_ACCESS_MODES = ['API', 'SAAS', 'ON_PREMISE', 'OPEN_WEIGHTS', 'EMBEDDED', 'OTHER'] as const;
export const MODEL_ACCESS_LABELS: Record<(typeof MODEL_ACCESS_MODES)[number], string> = {
  API: 'API',
  SAAS: 'SaaS',
  ON_PREMISE: 'Sur site',
  OPEN_WEIGHTS: 'Poids ouverts',
  EMBEDDED: 'Embarqué',
  OTHER: 'Autre',
};

export const MODEL_STATUSES = ['UNDER_EVALUATION', 'APPROVED', 'DEPRECATED', 'RETIRED'] as const;
export const MODEL_STATUS_META: Record<
  (typeof MODEL_STATUSES)[number],
  { label: string; tone: 'green' | 'yellow' | 'orange' | 'gray' | 'blue' | 'red' }
> = {
  UNDER_EVALUATION: { label: 'En évaluation', tone: 'blue' },
  APPROVED: { label: 'Approuvé', tone: 'green' },
  DEPRECATED: { label: 'Obsolète', tone: 'orange' },
  RETIRED: { label: 'Retiré', tone: 'gray' },
};

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'URL http(s) attendue');

export const vendorSchema = z.strictObject({
  name: text(160).min(2),
  legalName: text(200).default(''),
  country: text(2)
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'Code pays ISO à 2 lettres')
    .default(''),
  website: httpUrl.default(''),
  description: text(4000).default(''),
  dpaSigned: triState.default('UNKNOWN'),
  isActive: z.boolean().default(true),
});
export const vendorUpdateSchema = vendorSchema.partial();

export const aiModelSchema = z.strictObject({
  name: text(160).min(2),
  vendorId: uuid.nullable().default(null),
  family: text(160).default(''),
  version: text(80).default(''),
  type: z.enum(MODEL_TYPES),
  description: text(4000).default(''),
  capabilities: text(4000).default(''),
  knownLimitations: text(4000).default(''),
  accessMode: z.enum(MODEL_ACCESS_MODES),
  hosting: text(500).default(''),
  regions: z.array(text(60).min(1)).max(30).default([]),
  /** Saisie seulement : l'URL n'est jamais récupérée côté serveur (pas de SSRF). */
  documentationUrl: httpUrl.default(''),
  knowledgeDate: z.iso.date().nullable().default(null),
  versionDate: z.iso.date().nullable().default(null),
  status: z.enum(MODEL_STATUSES).default('UNDER_EVALUATION'),
  isGpai: triState.default('UNKNOWN'),
  gpaiSystemicRisk: triState.default('UNKNOWN'),
  gpaiNotes: text(4000).default(''),
  license: text(200).default(''),
});
export const aiModelUpdateSchema = aiModelSchema.partial();

/** Lien SIA ↔ modèle : la description de l'utilisation est propre à chaque relation (CDC §5.7). */
export const systemModelSchema = z.strictObject({
  aiModelId: uuid,
  usageDescription: text(4000).min(10, 'Décrivez l’usage du modèle dans ce SIA (10 caractères minimum)'),
  versionUsed: text(80).default(''),
  hostingMode: z.enum(MODEL_ACCESS_MODES).nullable().default(null),
  integrationDate: z.iso.date().nullable().default(null),
  isPrimary: z.boolean().default(false),
});
export const systemModelUpdateSchema = systemModelSchema.omit({ aiModelId: true }).partial();

export const systemVendorSchema = z.strictObject({
  vendorId: uuid,
  relation: z.enum(VENDOR_RELATIONS),
  notes: text(1000).default(''),
});
