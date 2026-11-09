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
