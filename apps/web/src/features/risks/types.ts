import type { MethodologyConfig, Tone } from '@chandelier/shared';

export interface LevelView {
  level: string;
  label: string;
  tone: Tone;
}

export interface Methodology {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
  config: MethodologyConfig;
  riskCount: number;
  createdAt: string;
}

export interface RiskMeasureView {
  id: string;
  title: string;
  type: string;
  status: string;
  isExisting: boolean;
  dueDate: string | null;
  owner: string | null;
}

export interface RiskActionView {
  id: string;
  reference: string;
  title: string;
  status: string;
  dueDate: string | null;
  assignee: string | null;
}

export interface Risk {
  id: string;
  reference: string;
  aiSystem: { id: string; reference: string; name: string; isDemo: boolean };
  methodology: { id: string; name: string; version: number; isActive: boolean };
  category: string;
  title: string;
  scenario: string;
  cause: string;
  event: string;
  consequence: string;
  inherentLikelihood: number | null;
  inherentSeverity: number | null;
  inherentScore: number | null;
  inherentLevel: LevelView | null;
  residualLikelihood: number | null;
  residualSeverity: number | null;
  residualScore: number | null;
  residualLevel: LevelView | null;
  effectiveScore: number | null;
  effectiveLevel: LevelView | null;
  treatment: string | null;
  treatmentPlan: string;
  acceptanceJustification: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  status: string;
  owner: { id: string; displayName: string } | null;
  dueDate: string | null;
  version: number;
  measures: RiskMeasureView[];
  actions: RiskActionView[];
  openActions: number;
  evidences: { id: string; title: string; type: string; archivedAt: string | null }[];
  warnings: { code: string; message: string }[];
  createdAt: string;
  updatedAt: string;
  permissions?: { canManage: boolean; canAccept: boolean };
}

export interface Heatmap {
  cells: Record<string, number>;
  excluded: number;
  basis: string;
}

export interface Measure {
  id: string;
  aiSystemId: string;
  title: string;
  description: string;
  type: string;
  status: string;
  isExisting: boolean;
  owner: { id: string; displayName: string } | null;
  dueDate: string | null;
  risks: { id: string; reference: string; title: string }[];
  updatedAt: string;
}

export interface ActionView {
  id: string;
  reference: string;
  title: string;
  description: string;
  status: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  assignee: { id: string; displayName: string } | null;
  dueDate: string | null;
  overdue: boolean;
  completedAt: string | null;
  closureComment: string;
  aiSystem: { id: string; reference: string; name: string; isDemo: boolean };
  risk: { id: string; reference: string; title: string } | null;
  obligation: { id: string; templateKey: string; title: string } | null;
  measure: { id: string; title: string } | null;
  origin: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  permissions?: { canManage: boolean; canUpdateStatus: boolean };
}
