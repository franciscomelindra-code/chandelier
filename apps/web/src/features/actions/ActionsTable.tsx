import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ACTION_STATUS_META, PRIORITY_LABELS, type ActionStatus } from '@chandelier/shared';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Alert, Badge, Button, EmptyState, Modal, TextField } from '../../components/ui';
import type { ActionView } from '../risks/types';

const PRIORITY_TONE = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'orange', CRITICAL: 'red' } as const;

function StatusControl({ a }: { a: ActionView }) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (body: { status: ActionStatus; closureComment?: string }) =>
      api('PATCH', `/api/v1/actions/${a.id}`, { version: a.version, ...body }),
    onSuccess: async () => {
      setCancelOpen(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ['actions'] });
      await qc.invalidateQueries({ queryKey: ['risk'] });
      await qc.invalidateQueries({ queryKey: ['risks'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const meta = ACTION_STATUS_META[a.status as ActionStatus];
  if (!a.permissions?.canUpdateStatus) return <Badge tone={meta?.tone}>{meta?.label ?? a.status}</Badge>;
  return (
    <>
      <label className="sr-only" htmlFor={`st-${a.id}`}>
        Statut de {a.reference}
      </label>
      <select
        id={`st-${a.id}`}
        value={a.status}
        disabled={mut.isPending}
        onChange={(e) => {
          const s = e.target.value as ActionStatus;
          if (s === 'CANCELLED') {
            setComment('');
            setCancelOpen(true);
          } else mut.mutate({ status: s });
        }}
        className="rounded-lg border border-grey-300 bg-white px-2 py-1 text-sm"
      >
        {Object.entries(ACTION_STATUS_META).map(([k, m]) => (
          <option key={k} value={k}>
            {m.label}
          </option>
        ))}
      </select>
      {error && !cancelOpen && <p className="mt-1 text-xs text-tone-red-fg">{error}</p>}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Annuler ${a.reference}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Retour
            </Button>
            <Button
              variant="danger"
              disabled={!comment.trim() || mut.isPending}
              onClick={() => mut.mutate({ status: 'CANCELLED', closureComment: comment })}
            >
              Annuler l’action
            </Button>
          </>
        }
      >
        {error && <Alert tone="red">{error}</Alert>}
        <TextField label="Motif d’annulation" required value={comment} onChange={(e) => setComment(e.target.value)} />
      </Modal>
    </>
  );
}

export function ActionsTable({ items, showSystem = true }: { items: ActionView[]; showSystem?: boolean }) {
  if (!items.length) return <EmptyState>Aucune action.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Actions</caption>
        <thead className="border-b border-grey-200 bg-grey-50 text-xs uppercase tracking-wide text-grey-500">
          <tr>
            <th scope="col" className="px-3 py-2">
              Action
            </th>
            {showSystem && (
              <th scope="col" className="px-3 py-2">
                Système
              </th>
            )}
            <th scope="col" className="px-3 py-2">
              Lien
            </th>
            <th scope="col" className="px-3 py-2">
              Priorité
            </th>
            <th scope="col" className="px-3 py-2">
              Responsable
            </th>
            <th scope="col" className="px-3 py-2">
              Échéance
            </th>
            <th scope="col" className="px-3 py-2">
              Statut
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-grey-100 align-top hover:bg-grey-50">
              <td className="px-3 py-2.5">
                <span className="font-mono text-xs text-grey-500">{a.reference}</span>
                <p className="font-semibold">{a.title}</p>
                {a.description && <p className="text-xs text-grey-600">{a.description}</p>}
                {a.status === 'CANCELLED' && a.closureComment && (
                  <p className="text-xs text-grey-500">Motif : {a.closureComment}</p>
                )}
              </td>
              {showSystem && (
                <td className="px-3 py-2.5">
                  <Link to={`/systemes/${a.aiSystem.id}?onglet=actions`} className="text-gls-blue hover:underline">
                    {a.aiSystem.reference}
                  </Link>{' '}
                  {a.aiSystem.name} {a.aiSystem.isDemo && <Badge tone="yellow">DEMO</Badge>}
                </td>
              )}
              <td className="px-3 py-2.5 text-xs">
                {a.risk && (
                  <Link to={`/risques/${a.risk.id}`} className="block text-gls-blue hover:underline">
                    {a.risk.reference} — {a.risk.title}
                  </Link>
                )}
                {a.obligation && <span className="block">Obligation : {a.obligation.title}</span>}
                {a.measure && <span className="block">Mesure : {a.measure.title}</span>}
                {!a.risk && !a.obligation && !a.measure && <span className="text-grey-400">—</span>}
              </td>
              <td className="px-3 py-2.5">
                <Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY_LABELS[a.priority]}</Badge>
              </td>
              <td className="px-3 py-2.5">{a.assignee?.displayName ?? '—'}</td>
              <td className="px-3 py-2.5">
                {a.overdue ? <Badge tone="red">Échue · {formatDate(a.dueDate)}</Badge> : formatDate(a.dueDate)}
              </td>
              <td className="px-3 py-2.5">
                <StatusControl a={a} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
