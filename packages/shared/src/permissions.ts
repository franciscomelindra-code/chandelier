/**
 * Matrice RBAC exécutable (documentée dans docs/SECURITY.md §3).
 * Une "grant" est une permission éventuellement qualifiée :
 *   "aiSystem:update"          → sur tous les SIA du périmètre
 *   "aiSystem:update:own"      → uniquement les SIA dont l'utilisateur est propriétaire
 *   "aiSystem:update:assigned" → uniquement les sections qui lui sont affectées
 */
export const PERMISSIONS = [
  'aiSystem:read',
  'aiSystem:create',
  'aiSystem:update',
  'aiSystem:archive',
  'aiSystem:export',
  'catalog:manage',
  'assessment:run',
  'assessment:override',
  'assessment:validate',
  'obligation:update',
  'risk:manage',
  'action:manage',
  'document:upload',
  'fria:manage',
  'dpia:manage',
  'notice:manage',
  'notice:validate',
  'approval:decide',
  'review:manage',
  'comment:write',
  'import:run',
  'report:read',
  'audit:read',
  'assistant:use',
  'referential:manage',
  'user:read',
  'user:manage',
  'orgUnit:manage',
  'role:manage',
  'settings:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Qualifier = 'all' | 'own' | 'assigned';

export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'DPO',
  'LEGAL',
  'AI_GOVERNANCE',
  'RSSI',
  'IT',
  'SYSTEM_OWNER',
  'CONTRIBUTOR',
  'REVIEWER',
  'AUDITOR',
  'READER',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  label: string;
  description: string;
  grants: string[];
}

const READ_BASE = ['aiSystem:read', 'user:read', 'report:read'];

const COMPLIANCE_CORE = [
  ...READ_BASE,
  'aiSystem:create',
  'aiSystem:update',
  'aiSystem:archive',
  'aiSystem:export',
  'catalog:manage',
  'assessment:run',
  'assessment:validate',
  'obligation:update',
  'risk:manage',
  'action:manage',
  'document:upload',
  'notice:manage',
  'approval:decide',
  'review:manage',
  'comment:write',
  'import:run',
  'audit:read',
  'assistant:use',
];

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  SUPER_ADMIN: {
    label: 'Super administrateur',
    description: 'Paramétrage global, référentiels, utilisateurs, sauvegardes.',
    grants: [...PERMISSIONS],
  },
  DPO: {
    label: 'DPO',
    description: 'Tous SIA, classification, FRIA, RGPD, validation conformité.',
    grants: [...COMPLIANCE_CORE, 'assessment:override', 'fria:manage', 'dpia:manage', 'notice:validate'],
  },
  LEGAL: {
    label: 'Juridique IA',
    description: 'Qualification AI Act, surcharge motivée, FRIA, notices, référentiel réglementaire.',
    grants: [
      ...COMPLIANCE_CORE,
      'assessment:override',
      'fria:manage',
      'dpia:manage',
      'notice:validate',
      'referential:manage',
    ],
  },
  AI_GOVERNANCE: {
    label: 'Référent IA',
    description: 'Pilotage du portefeuille, validation, reporting.',
    grants: [...COMPLIANCE_CORE],
  },
  RSSI: {
    label: 'RSSI',
    description: 'Sécurité, actifs, risques techniques, contrôles.',
    grants: [
      ...READ_BASE,
      'aiSystem:update',
      'aiSystem:export',
      'catalog:manage',
      'obligation:update',
      'risk:manage',
      'action:manage',
      'document:upload',
      'approval:decide',
      'comment:write',
      'audit:read',
      'assistant:use',
    ],
  },
  IT: {
    label: 'DSI',
    description: 'Architecture, actifs, modèles, risques techniques.',
    grants: [
      ...READ_BASE,
      'aiSystem:update',
      'aiSystem:export',
      'catalog:manage',
      'obligation:update',
      'risk:manage',
      'action:manage',
      'document:upload',
      'approval:decide',
      'comment:write',
      'assistant:use',
    ],
  },
  SYSTEM_OWNER: {
    label: 'Propriétaire de SIA',
    description: 'Création et mise à jour de ses SIA, réponses aux questionnaires.',
    grants: [
      ...READ_BASE,
      'aiSystem:create',
      'aiSystem:update:own',
      'aiSystem:archive:own',
      'aiSystem:export',
      'catalog:manage',
      'assessment:run:own',
      'obligation:update:own',
      'risk:manage:own',
      'action:manage:own',
      'document:upload:own',
      'notice:manage:own',
      'comment:write',
      'assistant:use',
    ],
  },
  CONTRIBUTOR: {
    label: 'Contributeur',
    description: 'Modification des sections qui lui sont affectées.',
    grants: [
      'aiSystem:read',
      'user:read',
      'aiSystem:update:assigned',
      'document:upload:assigned',
      'comment:write',
      'assistant:use',
    ],
  },
  REVIEWER: {
    label: 'Validateur',
    description: 'Approbation ou rejet avec commentaire.',
    grants: [...READ_BASE, 'aiSystem:export', 'approval:decide', 'comment:write'],
  },
  AUDITOR: {
    label: 'Auditeur',
    description: 'Lecture, export et consultation du journal d’audit. Aucune modification.',
    grants: [...READ_BASE, 'aiSystem:export', 'audit:read'],
  },
  READER: {
    label: 'Lecteur',
    description: 'Lecture et export. Aucune modification.',
    grants: [...READ_BASE, 'aiSystem:export'],
  },
};

export interface ParsedGrant {
  permission: Permission;
  qualifier: Qualifier;
}

export function parseGrant(grant: string): ParsedGrant | null {
  const parts = grant.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const permission = `${parts[0]}:${parts[1]}`;
  if (!(PERMISSIONS as readonly string[]).includes(permission)) return null;
  const q = parts[2] ?? 'all';
  if (q !== 'all' && q !== 'own' && q !== 'assigned') return null;
  return { permission: permission as Permission, qualifier: q };
}

/** Permissions "en lecture seule" : aucun rôle ne disposant que de celles-ci ne peut écrire. */
export const READ_ONLY_PERMISSIONS: readonly Permission[] = [
  'aiSystem:read',
  'aiSystem:export',
  'report:read',
  'audit:read',
  'user:read',
];
