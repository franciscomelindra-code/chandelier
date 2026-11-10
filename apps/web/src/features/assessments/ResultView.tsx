import {
  DIMENSIONS,
  DIMENSION_LABELS,
  DIMENSION_VALUE_META,
  OBLIGATION_CATEGORY_LABELS,
  type DimensionResult,
  type EvaluationResult,
} from '@chandelier/shared';
import { formatDate } from '../../lib/format';
import { Alert, Badge } from '../../components/ui';
import { RiskBadge } from '../ai-systems/badges';

const fmtAnswer = (v: string | string[] | null) =>
  v === null
    ? 'non renseigné'
    : Array.isArray(v)
      ? v.join(', ')
      : ({ YES: 'Oui', NO: 'Non', UNKNOWN: 'Je ne sais pas' }[v] ?? v);

export function DimensionValue({ value }: { value: string }) {
  if (!value) return <Badge tone="gray">À déterminer</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {value.split(',').map((v) => {
        const m = DIMENSION_VALUE_META[v];
        return (
          <Badge key={v} tone={m?.tone ?? 'gray'}>
            {m?.label ?? v}
          </Badge>
        );
      })}
    </span>
  );
}

function DimensionCard({
  name,
  d,
  overridden,
}: {
  name: (typeof DIMENSIONS)[number];
  d: DimensionResult;
  overridden: boolean;
}) {
  return (
    <div className="rounded-xl border border-grey-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-grey-700">{DIMENSION_LABELS[name]}</h4>
        <span className="flex items-center gap-1">
          <DimensionValue value={name === 'roles' ? d.values.join(',') || 'UNDETERMINED' : d.value} />
          {overridden && <Badge tone="yellow">Surchargé</Badge>}
        </span>
      </div>
      {d.rules.length > 0 && (
        <ul className="mt-2 space-y-2">
          {d.rules.map((r) => (
            <li key={r.ruleId} className="rounded-lg bg-grey-50 p-2 text-xs">
              <p>
                <span className="font-mono font-bold">{r.ruleId}</span> ·{' '}
                <span className="font-semibold">{r.legalBasis}</span>
                {r.effectiveFrom > new Date().toISOString().slice(0, 10) && (
                  <span className="ml-1">
                    <Badge tone="blue">applicable au {formatDate(r.effectiveFrom)}</Badge>
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-grey-700">{r.explanation}</p>
              {Object.keys(r.answers).length > 0 && (
                <p className="mt-0.5 text-grey-500">
                  Réponses déterminantes :{' '}
                  {Object.entries(r.answers)
                    .map(([q, v]) => `${q} = ${fmtAnswer(v)}`)
                    .join(' ; ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {overridden && d.rules.length === 0 && (
        <p className="mt-2 text-xs text-grey-600">
          Valeur fixée par surcharge juridique (voir historique des surcharges).
        </p>
      )}
    </div>
  );
}

/** Restitution explicable : résultat, justification, règles, fondements, réponses, manquants, obligations. */
export function ResultView({
  result,
  meta,
  overridden = [],
  showObligations = true,
}: {
  result: EvaluationResult;
  meta?: { version: string; date: string | null; author: string | null };
  overridden?: string[];
  showObligations?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gls-blue-050 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-grey-700">Catégorie d’affichage :</span>
          <RiskBadge value={result.displayCategory} />
          {overridden.includes('displayCategory') && <Badge tone="yellow">Surchargée</Badge>}
        </div>
        <p className="mt-1 text-sm">{result.displayJustification}</p>
        {meta && (
          <p className="mt-2 text-xs text-grey-600">
            Référentiel {result.frameworkKey} v{meta.version} · évalué le {formatDate(meta.date ?? result.evaluatedAt)}
            {meta.author ? ` par ${meta.author}` : ''}
          </p>
        )}
        <p className="mt-1 text-xs text-grey-500">
          La catégorie est un résumé d’affichage : le raisonnement juridique figure dimension par dimension ci-dessous.
        </p>
      </div>

      {result.missing.length > 0 && (
        <Alert tone="gray" title={`Informations manquantes (${result.missing.length})`}>
          <ul className="mt-1 list-disc pl-5">
            {result.missing.map((m) => (
              <li key={m.questionId}>
                <span className="font-mono">{m.questionId}</span> — {m.text}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {DIMENSIONS.map((d) => (
          <DimensionCard key={d} name={d} d={result.dimensions[d]} overridden={overridden.includes(d)} />
        ))}
      </div>

      {showObligations && (
        <div>
          <h4 className="mb-2 text-sm font-bold text-grey-700">
            Obligations déclenchées ({result.obligations.length})
          </h4>
          {result.obligations.length === 0 ? (
            <p className="text-sm text-grey-500">Aucune.</p>
          ) : (
            <ul className="divide-y divide-grey-100 text-sm">
              {result.obligations.map((o) => (
                <li key={o.key} className="py-1.5">
                  <span className="font-semibold">{o.title}</span>{' '}
                  <span className="text-grey-500">— {o.legalBasis}</span>{' '}
                  <Badge tone="gray">{OBLIGATION_CATEGORY_LABELS[o.category] ?? o.category}</Badge>{' '}
                  {o.applicability === 'TO_CONFIRM' && <Badge tone="gray">À confirmer (rôle)</Badge>}{' '}
                  {o.upcoming && <Badge tone="blue">À venir : {formatDate(o.effectiveFrom)}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
