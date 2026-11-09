/**
 * Libellés français et tonalités visuelles des énumérations.
 * Tonalités (charte demandée) : green = conforme/faible, yellow = attention,
 * orange = risque significatif, red = critique/interdit, gray = information manquante,
 * blue = information/action.
 */
export type Tone = 'green' | 'yellow' | 'orange' | 'red' | 'gray' | 'blue';

export interface EnumMeta {
  label: string;
  tone: Tone;
}

export const ORG_UNIT_TYPES = ['ENTITY', 'DIRECTION', 'DEPARTMENT', 'TEAM'] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];
export const ORG_UNIT_TYPE_LABELS: Record<OrgUnitType, string> = {
  ENTITY: 'Entité',
  DIRECTION: 'Direction',
  DEPARTMENT: 'Département',
  TEAM: 'Équipe',
};

export const AI_SYSTEM_STATUSES = [
  'DRAFT',
  'QUALIFICATION',
  'VALIDATION',
  'PILOT',
  'ACTIVE',
  'SUSPENDED',
  'RETIRED',
  'CANCELLED',
  'ARCHIVED',
] as const;
export type AiSystemStatus = (typeof AI_SYSTEM_STATUSES)[number];
export const AI_SYSTEM_STATUS_META: Record<AiSystemStatus, EnumMeta> = {
  DRAFT: { label: 'Brouillon', tone: 'gray' },
  QUALIFICATION: { label: 'En qualification', tone: 'blue' },
  VALIDATION: { label: 'En validation', tone: 'blue' },
  PILOT: { label: 'Pilote', tone: 'yellow' },
  ACTIVE: { label: 'Actif', tone: 'green' },
  SUSPENDED: { label: 'Suspendu', tone: 'orange' },
  RETIRED: { label: 'Retiré', tone: 'gray' },
  CANCELLED: { label: 'Annulé', tone: 'gray' },
  ARCHIVED: { label: 'Archivé', tone: 'gray' },
};

export const RISK_CATEGORIES = ['OUT_OF_SCOPE', 'MINIMAL', 'LIMITED', 'HIGH', 'PROHIBITED', 'UNDETERMINED'] as const;
export type RiskDisplayCategory = (typeof RISK_CATEGORIES)[number];
export const RISK_CATEGORY_META: Record<RiskDisplayCategory, EnumMeta> = {
  OUT_OF_SCOPE: { label: 'Hors champ', tone: 'blue' },
  MINIMAL: { label: 'Minimal', tone: 'green' },
  LIMITED: { label: 'Transparence', tone: 'yellow' },
  HIGH: { label: 'Haut risque', tone: 'orange' },
  PROHIBITED: { label: 'Potentiellement interdit', tone: 'red' },
  UNDETERMINED: { label: 'À déterminer', tone: 'gray' },
};

export const ORIGIN_LABELS: Record<string, string> = {
  USER: 'Utilisateur',
  IMPORT: 'Import',
  API: 'API',
  ASSISTANT: 'Assistant IA',
  SYSTEM: 'Système',
};
