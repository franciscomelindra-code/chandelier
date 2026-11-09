import {
  AI_ACT_ROLE_LABELS,
  AI_SYSTEM_STATUS_META,
  COMPLIANCE_STATUS_META,
  RISK_CATEGORY_META,
  VALUE_LEVEL_META,
  type AiActRole,
  type AiSystemStatus,
  type ComplianceStatus,
  type RiskDisplayCategory,
  type ValueLevel,
} from '@chandelier/shared';
import clsx from 'clsx';
import { Badge } from '../../components/ui';

export const StatusBadge = ({ value }: { value: string }) => {
  const m = AI_SYSTEM_STATUS_META[value as AiSystemStatus];
  return <Badge tone={m?.tone ?? 'gray'}>{m?.label ?? value}</Badge>;
};

export const RiskBadge = ({ value }: { value: string }) => {
  const m = RISK_CATEGORY_META[value as RiskDisplayCategory];
  return <Badge tone={m?.tone ?? 'gray'}>{m?.label ?? value}</Badge>;
};

export const ValueBadge = ({ value }: { value: string }) => {
  const m = VALUE_LEVEL_META[value as ValueLevel];
  return <Badge tone={m?.tone ?? 'gray'}>{m?.label ?? value}</Badge>;
};

export const ComplianceBadge = ({ value }: { value: string }) => {
  const m = COMPLIANCE_STATUS_META[value as ComplianceStatus];
  return <Badge tone={m?.tone ?? 'gray'}>{m?.label ?? value}</Badge>;
};

export const rolesLabel = (roles: string[]) =>
  roles.length ? roles.map((r) => AI_ACT_ROLE_LABELS[r as AiActRole] ?? r).join(', ') : '—';

/** Jauge de complétude : rouge < 40, orange < 70, jaune < 100, vert = 100. */
export function CompletenessBar({ value, compact = false }: { value: number; compact?: boolean }) {
  const color =
    value >= 100
      ? 'bg-tone-green-fg'
      : value >= 70
        ? 'bg-gls-yellow'
        : value >= 40
          ? 'bg-gls-orange'
          : 'bg-tone-red-fg';
  return (
    <div className="flex items-center gap-2" title={`Complétude : ${value} %`}>
      <div
        className={clsx('h-2 overflow-hidden rounded-full bg-grey-200', compact ? 'w-16' : 'w-32')}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Complétude"
      >
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-grey-600">{value} %</span>
    </div>
  );
}
