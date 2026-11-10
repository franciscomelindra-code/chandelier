import { z } from 'zod';
import type { EnumMeta } from './labels.js';
import type { RoleKey } from './permissions.js';

/** S7 — documents et preuves, validations, revues, commentaires, notifications. */

export const DOCUMENT_TYPES = [
  'TRANSPARENCY_NOTICE',
  'CONTRACT',
  'DPA',
  'VENDOR_DOCUMENTATION',
  'DPIA',
  'FRIA',
  'SECURITY_ANALYSIS',
  'TEST_REPORT',
  'VALIDATION_RECORD',
  'USER_INSTRUCTIONS',
  'LOGS',
  'CERTIFICATE',
  'COMPLIANCE_REPORT',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  TRANSPARENCY_NOTICE: 'Notice de transparence',
  CONTRACT: 'Contrat',
  DPA: 'Accord de sous-traitance (DPA)',
  VENDOR_DOCUMENTATION: 'Documentation fournisseur',
  DPIA: 'AIPD / DPIA',
  FRIA: 'FRIA',
  SECURITY_ANALYSIS: 'Analyse de sécurité',
  TEST_REPORT: 'Rapport de tests',
  VALIDATION_RECORD: 'Procès-verbal de validation',
  USER_INSTRUCTIONS: 'Notice d’utilisation',
  LOGS: 'Journaux',
  CERTIFICATE: 'Certificat',
  COMPLIANCE_REPORT: 'Rapport de conformité',
  OTHER: 'Autre',
};

/**
 * Formats acceptés : extension → type MIME servi et signature attendue.
 * Aucun format exécutable ou interprété par le navigateur (HTML, SVG, JS) n'est accepté.
 */
export const UPLOAD_FORMATS = {
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  png: { mime: 'image/png', kind: 'png' },
  jpg: { mime: 'image/jpeg', kind: 'jpeg' },
  jpeg: { mime: 'image/jpeg', kind: 'jpeg' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'zip' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'zip' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', kind: 'zip' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'zip' },
  txt: { mime: 'text/plain; charset=utf-8', kind: 'text' },
  csv: { mime: 'text/csv; charset=utf-8', kind: 'text' },
  md: { mime: 'text/markdown; charset=utf-8', kind: 'text' },
  json: { mime: 'application/json', kind: 'text' },
} as const;
export type UploadExtension = keyof typeof UPLOAD_FORMATS;
export const ACCEPT_ATTRIBUTE = Object.keys(UPLOAD_FORMATS)
  .map((e) => `.${e}`)
  .join(',');

export function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return m ? m[1]!.toLowerCase() : '';
}

/** Vérifie la signature (« magic bytes ») des premiers octets contre le format annoncé par l'extension. */
export function sniffMatches(kind: (typeof UPLOAD_FORMATS)[UploadExtension]['kind'], head: Uint8Array): boolean {
  const starts = (...b: number[]) => b.every((x, i) => head[i] === x);
  switch (kind) {
    case 'pdf':
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    case 'png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'zip':
      return starts(0x50, 0x4b, 0x03, 0x04);
    case 'text': {
      if (head.includes(0)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(head.length >= 4096 ? head.slice(0, 4000) : head);
        return true;
      } catch {
        return false;
      }
    }
  }
}

