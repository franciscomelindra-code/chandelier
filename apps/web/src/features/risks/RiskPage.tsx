import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MEASURE_STATUS_META,
  MEASURE_STATUSES,
  MEASURE_TYPE_LABELS,
  MEASURE_TYPES,
  RISK_STATUS_META,
  RISK_STATUSES,
  RISK_TREATMENT_LABELS,
  RISK_TREATMENTS,
  RISK_TYPE_LABELS,
  RISK_TYPES,
  levelOf,
  type MeasureStatus,
  type RiskStatus,
  type RiskType,
} from '@chandelier/shared';
import { api, errorMessage, get, post } from '../../lib/api';
import { formatDate, formatDateTime, formatValue } from '../../lib/format';
import { useActiveUsers } from '../../lib/queries';
import { Alert, Badge, Button, Card, EmptyState, SelectField, Spinner, TextField } from '../../components/ui';
import { NewActionModal } from '../actions/ActionForm';
import { ActionsTable } from '../actions/ActionsTable';
import { LevelBadge } from './RiskHeatmap';
import type { ActionView, Measure, Methodology, Risk } from './types';

export function useMethodologies() {
  return useQuery({
    queryKey: ['risk-methodologies'],
    queryFn: () => get<{ items: Methodology[] }>('/api/v1/risk-methodologies'),
    staleTime: 30_000,
  });
}

