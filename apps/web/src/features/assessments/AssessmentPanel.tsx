import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ASSESSMENT_STATUS_META,
  OVERRIDABLE,
  OVERRIDE_LABELS,
  DIMENSION_VALUE_META,
  RISK_CATEGORY_META,
  evaluate,
  frameworkSchema,
  isVisible,
  type Answers,
  type Framework,
  type Question,
  type RiskDisplayCategory,
} from '@chandelier/shared';
import { ApiError, api, errorMessage, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime } from '../../lib/format';
import type { AiSystemDetail } from '../../lib/types';
import { Alert, Badge, Button, Card, SelectField, Spinner, TextField } from '../../components/ui';
import { ResultView } from './ResultView';
import { ObligationsPanel } from './ObligationsPanel';
import type { AssessmentDetail, AssessmentSummary } from './types';

function useFramework(id: string | undefined) {
  return useQuery({
    queryKey: ['framework', id],
    enabled: !!id,
    staleTime: Infinity,
    queryFn: async () =>
      frameworkSchema.parse((await get<{ content: unknown }>(`/api/v1/regulatory-frameworks/${id}`)).content),
  });
}

const TRI: [string, string][] = [
  ['YES', 'Oui'],
  ['NO', 'Non'],
  ['UNKNOWN', 'Je ne sais pas'],
];

