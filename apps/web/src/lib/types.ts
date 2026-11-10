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
  models: { id: string; name: string; version: string }[];
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
  valueDetails: Record<string, string>;
  raciEnabled: boolean;
  modelLinks: ModelLink[];
  vendorLinks: {
    relation: string;
    notes: string;
    vendor: { id: string; name: string; country: string; dpaSigned: string };
  }[];
  stakeholders: {
    id: string;
    function: string;
    responsibility: string;
    access: string;
    raci: string | null;
    stakeholder: { id: string; name: string; kind: string; organization: string; contact: string };
  }[];
  assets: {
    dependency: string;
    asset: { id: string; name: string; type: string; criticality: string | null; location: string };
  }[];
  processing: {
    notes: string;
    processingActivity: { id: string; reference: string; name: string; legalBasis: string; dpiaRequired: string };
  }[];
  datasets: {
    usages: string[];
    notes: string;
    dataset: {
      id: string;
      name: string;
      origin: string;
      containsPersonalData: string;
      containsSpecialCategories: string;
      containsCriminalData: string;
      isSynthetic: boolean;
      transfersOutsideEu: string;
    };
  }[];
  dataCategories: { id: string; label: string; isSpecial: boolean; isCriminal: boolean }[];
  dataSubjects: { id: string; label: string; isVulnerable: boolean; volumeEstimate: string; consequences: string }[];
  permissions: { updatableSections: string[]; canArchive: boolean; canExport: boolean };
}

export interface Vendor {
  id: string;
  name: string;
  legalName: string;
  country: string;
  website: string;
  description: string;
  dpaSigned: string;
  isActive: boolean;
  usage: number;
  modelCount: number;
}

export interface AiModel {
  id: string;
  name: string;
  vendorId: string | null;
  vendor: { id: string; name: string } | null;
  family: string;
  version: string;
  type: string;
  description: string;
  capabilities: string;
  knownLimitations: string;
  accessMode: string;
  hosting: string;
  regions: string[];
  documentationUrl: string;
  knowledgeDate: string | null;
  versionDate: string | null;
  status: string;
  isGpai: string;
  gpaiSystemicRisk: string;
  gpaiNotes: string;
  license: string;
  isDemo: boolean;
  usage: number;
}

export interface AiModelDetail extends AiModel {
  systems: {
    linkId: string;
    usageDescription: string;
    versionUsed: string;
    hostingMode: string | null;
    isPrimary: boolean;
    system: { id: string; reference: string; name: string; status: string; archivedAt: string | null };
  }[];
  hiddenSystems: number;
}

export interface ModelLink {
  id: string;
  usageDescription: string;
  versionUsed: string;
  hostingMode: string | null;
  integrationDate: string | null;
  isPrimary: boolean;
  model: {
    id: string;
    name: string;
    version: string;
    type: string;
    accessMode: string;
    status: string;
    isGpai: string;
    gpaiSystemicRisk: string;
    vendor: { id: string; name: string } | null;
  };
}

export interface Stakeholder {
  id: string;
  kind: string;
  name: string;
  organization: string;
  contact: string;
  userId: string | null;
  usage: number;
}
export interface Asset {
  id: string;
  name: string;
  type: string;
  description: string;
  location: string;
  criticality: string | null;
  usage: number;
}
export interface ProcessingActivity {
  id: string;
  reference: string;
  name: string;
  purpose: string;
  legalBasis: string;
  gdprRole: string;
  dpiaRequired: string;
  retention: string;
  externalRef: string;
  dataCategoryIds: string[];
  dataSubjectIds: string[];
  usage: number;
}
export interface Dataset {
  id: string;
  name: string;
  description: string;
  origin: string;
  dataType: string;
  containsPersonalData: string;
  containsSpecialCategories: string;
  containsCriminalData: string;
  isSynthetic: boolean;
  provenance: string;
  license: string;
  qualityNotes: string;
  representativenessNotes: string;
  retention: string;
  storageLocation: string;
  transfersOutsideEu: string;
  recipients: string;
  usage: number;
}
export interface RefCategory {
  id: string;
  key: string;
  label: string;
  isSpecial?: boolean;
  isCriminal?: boolean;
  isVulnerable?: boolean;
}
export interface SystemTemplate {
  id: string;
  name: string;
  description: string;
  fields: string[];
}
export interface Assignment {
  id: string;
  section: string;
  dueDate: string | null;
  user: { id: string; displayName: string };
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
