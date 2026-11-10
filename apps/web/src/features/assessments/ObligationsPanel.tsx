import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPLICABILITY_LABELS, OBLIGATION_CATEGORY_LABELS, OBLIGATION_STATUS_META } from '@chandelier/shared';
import { api, errorMessage, get } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useActiveUsers } from '../../lib/queries';
import type { AiSystemDetail } from '../../lib/types';
import { Alert, Badge, Button, Card, EmptyState, SelectField, Spinner, TextField } from '../../components/ui';
import { ComplianceBadge } from '../ai-systems/badges';
import type { ObligationView } from './types';

function ObligationRow({ o, editable, systemId }: { o: ObligationView; editable: boolean; systemId: string }) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    applicability: o.applicability,
    status: o.status,
    responsibleId: o.responsibleId ?? '',
    targetDate: o.targetDate ?? '',
    comment: o.comment,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api('PATCH', `/api/v1/obligations/${o.id}`, {
        applicability: draft.applicability,
        status: draft.status,
        responsibleId: draft.responsibleId || null,
        targetDate: draft.targetDate || null,
        comment: draft.comment,
      }),
    onSuccess: async () => {
      setOpen(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ['obligations', systemId] });
      await qc.invalidateQueries({ queryKey: ['ai-system', systemId] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const st = OBLIGATION_STATUS_META[o.status];
  const overdue =
    o.targetDate &&
    o.targetDate < new Date().toISOString().slice(0, 10) &&
    !['COMPLIANT', 'NOT_APPLICABLE'].includes(o.status);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {o.title} <span className="text-sm font-normal text-grey-500">— {o.legalBasis}</span>
          </p>
          <p className="text-sm text-grey-700">{o.description}</p>
          <div className="mt-1 flex flex-wrap gap-1 text-xs">
            <Badge tone={st?.tone ?? 'gray'}>{st?.label ?? o.status}</Badge>
            <Badge tone={o.applicability === 'YES' ? 'blue' : 'gray'}>
              Applicable : {APPLICABILITY_LABELS[o.applicability]}
            </Badge>
            {o.targetDate && <Badge tone={overdue ? 'red' : 'gray'}>Échéance {formatDate(o.targetDate)}</Badge>}
            {o.responsible && <Badge tone="gray">Responsable : {o.responsible}</Badge>}
            {o.validatedAt && (
              <Badge tone="green">
                Conformité constatée le {formatDate(o.validatedAt)} ({o.validatedBy})
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-grey-500">
            Règles : {o.sourceRuleIds.join(', ')} · référentiel v{o.frameworkVersion} · preuves : fonctionnalité non
            implémentée (S7)
          </p>
          {o.comment && <p className="mt-1 whitespace-pre-line text-xs text-grey-700">{o.comment}</p>}
        </div>
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            {open ? 'Fermer' : 'Mettre à jour'}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-3 rounded-xl bg-grey-50 p-3 md:grid-cols-2">
          {error && (
            <div className="md:col-span-2">
              <Alert tone="red">{error}</Alert>
            </div>
          )}
          <SelectField
            label="Applicable"
            value={draft.applicability}
            onChange={(e) => setDraft({ ...draft, applicability: e.target.value as ObligationView['applicability'] })}
          >
            {Object.entries(APPLICABILITY_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Statut"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            {Object.entries(OBLIGATION_STATUS_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Responsable"
            value={draft.responsibleId}
            onChange={(e) => setDraft({ ...draft, responsibleId: e.target.value })}
          >
            <option value="">—</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Date cible"
            type="date"
            value={draft.targetDate}
            onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })}
          />
          <div className="md:col-span-2">
            <TextField
              label="Commentaire"
              hint="Obligatoire pour déclarer une obligation non applicable."
              value={draft.comment}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
            />
          </div>
          <div>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              Enregistrer
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function ObligationsPanel({ s }: { s: AiSystemDetail }) {
  const list = useQuery({
    queryKey: ['obligations', s.id],
    queryFn: () =>
      get<{ items: ObligationView[]; canUpdate: boolean; complianceStatus: string }>(
        `/api/v1/ai-systems/${s.id}/obligations`,
      ),
  });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert tone="red">{errorMessage(list.error)}</Alert>;
  const groups = new Map<string, ObligationView[]>();
  for (const o of list.data.items) groups.set(o.category, [...(groups.get(o.category) ?? []), o]);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base">Obligations et contrôles ({list.data.items.length})</h3>
        <span className="flex items-center gap-2 text-sm">
          Conformité globale : <ComplianceBadge value={list.data.complianceStatus} />
        </span>
      </div>
      {list.data.items.length === 0 ? (
        <EmptyState>Aucune obligation : elles sont générées à l’enregistrement d’une qualification.</EmptyState>
      ) : (
        [...groups.entries()].map(([cat, items]) => (
          <section key={cat} className="mb-3">
            <h4 className="text-sm font-bold text-gls-blue">{OBLIGATION_CATEGORY_LABELS[cat] ?? cat}</h4>
            <ul className="divide-y divide-grey-100">
              {items.map((o) => (
                <ObligationRow key={o.id} o={o} editable={list.data.canUpdate} systemId={s.id} />
              ))}
            </ul>
          </section>
        ))
      )}
    </Card>
  );
}