function QuestionField({
  q,
  value,
  onChange,
  suggestion,
  disabled,
}: {
  q: Question;
  value: Answers[string];
  onChange: (v: string | string[] | null) => void;
  suggestion?: { value: string; source: string };
  disabled: boolean;
}) {
  const missing =
    q.determinant && (value === undefined || value === 'UNKNOWN' || (Array.isArray(value) && !value.length));
  return (
    <fieldset
      className={clsx('rounded-xl border p-3', missing ? 'border-grey-300 bg-grey-50' : 'border-grey-200 bg-white')}
    >
      <legend className="sr-only">{q.text}</legend>
      <p className="text-sm font-semibold text-ink">
        <span className="mr-1 font-mono text-xs text-grey-500">{q.id}</span>
        {q.text}
      </p>
      <p className="mt-0.5 text-xs text-gls-blue">{q.legalBasis}</p>
      {q.help && <p className="mt-1 text-xs text-grey-600">{q.help}</p>}
      {suggestion && value === undefined && !disabled && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-tone-yellow-bg px-2 py-1 text-xs">
          <span>
            Proposition à vérifier :{' '}
            <strong>{TRI.find(([k]) => k === suggestion.value)?.[1] ?? suggestion.value}</strong> ({suggestion.source})
          </span>
          <Button size="sm" variant="secondary" onClick={() => onChange(suggestion.value)}>
            Appliquer
          </Button>
        </div>
      )}
      {q.type === 'tri' ? (
        <div role="radiogroup" aria-label={q.text} className="mt-2 flex flex-wrap gap-2">
          {TRI.map(([v, l]) => (
            <label
              key={v}
              className={clsx(
                'cursor-pointer rounded-full border px-3 py-1 text-sm',
                value === v
                  ? 'border-gls-blue bg-gls-blue text-white'
                  : 'border-grey-300 bg-white hover:bg-gls-blue-050',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={q.id}
                value={v}
                checked={value === v}
                disabled={disabled}
                onChange={() => onChange(v)}
              />
              {l}
            </label>
          ))}
          {value !== undefined && !disabled && (
            <button type="button" className="text-xs text-grey-500 underline" onClick={() => onChange(null)}>
              Effacer
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          {q.options!.map((o) => {
            const cur = (value as string[] | undefined) ?? [];
            return (
              <label key={o.value} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={disabled}
                  checked={cur.includes(o.value)}
                  onChange={(e) => {
                    // « Aucun » est exclusif.
                    let next = e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value);
                    if (e.target.checked) next = o.value === 'NONE' ? ['NONE'] : next.filter((x) => x !== 'NONE');
                    onChange(next.length ? next : null);
                  }}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/** Questionnaire d'un brouillon : enregistrement progressif, aperçu calculé localement par le même moteur que le serveur. */
function DraftEditor({
  s,
  a,
  fw,
  canRun,
  onChanged,
}: {
  s: AiSystemDetail;
  a: AssessmentDetail;
  fw: Framework;
  canRun: boolean;
  onChanged: (d: AssessmentDetail) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(a.answers);
  const [pending, setPending] = useState<Answers>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState(fw.sections[0]!.id);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = async (batch: Answers) => {
    if (!Object.keys(batch).length) return;
    setSaveState('saving');
    try {
      const d = await api<AssessmentDetail>('PATCH', `/api/v1/ai-systems/${s.id}/assessments/${a.id}`, {
        answers: batch,
      });
      setSaveState('saved');
      setError(null);
      onChanged(d);
    } catch (e) {
      setSaveState('error');
      setError(errorMessage(e));
    }
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const change = (qid: string, v: string | string[] | null) => {
    const next = { ...answers };
    if (v === null) delete next[qid];
    else next[qid] = v;
    setAnswers(next);
    const batch = { ...pending, [qid]: v };
    setPending(batch as Answers);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPending({});
      void flush(batch as Answers);
    }, 600);
  };

  const preview = useMemo(() => evaluate(fw, answers), [fw, answers]);
  const complete = useMutation({
    mutationFn: async () => {
      if (timer.current) clearTimeout(timer.current);
      await flush(pending);
      setPending({});
      return post<AssessmentDetail>(`/api/v1/ai-systems/${s.id}/assessments/${a.id}/complete`);
    },
    onSuccess: onChanged,
    onError: (e) => setError(errorMessage(e)),
  });

  const visibleQs = fw.questions.filter((q) => isVisible(q, answers, fw.definitions));
  const sectionQs = visibleQs.filter((q) => q.section === section);
  const missingBySection = (id: string) => preview.missing.filter((m) => m.section === id).length;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-4">
      <div>
        <nav aria-label="Sections du questionnaire" className="mb-3 flex flex-wrap gap-1">
          {fw.sections.map((sec) => (
            <button
              key={sec.id}
              type="button"
              aria-current={sec.id === section ? 'step' : undefined}
              onClick={() => setSection(sec.id)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-bold',
                sec.id === section ? 'bg-gls-blue text-white' : 'bg-grey-100 text-grey-700 hover:bg-gls-blue-050',
              )}
            >
              {sec.title}
              {missingBySection(sec.id) > 0 && (
                <span className="ml-1 rounded-full bg-white/30 px-1">{missingBySection(sec.id)}</span>
              )}
            </button>
          ))}
        </nav>
        <p className="mb-3 text-xs text-grey-600">{fw.sections.find((x) => x.id === section)?.description}</p>
        <div className="space-y-3">
          {sectionQs.map((q) => (
            <QuestionField
              key={q.id}
              q={q}
              value={answers[q.id]}
              suggestion={a.suggestions[q.id]}
              disabled={!canRun}
              onChange={(v) => change(q.id, v)}
            />
          ))}
        </div>
        <div className="no-print sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-grey-200 bg-white px-4 py-3 shadow-pop">
          <span className="text-xs text-grey-600" role="status">
            {saveState === 'saving'
              ? 'Enregistrement…'
              : saveState === 'saved'
                ? 'Réponses enregistrées'
                : saveState === 'error'
                  ? ''
                  : 'Les réponses sont enregistrées au fil de la saisie.'}
          </span>
          {error && (
            <span className="text-xs text-tone-red-fg" role="alert">
              {error}
            </span>
          )}
          {canRun && (
            <Button className="ml-auto" disabled={complete.isPending} onClick={() => complete.mutate()}>
              Calculer et enregistrer le résultat
            </Button>
          )}
        </div>
      </div>
      <aside className="mt-4 lg:mt-0">
        <h3 className="mb-2 text-base">Aperçu en direct (non enregistré)</h3>
        <ResultView result={preview} showObligations />
      </aside>
    </div>
  );
}

function OverrideForm({
  s,
  a,
  onDone,
}: {
  s: AiSystemDetail;
  a: AssessmentDetail;
  onDone: (d: AssessmentDetail) => void;
}) {
  const [dimension, setDimension] = useState('displayCategory');
  const [value, setValue] = useState('');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      post<AssessmentDetail>(`/api/v1/ai-systems/${s.id}/assessments/${a.id}/overrides`, {
        dimension,
        value,
        justification,
      }),
    onSuccess: (d) => {
      setJustification('');
      setValue('');
      setError(null);
      onDone(d);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const label = (v: string) =>
    dimension === 'displayCategory'
      ? (RISK_CATEGORY_META[v as RiskDisplayCategory]?.label ?? v)
      : (DIMENSION_VALUE_META[v]?.label ?? v);
  return (
    <details className="rounded-xl border border-dashed border-grey-300 p-3">
      <summary className="cursor-pointer text-sm font-bold text-gls-blue">Surcharger une conclusion (juriste)</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-grey-600">
          Le résultat calculé reste visible et inchangé. La surcharge est historisée de manière immuable, avec son
          auteur et sa justification ; elle invalide une validation antérieure.
        </p>
        {error && <Alert tone="red">{error}</Alert>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SelectField
            label="Conclusion"
            value={dimension}
            onChange={(e) => (setDimension(e.target.value), setValue(''))}
          >
            {Object.keys(OVERRIDABLE).map((d) => (
              <option key={d} value={d}>
                {OVERRIDE_LABELS[d]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Nouvelle valeur" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">— Choisir —</option>
            {OVERRIDABLE[dimension]!.map((v) => (
              <option key={v} value={v}>
                {label(v)}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField
          label="Justification juridique"
          required
          hint="20 caractères minimum."
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!value || justification.trim().length < 20 || m.isPending}
          onClick={() => m.mutate()}
        >
          Enregistrer la surcharge
        </Button>
      </div>
    </details>
  );
}

export function AssessmentPanel({ s }: { s: AiSystemDetail }) {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['assessments', s.id],
    queryFn: () => get<{ items: AssessmentSummary[]; canRun: boolean }>(`/api/v1/ai-systems/${s.id}/assessments`),
  });
  const draft = list.data?.items.find((x) => x.status === 'DRAFT');
  const current = list.data?.items.find((x) => x.isCurrent);
  const [selected, setSelected] = useState<string | null>(null);
  const shownId = selected ?? draft?.id ?? current?.id;
  const detail = useQuery({
    queryKey: ['assessment', shownId],
    enabled: !!shownId,
    queryFn: () => get<AssessmentDetail>(`/api/v1/ai-systems/${s.id}/assessments/${shownId}`),
  });
  const fw = useFramework(detail.data?.framework.id);
  const refreshAll = (d?: AssessmentDetail) => {
    if (d) qc.setQueryData(['assessment', d.id], d);
    void qc.invalidateQueries({ queryKey: ['assessments', s.id] });
    if (d && d.status !== 'DRAFT') {
      void qc.invalidateQueries({ queryKey: ['ai-system', s.id] });
      void qc.invalidateQueries({ queryKey: ['obligations', s.id] });
      void qc.invalidateQueries({ queryKey: ['ai-system-history', s.id] });
    }
  };
  const start = useMutation({
    mutationFn: () => post<AssessmentDetail>(`/api/v1/ai-systems/${s.id}/assessments`),
    onSuccess: (d) => {
      setSelected(null);
      refreshAll(d);
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? 'Un brouillon existe déjà.' : errorMessage(e)),
  });
  const validate = useMutation({
    mutationFn: () =>
      post<AssessmentDetail>(`/api/v1/ai-systems/${s.id}/assessments/${shownId}/validate`, { comment: '' }),
    onSuccess: refreshAll,
    onError: (e) => setError(errorMessage(e)),
  });

  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert tone="red">{errorMessage(list.error)}</Alert>;
  const canRun = !!list.data.canRun && !s.archivedAt;
  const a = detail.data;
  const myName = me?.user.displayName;

  return (
    <div className="space-y-4">
      {fw.data && (
        <Alert tone="yellow" title={`Référentiel ${fw.data.key} v${fw.data.version}`}>
          {fw.data.disclaimer}
        </Alert>
      )}
      {error && <Alert tone="red">{error}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Évaluations :</span>
            {list.data.items.length === 0 && <span className="text-grey-500">aucune</span>}
            {list.data.items.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setSelected(x.id)}
                className={clsx(
                  'rounded-full border px-2 py-0.5 text-xs',
                  x.id === shownId ? 'border-gls-blue bg-gls-blue-050 font-bold' : 'border-grey-300',
                )}
              >
                {formatDate(x.computedAt ?? x.createdAt)} · {ASSESSMENT_STATUS_META[x.status]?.label}
                {x.isCurrent ? ' · courante' : ''}
              </button>
            ))}
          </div>
          {canRun && !draft && (
            <Button size="sm" disabled={start.isPending} onClick={() => start.mutate()}>
              {current ? 'Réévaluer (nouvelle qualification)' : 'Démarrer la qualification'}
            </Button>
          )}
        </div>
        {!canRun && !a && (
          <p className="mt-2 text-sm text-grey-500">
            Aucune qualification ; vous n’avez pas le droit d’en démarrer une sur ce SIA.
          </p>
        )}
      </Card>

      {a && fw.data && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-base">Qualification du {formatDate(a.computedAt ?? a.createdAt)}</h3>
            <Badge tone={ASSESSMENT_STATUS_META[a.status]?.tone ?? 'gray'}>
              {ASSESSMENT_STATUS_META[a.status]?.label}
            </Badge>
            {a.validatedAt && (
              <span className="text-xs text-grey-600">
                validée le {formatDateTime(a.validatedAt)} par {a.validatedBy}
              </span>
            )}
          </div>
          {a.status === 'DRAFT' ? (
            <DraftEditor key={a.id} s={s} a={a} fw={fw.data} canRun={canRun} onChanged={refreshAll} />
          ) : a.effectiveResult ? (
            <div className="space-y-4">
              {a.overrides.length > 0 && a.computedResult && (
                <Alert tone="yellow" title="Résultat effectif après surcharge juridique">
                  Résultat calculé par le moteur :{' '}
                  <strong>{RISK_CATEGORY_META[a.computedResult.displayCategory]?.label}</strong>.
                </Alert>
              )}
              <ResultView
                result={a.effectiveResult}
                overridden={a.effectiveResult.overridden}
                meta={{ version: a.framework.version, date: a.computedAt, author: a.computedBy }}
                showObligations={false}
              />
              {a.overrides.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-bold text-grey-700">Historique des surcharges</h4>
                  <ol className="space-y-2 text-sm">
                    {a.overrides.map((o) => (
                      <li key={o.id} className="rounded-lg bg-tone-yellow-bg p-2">
                        <p>
                          <strong>{OVERRIDE_LABELS[o.dimension] ?? o.dimension}</strong> : {String(o.previousValue)} →{' '}
                          {String(o.newValue)}
                        </p>
                        <p className="text-xs">
                          « {o.justification} » — {o.author}, {formatDateTime(o.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {a.isCurrent && can('assessment:override') && a.status !== 'SUPERSEDED' && !s.archivedAt && (
                <OverrideForm s={s} a={a} onDone={refreshAll} />
              )}
              {a.isCurrent && a.status === 'COMPLETED' && can('assessment:validate') && !s.archivedAt && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={validate.isPending || a.computedBy === myName}
                    onClick={() => validate.mutate()}
                  >
                    Valider la qualification
                  </Button>
                  {a.computedBy === myName && (
                    <span className="text-xs text-grey-500">
                      Principe des quatre yeux : une autre personne que l’auteur du calcul doit valider.
                    </span>
                  )}
                </div>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-gls-blue">Réponses enregistrées</summary>
                <ul className="mt-2 space-y-1 text-xs">
                  {fw.data.questions
                    .filter((q) => a.answers[q.id] !== undefined)
                    .map((q) => (
                      <li key={q.id}>
                        <span className="font-mono">{q.id}</span> {q.text} — <strong>{String(a.answers[q.id])}</strong>
                        {!isVisible(q, a.answers, fw.data!.definitions) && (
                          <span className="text-grey-500"> (question masquée : non prise en compte)</span>
                        )}
                      </li>
                    ))}
                </ul>
              </details>
            </div>
          ) : null}
        </Card>
      )}
      {detail.isPending && shownId && <Spinner />}

      <ObligationsPanel s={s} />
    </div>
  );
}
