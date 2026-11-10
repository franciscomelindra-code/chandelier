import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RISK_STATUS_META,
  RISK_TREATMENT_LABELS,
  RISK_TYPE_LABELS,
  RISK_TYPES,
  levelOf,
  type RiskStatus,
  type RiskTreatment,
  type RiskType,
} from '@chandelier/shared';
import { errorMessage, post } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useActiveUsers } from '../../lib/queries';
import { Alert, Badge, Button, EmptyState, Modal, SelectField, TextField } from '../../components/ui';
import { LevelBadge } from './RiskHeatmap';
import type { Methodology, Risk } from './types';

export function RisksTable({ items, showSystem = true }: { items: Risk[]; showSystem?: boolean }) {
  if (!items.length) return <EmptyState>Aucun risque ne correspond.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Risques</caption>
        <thead className="border-b border-grey-200 bg-grey-50 text-xs uppercase tracking-wide text-grey-500">
          <tr>
            <th scope="col" className="px-3 py-2">
              Risque
            </th>
            {showSystem && (
              <th scope="col" className="px-3 py-2">
                Système
              </th>
            )}
            <th scope="col" className="px-3 py-2">
              Inhérent
            </th>
            <th scope="col" className="px-3 py-2">
              Résiduel
            </th>
            <th scope="col" className="px-3 py-2">
              Traitement
            </th>
            <th scope="col" className="px-3 py-2">
              Statut
            </th>
            <th scope="col" className="px-3 py-2">
              Propriétaire
            </th>
            <th scope="col" className="px-3 py-2">
              Échéance
            </th>
            <th scope="col" className="px-3 py-2">
              Mesures / actions
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const st = RISK_STATUS_META[r.status as RiskStatus];
            return (
              <tr key={r.id} className="border-b border-grey-100 align-top hover:bg-grey-50">
                <td className="px-3 py-2.5">
                  <Link to={`/risques/${r.id}`} className="font-semibold text-gls-blue hover:underline">
                    {r.reference} — {r.title}
                  </Link>
                  <p className="text-xs text-grey-600">{RISK_TYPE_LABELS[r.category as RiskType]}</p>
                  {r.warnings.length > 0 && (
                    <p className="mt-1 text-xs text-tone-orange-fg" title={r.warnings.map((w) => w.message).join('\n')}>
                      ⚠ {r.warnings.length} point(s) d’attention
                    </p>
                  )}
                </td>
                {showSystem && (
                  <td className="px-3 py-2.5">
                    <Link to={`/systemes/${r.aiSystem.id}?onglet=risques`} className="text-gls-blue hover:underline">
                      {r.aiSystem.reference}
                    </Link>{' '}
                    {r.aiSystem.name} {r.aiSystem.isDemo && <Badge tone="yellow">DEMO</Badge>}
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <LevelBadge level={r.inherentLevel} score={r.inherentScore} />
                </td>
                <td className="px-3 py-2.5">
                  {r.residualLevel ? <LevelBadge level={r.residualLevel} score={r.residualScore} /> : '—'}
                </td>
                <td className="px-3 py-2.5">
                  {r.treatment ? RISK_TREATMENT_LABELS[r.treatment as RiskTreatment] : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
                <td className="px-3 py-2.5">{r.owner?.displayName ?? '—'}</td>
                <td className="px-3 py-2.5">{formatDate(r.dueDate)}</td>
                <td className="px-3 py-2.5 text-xs">
                  {r.measures.filter((m) => m.isExisting).length}/{r.measures.length} en place · {r.openActions}{' '}
                  action(s) ouverte(s)
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Création d'un risque : la cotation inhérente utilise la méthodologie active. */
export function NewRiskModal({
  open,
  onClose,
  aiSystemId,
  methodology,
}: {
  open: boolean;
  onClose: () => void;
  aiSystemId: string;
  methodology: Methodology;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const users = useActiveUsers();
  const [f, setF] = useState({
    category: 'PRIVACY',
    title: '',
    scenario: '',
    inherentLikelihood: '',
    inherentSeverity: '',
    ownerId: '',
    dueDate: '',
  });
  const [error, setError] = useState<string | null>(null);
  const cfg = methodology.config;
  const score =
    f.inherentLikelihood && f.inherentSeverity ? Number(f.inherentLikelihood) * Number(f.inherentSeverity) : null;
  const create = useMutation({
    mutationFn: () =>
      post<Risk>(`/api/v1/ai-systems/${aiSystemId}/risks`, {
        category: f.category,
        title: f.title,
        scenario: f.scenario,
        inherentLikelihood: f.inherentLikelihood ? Number(f.inherentLikelihood) : null,
        inherentSeverity: f.inherentSeverity ? Number(f.inherentSeverity) : null,
        ownerId: f.ownerId || null,
        dueDate: f.dueDate || null,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['risks'] });
      onClose();
      void navigate(`/risques/${r.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau risque"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={create.isPending || f.title.trim().length < 3} onClick={() => create.mutate()}>
            Créer et compléter
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {error && (
          <div className="md:col-span-2">
            <Alert tone="red">{error}</Alert>
          </div>
        )}
        <SelectField label="Catégorie" value={f.category} onChange={set('category')}>
          {RISK_TYPES.map((c) => (
            <option key={c} value={c}>
              {RISK_TYPE_LABELS[c]}
            </option>
          ))}
        </SelectField>
        <TextField label="Intitulé" required value={f.title} onChange={set('title')} />
        <div className="md:col-span-2">
          <label htmlFor="new-risk-scenario" className="mb-1 block text-sm font-semibold text-grey-700">
            Scénario
          </label>
          <textarea
            id="new-risk-scenario"
            rows={3}
            className="w-full rounded-lg border border-grey-300 px-3 py-2"
            value={f.scenario}
            onChange={set('scenario')}
          />
        </div>
        <SelectField label="Vraisemblance inhérente" value={f.inherentLikelihood} onChange={set('inherentLikelihood')}>
          <option value="">—</option>
          {cfg.likelihood.map((l) => (
            <option key={l.value} value={l.value}>
              {l.value}. {l.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Gravité inhérente" value={f.inherentSeverity} onChange={set('inherentSeverity')}>
          <option value="">—</option>
          {cfg.severity.map((l) => (
            <option key={l.value} value={l.value}>
              {l.value}. {l.label}
            </option>
          ))}
        </SelectField>
        <p className="text-sm md:col-span-2">
          Niveau inhérent : <LevelBadge level={levelOf(cfg, score)} score={score} />{' '}
          <span className="text-xs text-grey-500">
            ({methodology.name} v{methodology.version})
          </span>
        </p>
        <SelectField label="Propriétaire du risque" value={f.ownerId} onChange={set('ownerId')}>
          <option value="">—</option>
          {users.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </SelectField>
        <TextField label="Échéance de traitement" type="date" value={f.dueDate} onChange={set('dueDate')} />
      </div>
    </Modal>
  );
}
