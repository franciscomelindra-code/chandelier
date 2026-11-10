import type { Tone } from '../labels.js';
import type { Dimension } from './types.js';

export const DIMENSION_LABELS: Record<Dimension, string> = {
  scope: 'Champ d’application (art. 2 et 3)',
  roles: 'Rôle(s) de l’organisation',
  prohibited: 'Pratiques interdites (art. 5)',
  highRisk: 'Haut risque (art. 6, annexes I et III)',
  transparency: 'Transparence (art. 50)',
  gpai: 'Modèles d’IA à usage général',
  fria: 'Analyse d’impact sur les droits fondamentaux (art. 27)',
};

export const DIMENSION_VALUE_META: Record<string, { label: string; tone: Tone }> = {
  IN_SCOPE: { label: 'Dans le champ', tone: 'blue' },
  OUT_OF_SCOPE: { label: 'Hors champ', tone: 'blue' },
  UNDETERMINED: { label: 'À déterminer', tone: 'gray' },
  NOT_APPLICABLE: { label: 'Sans objet', tone: 'gray' },
  POTENTIAL: { label: 'Potentiellement interdit', tone: 'red' },
  NOT_IDENTIFIED: { label: 'Non identifié', tone: 'green' },
  HIGH_RISK: { label: 'Haut risque', tone: 'orange' },
  NOT_HIGH_RISK_DEROGATION: { label: 'Non haut risque (dérogation art. 6(3))', tone: 'yellow' },
  APPLICABLE: { label: 'Obligations applicables', tone: 'yellow' },
  NONE: { label: 'Aucune', tone: 'green' },
  PROVIDES_GPAI: { label: 'Fournit un modèle GPAI', tone: 'orange' },
  USES_GPAI: { label: 'Repose sur un modèle GPAI', tone: 'blue' },
  REQUIRED: { label: 'Requise', tone: 'orange' },
  TO_CONFIRM: { label: 'À confirmer', tone: 'gray' },
  NOT_REQUIRED: { label: 'Non requise', tone: 'green' },
  PROVIDER: { label: 'Fournisseur', tone: 'blue' },
  DEPLOYER: { label: 'Déployeur', tone: 'blue' },
  IMPORTER: { label: 'Importateur', tone: 'blue' },
  DISTRIBUTOR: { label: 'Distributeur', tone: 'blue' },
  AUTHORISED_REPRESENTATIVE: { label: 'Mandataire', tone: 'blue' },
  PRODUCT_MANUFACTURER: { label: 'Fabricant de produit', tone: 'blue' },
};

/** Dimensions qu'un juriste peut surcharger, et valeurs admises. */
export const OVERRIDABLE: Record<string, readonly string[]> = {
  displayCategory: ['OUT_OF_SCOPE', 'MINIMAL', 'LIMITED', 'HIGH', 'PROHIBITED', 'UNDETERMINED'],
  scope: ['IN_SCOPE', 'OUT_OF_SCOPE', 'UNDETERMINED'],
  prohibited: ['POTENTIAL', 'NOT_IDENTIFIED', 'UNDETERMINED'],
  highRisk: ['HIGH_RISK', 'NOT_HIGH_RISK_DEROGATION', 'NOT_IDENTIFIED', 'UNDETERMINED'],
  transparency: ['APPLICABLE', 'NONE', 'UNDETERMINED'],
  fria: ['REQUIRED', 'TO_CONFIRM', 'NOT_REQUIRED'],
};
export const OVERRIDE_LABELS: Record<string, string> = {
  displayCategory: 'Catégorie d’affichage',
  scope: 'Champ d’application',
  prohibited: 'Pratiques interdites',
  highRisk: 'Haut risque',
  transparency: 'Transparence',
  fria: 'FRIA',
};

export const ASSESSMENT_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Brouillon', tone: 'gray' },
  COMPLETED: { label: 'Terminée', tone: 'blue' },
  VALIDATED: { label: 'Validée', tone: 'green' },
  SUPERSEDED: { label: 'Remplacée', tone: 'gray' },
};

export const OBLIGATION_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Non commencée', tone: 'gray' },
  IN_PROGRESS: { label: 'En cours', tone: 'blue' },
  COMPLIANT: { label: 'Conforme', tone: 'green' },
  NON_COMPLIANT: { label: 'Non conforme', tone: 'red' },
  NOT_APPLICABLE: { label: 'Non applicable', tone: 'gray' },
};

export const APPLICABILITY_LABELS: Record<string, string> = { YES: 'Oui', NO: 'Non', TO_CONFIRM: 'À confirmer' };

export const OBLIGATION_CATEGORY_LABELS: Record<string, string> = {
  GOVERNANCE_RISK: 'Gouvernance et gestion des risques',
  DATA_GOVERNANCE: 'Gouvernance des données',
  DOCUMENTATION: 'Documentation',
  LOGGING: 'Journalisation',
  TRANSPARENCY: 'Transparence / information',
  HUMAN_OVERSIGHT: 'Contrôle humain',
  ACCURACY_ROBUSTNESS_SECURITY: 'Exactitude, robustesse, cybersécurité',
  DEPLOYER: 'Obligations du déployeur',
  WORKER_INFORMATION: 'Information des salariés',
  FRIA: 'FRIA',
  DPIA: 'DPIA / RGPD',
  MONITORING_INCIDENTS: 'Surveillance et incidents',
  AI_LITERACY: 'Maîtrise de l’IA',
  PROHIBITION: 'Pratiques interdites',
  REGISTRATION: 'Enregistrement',
  GPAI: 'IA à usage général',
  OTHER: 'Autre',
};