/** Nom de fichier affichable : sans chemin, sans caractères de contrôle, longueur bornée. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'fichier';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').trim();
  return (clean || 'fichier').slice(0, 180);
}

export const documentMetaSchema = z.strictObject({
  title: z.string().trim().min(3, '3 caractères minimum').max(200),
  type: z.enum(DOCUMENT_TYPES),
  description: z.string().trim().max(2000).default(''),
});
export const documentUpdateSchema = z.strictObject({
  title: z.string().trim().min(3).max(200).optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
  description: z.string().trim().max(2000).optional(),
});

// ───────────── Validations par domaine ─────────────

export const APPROVAL_DOMAINS = ['BUSINESS', 'DPO', 'RSSI', 'LEGAL', 'IT'] as const;
export type ApprovalDomain = (typeof APPROVAL_DOMAINS)[number];
export const APPROVAL_DOMAIN_LABELS: Record<ApprovalDomain, string> = {
  BUSINESS: 'Métier',
  DPO: 'DPO',
  RSSI: 'RSSI',
  LEGAL: 'Juridique',
  IT: 'DSI',
};
/**
 * Rôles habilités à décider pour un domaine (en plus de `approval:decide` dans le périmètre).
 * Le super administrateur n'est volontairement habilité pour aucun domaine (séparation des tâches) ;
 * un approbateur nommément désigné peut décider quel que soit son rôle s'il détient `approval:decide`.
 */
export const DOMAIN_ROLES: Record<ApprovalDomain, RoleKey[]> = {
  BUSINESS: ['REVIEWER', 'AI_GOVERNANCE'],
  DPO: ['DPO'],
  RSSI: ['RSSI'],
  LEGAL: ['LEGAL'],
  IT: ['IT'],
};
export const APPROVAL_STATUS_META: Record<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED', EnumMeta> = {
  PENDING: { label: 'En attente', tone: 'yellow' },
  APPROVED: { label: 'Approuvé', tone: 'green' },
  REJECTED: { label: 'Rejeté', tone: 'red' },
  CANCELLED: { label: 'Annulé', tone: 'gray' },
};

export const validationRequestSchema = z.strictObject({
  domains: z
    .array(z.enum(APPROVAL_DOMAINS))
    .min(1, 'Au moins un domaine')
    .max(APPROVAL_DOMAINS.length)
    .refine((d) => new Set(d).size === d.length, 'Domaines en double'),
  /** Approbateur désigné par domaine (facultatif). */
  approvers: z.partialRecord(z.enum(APPROVAL_DOMAINS), z.uuid()).default({}),
  comment: z.string().trim().max(2000).default(''),
});
export const approvalDecisionSchema = z
  .strictObject({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().trim().max(2000).default(''),
  })
  .refine((d) => d.decision === 'APPROVED' || d.comment.length >= 10, {
    message: 'Motif de rejet obligatoire (10 caractères minimum)',
    path: ['comment'],
  });

// ───────────── Revues ─────────────

export const REVIEW_KINDS = ['PERIODIC', 'EXCEPTIONAL'] as const;
export const REVIEW_KIND_LABELS = { PERIODIC: 'Périodique', EXCEPTIONAL: 'Exceptionnelle' } as const;
export const REVIEW_TRIGGERS = [
  'SCHEDULED',
  'MAJOR_CHANGE',
  'INCIDENT',
  'MODEL_CHANGE',
  'PURPOSE_CHANGE',
  'DATASET_CHANGE',
  'VENDOR_CHANGE',
  'POPULATION_CHANGE',
  'AUTONOMY_CHANGE',
  'REGULATORY_CHANGE',
  'MANUAL',
] as const;
export type ReviewTrigger = (typeof REVIEW_TRIGGERS)[number];
export const REVIEW_TRIGGER_LABELS: Record<ReviewTrigger, string> = {
  SCHEDULED: 'Échéance périodique',
  MAJOR_CHANGE: 'Modification majeure',
  INCIDENT: 'Incident',
  MODEL_CHANGE: 'Changement de modèle',
  PURPOSE_CHANGE: 'Changement de finalité',
  DATASET_CHANGE: 'Changement de jeu de données',
  VENDOR_CHANGE: 'Changement de fournisseur',
  POPULATION_CHANGE: 'Changement de population concernée',
  AUTONOMY_CHANGE: 'Changement d’autonomie',
  REGULATORY_CHANGE: 'Évolution réglementaire',
  MANUAL: 'Demande manuelle',
};
export const REVIEW_STATUS_META: Record<'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED', EnumMeta> = {
  PLANNED: { label: 'Planifiée', tone: 'gray' },
  IN_PROGRESS: { label: 'En cours', tone: 'yellow' },
  COMPLETED: { label: 'Terminée', tone: 'green' },
  CANCELLED: { label: 'Annulée', tone: 'gray' },
};

