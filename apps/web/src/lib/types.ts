export interface Me {
  user: { id: string; email: string; displayName: string; orgUnitId: string | null; mustChangePassword: boolean };
  roles: { roleKey: string; orgUnitId: string | null; includeDescendants: boolean }[];
  permissions: string[];
  csrfToken: string;
  session: { idleMinutes: number; expiresAt: string };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserRole {
  roleKey: string;
  roleLabel: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  includeDescendants: boolean;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  isActive: boolean;
  authProvider: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  roles?: UserRole[];
}

export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  path: string;
  depth: number;
  isActive: boolean;
  isDemo: boolean;
  userCount: number;
  aiSystemCount: number;
}

export interface Role {
  key: string;
  label: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  assignmentCount: number;
}

export interface TagRef {
  id: string;
  label: string;
  color: string | null;
}

export interface Tag extends TagRef {
  usage: number;
}

export interface AiSystemListItem {
  id: string;
  reference: string;
  name: string;
  purpose: string;
  status: string;
  orgUnit: { id: string; name: string };
  owner: { id: string; displayName: string } | null;
  businessOwner: { id: string; displayName: string } | null;
  aiActRoles: string[];
  riskCategory: string;
  valueLevel: string;
  complianceStatus: string;
  completeness: number;
  nextReviewDate: string | null;
  tags: TagRef[];
  vendors: string[];
  isDemo: boolean;
  archivedAt: string | null;
  updatedAt: string;
  canUpdate: boolean;
  canArchive: boolean;
}

export interface CompletenessCheck {
  key: string;
  label: string;
  section: string;
  ok: boolean;
}

export interface AiSystemDetail extends Omit<AiSystemListItem, 'owner' | 'businessOwner'> {
  owner: { id: string; displayName: string; email: string } | null;
  businessOwner: { id: string; displayName: string; email: string } | null;
  description: string;
  objectives: string;
  useCases: string;
  functioning: string;
  scope: string;
  operationalContext: string;
  countries: string[];
  targetPopulations: string;
  autonomyLevel: string;
  firstDeploymentDate: string | null;
  productionDate: string | null;
  plannedRetirementDate: string | null;
  actualRetirementDate: string | null;
  processesPersonalData: string;
  includesMinors: string;
  includesVulnerable: string;
  affectedVolumeEstimate: string;
  potentialConsequences: string;
  valueJustification: string;
  riskJustification: string;
  archiveReason: string | null;
  version: number;
  createdAt: string;
  completenessChecks: CompletenessCheck[];
  permissions: { updatableSections: string[]; canArchive: boolean; canExport: boolean };
}

export interface SavedView {
  id: string;
  name: string;
  scope: string;
  state: { query: string; columns: string[]; layout: 'table' | 'cards' };
  isShared: boolean;
  ownerName: string;
  mine: boolean;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorLabel: string;
  origin: string;
  action: string;
  entityType: string;
  entityId: string | null;
  aiSystemId: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  justification: string | null;
  requestId: string | null;
}
