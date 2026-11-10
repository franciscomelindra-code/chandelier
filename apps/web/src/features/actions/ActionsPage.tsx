import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ACTION_STATUS_META, PRIORITIES, PRIORITY_LABELS } from '@chandelier/shared';
import { errorMessage, get, qs } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  PageHeader,
  Pagination,
  SelectField,
  Spinner,
  TextField,
} from '../../components/ui';
import type { ActionView } from '../risks/types';
import { ActionsTable } from './ActionsTable';

const FILTERS = ['q', 'status', 'priority', 'mine', 'overdue', 'sort', 'dir', 'page'];

/** Portefeuille des actions du périmètre ; création depuis un SIA, un risque ou une obligation. */
export function ActionsPage() {
  const [sp, setSp] = useSearchParams();
  const params = Object.fromEntries(FILTERS.map((k) => [k, sp.get(k) ?? '']));
  const [search, setSearch] = useState(params.q ?? '');
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const status = params.status || (params.overdue ? '' : 'OPEN,IN_PROGRESS');
  const q = useQuery({
    queryKey: ['actions', 'portfolio', params],
    queryFn: () =>
      get<{ items: ActionView[]; total: number; page: number; pageSize: number; overdueCount: number }>(
        `/api/v1/actions${qs({ ...params, status: status === 'ALL' ? '' : status, pageSize: 50 })}`,
      ),
  });
  return (
    <>
      <PageHeader
        eyebrow="Pilotage"
        title="Actions"
        description="Plans d’action de vos systèmes d’IA. Une action se crée depuis la fiche d’un SIA (onglet « Actions ») ou depuis un risque ; le responsable désigné peut en faire évoluer le statut."
      />
      <Card className="mb-4 !p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={params.mine ? 'primary' : 'secondary'}
            onClick={() => update({ mine: params.mine ? null : 'true' })}
          >
            Mes actions
          </Button>
          <Button
            size="sm"
            variant={params.overdue ? 'danger' : 'secondary'}
            onClick={() => update({ overdue: params.overdue ? null : 'true' })}
          >
            Échues {q.data && <Badge tone="red">{q.data.overdueCount}</Badge>}
          </Button>
        </div>
        <form
          className="grid grid-cols-1 gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: search.trim() });
          }}
        >
          <TextField
            label="Recherche"
            placeholder="Référence, intitulé, SIA"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => update({ q: search.trim() })}
          />
          <SelectField label="Statut" value={params.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">Ouvertes (à faire, en cours)</option>
            <option value="ALL">Tous</option>
            {Object.entries(ACTION_STATUS_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Priorité" value={params.priority} onChange={(e) => update({ priority: e.target.value })}>
            <option value="">Toutes</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Tri"
            value={`${params.sort || 'dueDate'}:${params.dir || 'asc'}`}
            onChange={(e) => {
              const [sort, dir] = e.target.value.split(':');
              update({ sort: sort!, dir: dir! });
            }}
          >
            <option value="dueDate:asc">Échéance la plus proche</option>
            <option value="priority:desc">Priorité décroissante</option>
            <option value="updatedAt:desc">Dernière modification</option>
          </SelectField>
        </form>
      </Card>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <Alert tone="red">{errorMessage(q.error)}</Alert>
      ) : (
        <Card className="!p-0">
          <ActionsTable items={q.data.items} />
          <div className="px-4 pb-4">
            <Pagination
              page={q.data.page}
              pageSize={q.data.pageSize}
              total={q.data.total}
              onPage={(p) => update({ page: String(p) })}
            />
          </div>
        </Card>
      )}
    </>
  );
}