/** Champs dont la modification sur un SIA validé déclenche une revue exceptionnelle (CDC §5.10, §13). */
export const SUBSTANTIAL_FIELDS: Record<string, ReviewTrigger> = {
  purpose: 'PURPOSE_CHANGE',
  useCases: 'PURPOSE_CHANGE',
  autonomyLevel: 'AUTONOMY_CHANGE',
  targetPopulations: 'POPULATION_CHANGE',
  includesMinors: 'POPULATION_CHANGE',
  includesVulnerable: 'POPULATION_CHANGE',
  affectedVolumeEstimate: 'POPULATION_CHANGE',
};
/** Sections relationnelles dont la modification déclenche une revue exceptionnelle. */
export const SUBSTANTIAL_SECTIONS: Record<string, ReviewTrigger> = {
  models: 'MODEL_CHANGE',
  datasets: 'DATASET_CHANGE',
  vendors: 'VENDOR_CHANGE',
};

/** Périodicité de revue (mois) par catégorie AI Act ; « default » pour les autres. Paramétrable. */
export const reviewIntervalsSchema = z.strictObject({
  default: z.int().min(1).max(60),
  HIGH: z.int().min(1).max(60).optional(),
  PROHIBITED: z.int().min(1).max(60).optional(),
  LIMITED: z.int().min(1).max(60).optional(),
  MINIMAL: z.int().min(1).max(60).optional(),
  UNDETERMINED: z.int().min(1).max(60).optional(),
  OUT_OF_SCOPE: z.int().min(1).max(60).optional(),
});
export type ReviewIntervals = z.infer<typeof reviewIntervalsSchema>;
export const DEFAULT_REVIEW_INTERVALS: ReviewIntervals = { default: 12, HIGH: 6, PROHIBITED: 3, UNDETERMINED: 6 };
export const intervalFor = (cfg: ReviewIntervals, riskCategory: string) =>
  (cfg as Record<string, number | undefined>)[riskCategory] ?? cfg.default;

/** Ajoute n mois à une date AAAA-MM-JJ (fin de mois bornée). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export const reviewCreateSchema = z.strictObject({
  kind: z.enum(REVIEW_KINDS),
  trigger: z.enum(REVIEW_TRIGGERS),
  dueDate: z.iso.date(),
  reviewerId: z.uuid().nullable().default(null),
  notes: z.string().trim().max(4000).default(''),
});
export const reviewUpdateSchema = z.strictObject({
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'CANCELLED']).optional(),
  dueDate: z.iso.date().optional(),
  reviewerId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
});
export const reviewCompleteSchema = z.strictObject({
  outcome: z.string().trim().min(10, 'Conclusion de 10 caractères minimum').max(4000),
  notes: z.string().trim().max(4000).optional(),
});

// ───────────── Commentaires, notifications ─────────────

export const commentCreateSchema = z.strictObject({
  body: z.string().trim().min(1).max(4000),
  section: z.string().max(40).nullable().default(null),
  mentions: z.array(z.uuid()).max(20).default([]),
});

/** Seuils de rappel avant échéance (jours) ; 0 = échéance dépassée. */
export const REMINDER_THRESHOLDS = [90, 60, 30, 7, 0] as const;
/** Seuil applicable : le plus petit seuil ≥ jours restants (null au-delà de 90 jours). */
export function reminderThreshold(daysLeft: number): number | null {
  if (daysLeft < 0) return 0;
  const candidates = REMINDER_THRESHOLDS.filter((t) => t > 0 && daysLeft <= t);
  return candidates.length ? Math.min(...candidates) : null;
}