function Area({
  label,
  value,
  onChange,
  disabled,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  rows?: number;
}) {
  const id = `f-${label.replace(/\W+/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-grey-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-grey-300 bg-white px-3 py-2 disabled:bg-grey-50"
      />
    </div>
  );
}

/** Sélecteur d'un niveau d'échelle (vraisemblance ou gravité) de la méthodologie du risque. */
function ScaleSelect({
  label,
  scale,
  value,
  onChange,
  disabled,
}: {
  label: string;
  scale: { value: number; label: string; description?: string | undefined }[];
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <SelectField
      label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">—</option>
      {scale.map((l) => (
        <option key={l.value} value={l.value} title={l.description}>
          {l.value}. {l.label}
        </option>
      ))}
    </SelectField>
  );
}

function draftOf(r: Risk) {
  return {
    category: r.category,
    title: r.title,
    scenario: r.scenario,
    cause: r.cause,
    event: r.event,
    consequence: r.consequence,
    inherentLikelihood: r.inherentLikelihood,
    inherentSeverity: r.inherentSeverity,
    residualLikelihood: r.residualLikelihood,
    residualSeverity: r.residualSeverity,
    treatment: r.treatment ?? '',
    treatmentPlan: r.treatmentPlan,
    acceptanceJustification: r.acceptanceJustification,
    status: r.status,
    ownerId: r.owner?.id ?? '',
    dueDate: r.dueDate ?? '',
  };
}

function RiskForm({ r, m }: { r: Risk; m: Methodology }) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const [d, setD] = useState(() => draftOf(r));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editable = !!r.permissions?.canManage;
  const scoresLocked = !r.methodology.isActive;
  const cfg = m.config;
  const inh = d.inherentLikelihood && d.inherentSeverity ? d.inherentLikelihood * d.inherentSeverity : null;
  const res = d.residualLikelihood && d.residualSeverity ? d.residualLikelihood * d.residualSeverity : null;
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        version: r.version,
        category: d.category,
        title: d.title,
        scenario: d.scenario,
        cause: d.cause,
        event: d.event,
        consequence: d.consequence,
        treatment: d.treatment || null,
        treatmentPlan: d.treatmentPlan,
        ownerId: d.ownerId || null,
        dueDate: d.dueDate || null,
      };
      if (!scoresLocked) {
        Object.assign(body, {
          inherentLikelihood: d.inherentLikelihood,
          inherentSeverity: d.inherentSeverity,
          residualLikelihood: d.residualLikelihood,
          residualSeverity: d.residualSeverity,
        });
      }
      if (d.status !== r.status) body.status = d.status;
      if (d.treatment === 'ACCEPT' && d.acceptanceJustification !== r.acceptanceJustification)
        body.acceptanceJustification = d.acceptanceJustification;
      return api<Risk>('PATCH', `/api/v1/risks/${r.id}`, body);
    },
    onSuccess: (next) => {
      qc.setQueryData(['risk', r.id], next);
      void qc.invalidateQueries({ queryKey: ['risks'] });
      void qc.invalidateQueries({ queryKey: ['risk-history', r.id] });
      setD(draftOf(next));
      setError(null);
      setSaved(true);
    },
    onError: (e) => {
      setError(errorMessage(e));
      setSaved(false);
    },
  });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setSaved(false);
    setD({ ...d, [k]: v });
  };
  return (
    <Card>
      <h2 className="mb-3 text-lg">Description et cotation</h2>
      {!editable && (
        <div className="mb-3">
          <Alert tone="gray">Lecture seule : droit de gestion des risques requis sur ce SIA.</Alert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SelectField
          label="Catégorie"
          value={d.category}
          disabled={!editable}
          onChange={(e) => set('category', e.target.value)}
        >
          {RISK_TYPES.map((c) => (
            <option key={c} value={c}>
              {RISK_TYPE_LABELS[c]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Intitulé"
          value={d.title}
          disabled={!editable}
          onChange={(e) => set('title', e.target.value)}
        />
        <div className="md:col-span-2">
          <Area label="Scénario" value={d.scenario} disabled={!editable} onChange={(v) => set('scenario', v)} />
        </div>
        <Area label="Cause" rows={2} value={d.cause} disabled={!editable} onChange={(v) => set('cause', v)} />
        <Area
          label="Événement redouté"
          rows={2}
          value={d.event}
          disabled={!editable}
          onChange={(v) => set('event', v)}
        />
        <div className="md:col-span-2">
          <Area
            label="Conséquences"
            rows={2}
            value={d.consequence}
            disabled={!editable}
            onChange={(v) => set('consequence', v)}
          />
        </div>
      </div>

      <h3 className="mt-5 mb-2 text-base">
        Cotation{' '}
        <span className="text-sm font-normal text-grey-500">
          — {m.name} v{m.version}
        </span>
      </h3>
      {scoresLocked && (
        <div className="mb-3">
          <Alert tone="orange" title="Méthodologie remplacée">
            Ce risque a été coté avec une version qui n’est plus active. Utilisez « Recoter » ci-dessous.
          </Alert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset className="rounded-xl border border-grey-200 p-3">
          <legend className="px-1 text-sm font-bold">Risque inhérent (sans mesure)</legend>
          <div className="grid grid-cols-2 gap-2">
            <ScaleSelect
              label="Vraisemblance"
              scale={cfg.likelihood}
              value={d.inherentLikelihood}
              disabled={!editable || scoresLocked}
              onChange={(v) => set('inherentLikelihood', v)}
            />
            <ScaleSelect
              label="Gravité"
              scale={cfg.severity}
              value={d.inherentSeverity}
              disabled={!editable || scoresLocked}
              onChange={(v) => set('inherentSeverity', v)}
            />
          </div>
          <p className="mt-2 text-sm">
            Score : <LevelBadge level={levelOf(cfg, inh)} score={inh} />
          </p>
        </fieldset>
        <fieldset className="rounded-xl border border-grey-200 p-3">
          <legend className="px-1 text-sm font-bold">Risque résiduel (mesures en place)</legend>
          <div className="grid grid-cols-2 gap-2">
            <ScaleSelect
              label="Vraisemblance"
              scale={cfg.likelihood}
              value={d.residualLikelihood}
              disabled={!editable || scoresLocked}
              onChange={(v) => set('residualLikelihood', v)}
            />
            <ScaleSelect
              label="Gravité"
              scale={cfg.severity}
              value={d.residualSeverity}
              disabled={!editable || scoresLocked}
              onChange={(v) => set('residualSeverity', v)}
            />
          </div>
          <p className="mt-2 text-sm">
            Score : <LevelBadge level={levelOf(cfg, res)} score={res} />
          </p>
        </fieldset>
      </div>
      <p className="mt-1 text-xs text-grey-500">
        Score = vraisemblance × gravité. Le résiduel ne peut dépasser l’inhérent sur aucun des deux axes ; une réduction
        sans mesure « en place » est signalée.
      </p>

      <h3 className="mt-5 mb-2 text-base">Traitement</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SelectField
          label="Décision de traitement"
          value={d.treatment}
          disabled={!editable}
          onChange={(e) => set('treatment', e.target.value)}
        >
          <option value="">—</option>
          {RISK_TREATMENTS.map((t) => (
            <option key={t} value={t}>
              {RISK_TREATMENT_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Statut"
          value={d.status}
          disabled={!editable}
          onChange={(e) => set('status', e.target.value)}
          hint="Mis à jour automatiquement selon la cotation et le traitement, sauf choix explicite."
        >
          {RISK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {RISK_STATUS_META[s].label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Propriétaire du risque"
          value={d.ownerId}
          disabled={!editable}
          onChange={(e) => set('ownerId', e.target.value)}
        >
          <option value="">—</option>
          {users.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Échéance de traitement"
          type="date"
          value={d.dueDate}
          disabled={!editable}
          onChange={(e) => set('dueDate', e.target.value)}
        />
        <div className="md:col-span-2">
          <Area
            label="Plan de traitement"
            value={d.treatmentPlan}
            disabled={!editable}
            onChange={(v) => set('treatmentPlan', v)}
          />
        </div>
        {d.treatment === 'ACCEPT' && (
          <div className="md:col-span-2">
            <Area
              label="Justification de l’acceptation (20 caractères minimum)"
              value={d.acceptanceJustification}
              disabled={!editable}
              onChange={(v) => set('acceptanceJustification', v)}
            />
            <p className="mt-1 text-xs text-grey-500">
              L’acceptation d’un risque du niveau le plus élevé est réservée aux rôles de validation (DPO, juridique,
              référent IA){r.permissions?.canAccept ? '' : ' : vous ne disposez pas de ce droit'}. Toute modification
              ultérieure de la cotation impose de renouveler la justification.
            </p>
            {r.acceptedAt && (
              <p className="mt-1 text-sm">
                <Badge tone="orange">
                  Accepté le {formatDate(r.acceptedAt)} par {r.acceptedBy}
                </Badge>
              </p>
            )}
          </div>
        )}
      </div>
      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
          <Button variant="ghost" onClick={() => (setD(draftOf(r)), setError(null))}>
            Annuler les modifications
          </Button>
          {saved && <span className="text-sm text-tone-green-fg">Enregistré.</span>}
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
    </Card>
  );
}

function RescoreCard({ r, active }: { r: Risk; active: Methodology }) {
  const qc = useQueryClient();
  const [d, setD] = useState({
    il: null as number | null,
    is: null as number | null,
    rl: null as number | null,
    rs: null as number | null,
    j: '',
  });
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () =>
      post<Risk>(`/api/v1/risks/${r.id}/rescore`, {
        version: r.version,
        inherentLikelihood: d.il,
        inherentSeverity: d.is,
        residualLikelihood: d.rl,
        residualSeverity: d.rs,
        justification: d.j,
      }),
    onSuccess: (next) => {
      qc.setQueryData(['risk', r.id], next);
      void qc.invalidateQueries({ queryKey: ['risks'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const cfg = active.config;
  return (
    <Card>
      <h2 className="mb-2 text-lg">
        Recoter selon {active.name} v{active.version}
      </h2>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <ScaleSelect
          label="Vraisemblance inhérente"
          scale={cfg.likelihood}
          value={d.il}
          onChange={(v) => setD({ ...d, il: v })}
        />
        <ScaleSelect
          label="Gravité inhérente"
          scale={cfg.severity}
          value={d.is}
          onChange={(v) => setD({ ...d, is: v })}
        />
        <ScaleSelect
          label="Vraisemblance résiduelle"
          scale={cfg.likelihood}
          value={d.rl}
          onChange={(v) => setD({ ...d, rl: v })}
        />
        <ScaleSelect
          label="Gravité résiduelle"
          scale={cfg.severity}
          value={d.rs}
          onChange={(v) => setD({ ...d, rs: v })}
        />
      </div>
      <TextField
        className="mt-2"
        label="Motif (10 caractères minimum)"
        value={d.j}
        onChange={(e) => setD({ ...d, j: e.target.value })}
      />
      <Button
        className="mt-3"
        disabled={mut.isPending || !d.il || !d.is || d.j.trim().length < 10}
        onClick={() => mut.mutate()}
      >
        Recoter
      </Button>
    </Card>
  );
}

function MeasuresCard({ r }: { r: Risk }) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const editable = !!r.permissions?.canManage;
  const all = useQuery({
    queryKey: ['measures', r.aiSystem.id],
    queryFn: () => get<{ items: Measure[] }>(`/api/v1/ai-systems/${r.aiSystem.id}/measures`),
  });
  const [f, setF] = useState({ title: '', type: 'ORGANISATIONAL', status: 'PLANNED', ownerId: '', dueDate: '' });
  const [linkId, setLinkId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = async (next?: Risk) => {
    if (next) qc.setQueryData(['risk', r.id], next);
    else await qc.invalidateQueries({ queryKey: ['risk', r.id] });
    await qc.invalidateQueries({ queryKey: ['measures', r.aiSystem.id] });
    await qc.invalidateQueries({ queryKey: ['risks'] });
    setError(null);
  };
  const onError = (e: unknown) => setError(errorMessage(e));
  const create = useMutation({
    mutationFn: () =>
      post(`/api/v1/ai-systems/${r.aiSystem.id}/measures`, {
        ...f,
        ownerId: f.ownerId || null,
        dueDate: f.dueDate || null,
        riskId: r.id,
      }),
    onSuccess: async () => {
      setF({ title: '', type: 'ORGANISATIONAL', status: 'PLANNED', ownerId: '', dueDate: '' });
      await refresh();
    },
    onError,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MeasureStatus }) =>
      api('PATCH', `/api/v1/measures/${id}`, { status }),
    onSuccess: () => refresh(),
    onError,
  });
  const link = useMutation({
    mutationFn: () => post<Risk>(`/api/v1/risks/${r.id}/measures`, { measureId: linkId }),
    onSuccess: (next) => (setLinkId(''), refresh(next)),
    onError,
  });
  const unlink = useMutation({
    mutationFn: (mid: string) => api<Risk>('DELETE', `/api/v1/risks/${r.id}/measures/${mid}`),
    onSuccess: (next) => refresh(next),
    onError,
  });
  const linkable = (all.data?.items ?? []).filter((m) => !r.measures.some((x) => x.id === m.id));
  return (
    <Card>
      <h2 className="mb-1 text-lg">Mesures ({r.measures.length})</h2>
      <p className="mb-3 text-sm text-grey-600">
        Une mesure « en place » ou « en place et vérifiée » est une mesure existante, prise en compte dans le risque
        résiduel. Les mesures appartiennent au SIA et peuvent couvrir plusieurs de ses risques.
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      {r.measures.length === 0 ? (
        <EmptyState>Aucune mesure rattachée.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {r.measures.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-semibold">{m.title}</p>
                <p className="text-xs text-grey-600">
                  {MEASURE_TYPE_LABELS[m.type as keyof typeof MEASURE_TYPE_LABELS]} · responsable {m.owner ?? '—'} ·
                  échéance {formatDate(m.dueDate)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editable ? (
                  <select
                    aria-label={`Statut de la mesure ${m.title}`}
                    value={m.status}
                    onChange={(e) => setStatus.mutate({ id: m.id, status: e.target.value as MeasureStatus })}
                    className="rounded-lg border border-grey-300 px-2 py-1 text-sm"
                  >
                    {MEASURE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {MEASURE_STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone={MEASURE_STATUS_META[m.status as MeasureStatus].tone}>
                    {MEASURE_STATUS_META[m.status as MeasureStatus].label}
                  </Badge>
                )}
                {editable && (
                  <Button size="sm" variant="ghost" onClick={() => unlink.mutate(m.id)}>
                    Détacher
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-4 space-y-3 rounded-xl bg-grey-50 p-3">
          {linkable.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField
                className="min-w-64 flex-1"
                label="Rattacher une mesure existante du SIA"
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
              >
                <option value="">—</option>
                {linkable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({MEASURE_STATUS_META[m.status as MeasureStatus].label})
                  </option>
                ))}
              </SelectField>
              <Button size="sm" variant="secondary" disabled={!linkId || link.isPending} onClick={() => link.mutate()}>
                Rattacher
              </Button>
            </div>
          )}
          <p className="text-sm font-bold">Nouvelle mesure</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
            <TextField
              className="md:col-span-2"
              label="Intitulé"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
            <SelectField label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {MEASURE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MEASURE_TYPE_LABELS[t]}
                </option>
              ))}
            </SelectField>
            <SelectField label="Statut" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {MEASURE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MEASURE_STATUS_META[s].label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Responsable"
              value={f.ownerId}
              onChange={(e) => setF({ ...f, ownerId: e.target.value })}
            >
              <option value="">—</option>
              {users.data?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              label="Échéance"
              type="date"
              value={f.dueDate}
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            />
            <Button size="sm" disabled={f.title.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>
              Ajouter la mesure
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function RiskActions({ r }: { r: Risk }) {
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ['actions', 'risk', r.id],
    queryFn: () => get<{ items: ActionView[] }>(`/api/v1/actions?riskId=${r.id}&pageSize=200`),
  });
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg">Plan d’action ({r.actions.length})</h2>
        {r.permissions?.canManage && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Nouvelle action
          </Button>
        )}
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <Alert tone="red">{errorMessage(list.error)}</Alert>
      ) : (
        <ActionsTable items={list.data.items} showSystem={false} />
      )}
      {open && (
        <NewActionModal
          open
          onClose={() => setOpen(false)}
          aiSystemId={r.aiSystem.id}
          preset={{ riskId: r.id }}
          risks={[{ id: r.id, label: `${r.reference} — ${r.title}` }]}
          measures={r.measures.map((m) => ({ id: m.id, label: m.title }))}
        />
      )}
    </Card>
  );
}

function RiskHistory({ id }: { id: string }) {
  const h = useQuery({
    queryKey: ['risk-history', id],
    queryFn: () =>
      get<{
        items: {
          id: string;
          occurredAt: string;
          actorLabel: string;
          action: string;
          changes: Record<string, { old: unknown; new: unknown }> | null;
          justification: string | null;
        }[];
      }>(`/api/v1/risks/${id}/history`),
  });
  if (h.isPending) return <Spinner />;
  if (h.isError) return <Alert tone="red">{errorMessage(h.error)}</Alert>;
  return (
    <Card>
      <h2 className="mb-2 text-lg">Historique</h2>
      <ol className="space-y-2 text-sm">
        {h.data.items.map((e) => (
          <li key={e.id} className="border-l-2 border-grey-200 pl-3">
            <p>
              <span className="text-grey-500">{formatDateTime(e.occurredAt)}</span> · {e.actorLabel} ·{' '}
              <span className="font-semibold">{e.action}</span>
            </p>
            {e.justification && <p className="text-xs">Motif : {e.justification}</p>}
            {e.changes && (
              <ul className="text-xs text-grey-600">
                {Object.entries(e.changes).map(([k, c]) => (
                  <li key={k}>
                    {k} : {formatValue(c.old)} → {formatValue(c.new)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function RiskPage() {
  const { id = '' } = useParams();
  const risk = useQuery({ queryKey: ['risk', id], queryFn: () => get<Risk>(`/api/v1/risks/${id}`) });
  const methods = useMethodologies();
  if (risk.isPending || methods.isPending) return <Spinner />;
  if (risk.isError)
    return (
      <Alert tone="red" title="Risque inaccessible">
        {errorMessage(risk.error)}
      </Alert>
    );
  if (methods.isError) return <Alert tone="red">{errorMessage(methods.error)}</Alert>;
  const r = risk.data;
  const m = methods.data.items.find((x) => x.id === r.methodology.id);
  const active = methods.data.items.find((x) => x.isActive);
  if (!m) return <Alert tone="red">Méthodologie du risque introuvable.</Alert>;
  const st = RISK_STATUS_META[r.status as RiskStatus];
  return (
    <>
      <nav aria-label="Fil d’Ariane" className="text-xs text-grey-500">
        <Link to="/risques" className="hover:underline">
          Risques
        </Link>{' '}
        ›{' '}
        <Link to={`/systemes/${r.aiSystem.id}?onglet=risques`} className="hover:underline">
          {r.aiSystem.reference} {r.aiSystem.name}
        </Link>{' '}
        › {r.reference}
      </nav>
      <header className="mt-1 mb-4">
        <h1 className="text-2xl font-extrabold">
          {r.reference} — {r.title} {r.aiSystem.isDemo && <Badge tone="yellow">DEMO</Badge>}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="blue">{RISK_TYPE_LABELS[r.category as RiskType]}</Badge>
          <Badge tone={st.tone}>{st.label}</Badge>
          <span>Inhérent</span> <LevelBadge level={r.inherentLevel} score={r.inherentScore} />
          <span>Résiduel</span> <LevelBadge level={r.residualLevel} score={r.residualScore} />
          <span className="text-grey-600">Propriétaire : {r.owner?.displayName ?? '—'}</span>
        </div>
      </header>
      {r.warnings.length > 0 && (
        <div className="mb-4">
          <Alert tone="orange" title="Points d’attention">
            <ul className="list-disc pl-5">
              {r.warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <div className="space-y-4">
        {!r.methodology.isActive && active && r.permissions?.canManage && <RescoreCard r={r} active={active} />}
        <RiskForm r={r} m={m} />
        <MeasuresCard r={r} />
        <RiskActions r={r} />
        <Card>
          <h2 className="text-lg">Preuves</h2>
          <p className="text-sm text-grey-600">
            Fonctionnalité non implémentée — rattachement de pièces justificatives en S7.
          </p>
        </Card>
        <RiskHistory id={r.id} />
      </div>
    </>
  );
}
