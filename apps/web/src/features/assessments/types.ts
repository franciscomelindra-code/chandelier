import type { Answers, EvaluationResult } from '@chandelier/shared';

export interface AssessmentOverrideView {
  id: string;
  dimension: string;
  previousValue: string;
  newValue: string;
  justification: string;
  author: string;
  createdAt: string;
}

export interface AssessmentDetail {
  id: string;
  aiSystemId: string;
  status: 'DRAFT' | 'COMPLETED' | 'VALIDATED' | 'SUPERSEDED';
  framework: { id: string; key: string; version: string; label: string };
  answers: Answers;
  computedResult: EvaluationResult | null;
  effectiveResult: (EvaluationResult & { overridden: string[] }) | null;
  computedCategory: string | null;
  effectiveCategory: string | null;
  computedAt: string | null;
  computedBy: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  createdAt: string;
  createdBy: string | null;
  overrides: AssessmentOverrideView[];
  preview: EvaluationResult | null;
  suggestions: Record<string, { value: string; source: string }>;
  isCurrent: boolean;
}

export interface AssessmentSummary {
  id: string;
  status: AssessmentDetail['status'];
  framework: { id: string; version: string };
  effectiveCategory: string | null;
  computedCategory: string | null;
  computedAt: string | null;
  computedBy: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  overrideCount: number;
  isCurrent: boolean;
  createdAt: string;
}

export interface ObligationView {
  id: string;
  templateKey: string;
  frameworkVersion: string;
  sourceRuleIds: string[];
  legalBasis: string;
  title: string;
  description: string;
  category: string;
  applicability: 'YES' | 'NO' | 'TO_CONFIRM';
  status: string;
  responsibleId: string | null;
  responsible: string | null;
  targetDate: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  comment: string;
}
