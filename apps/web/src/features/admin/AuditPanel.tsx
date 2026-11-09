import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ORIGIN_LABELS } from '@chandelier/shared';
import { errorMessage, get, qs } from '../../lib/api';
import { formatDateTime, formatValue } from '../../lib/format';
import type { AuditEvent, Page } from '../../lib/types';
import { Alert, Badge, Card, EmptyState, Pagination, SelectField, Spinner, TextField } from '../../components/ui';

const ENTITY_TYPES = ['User', 'OrganizationUnit', 'AuditEvent'];

export function AuditPanel() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const filters = { entityType, action: action.trim(), from, to };
  const events = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () => get<Page<AuditEvent>>(`/api/v1/audit-events${qs({ ...filters, page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const reset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end gap-3 [&>*]:min-w-[11rem] [&>*]:flex-1">
        <SelectField label="Objet" value={entityType} onChange={(e) => reset(setEntityType)(e.target.value)}>
          <option value="">Tous</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Action"
          placeholder="ex. login, update"
          value={action}
          onChange={(e) => reset(setAction)(e.target.value)}
        />
        <TextField label="Du" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        <TextField label="Au" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
        <a
          className="inline-flex items-center justify-center rounded-full border-2 border-gls-blue px-4 py-2 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
          href={`/api/v1/audit-events/export.csv${qs(filters)}`}
        >
          Exporter CSV
        </a>
      </div>
      <p className="mb-3 text-xs text-grey-500">
        Journal immuable : aucune entrée ne peut être modifiée ni supprimée, y compris par un administrateur.
      </p>
      {events.isPending ? (
        <Spinner />
      ) : events.isError ? (
        <Alert tone="red">{errorMessage(events.error)}</Alert>
      ) : events.data.items.length === 0 ? (
        <EmptyState>Aucun événement pour ces critères.</EmptyState>
      ) : (
        <>
          <ol className="divide-y divide-grey-100">
            {events.data.items.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <time className="text-grey-500" dateTime={e.occurredAt}>
                    {formatDateTime(e.occurredAt)}
                  </time>
                  <Badge tone={e.action.includes('fail') || e.action.includes('lock') ? 'orange' : 'blue'}>
                    {e.action}
                  </Badge>
                  <span className="font-semibold">{e.entityType}</span>
                  <span className="text-grey-600">par {e.actorLabel}</span>
                  <Badge tone="gray">{ORIGIN_LABELS[e.origin] ?? e.origin}</Badge>
                </div>
                {e.changes && Object.keys(e.changes).length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <caption className="sr-only">Modifications</caption>
                    <thead className="text-grey-500">
                      <tr>
                        <th scope="col" className="w-40 text-left font-semibold">
                          Champ
                        </th>
                        <th scope="col" className="text-left font-semibold">
                          Ancienne valeur
                        </th>
                        <th scope="col" className="text-left font-semibold">
                          Nouvelle valeur
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(e.changes).map(([field, c]) => (
                        <tr key={field}>
                          <td className="py-0.5 pr-2 font-mono">{field}</td>
                          <td className="py-0.5 pr-2 break-all text-tone-red-fg line-through decoration-1">
                            {formatValue(c.old)}
                          </td>
                          <td className="py-0.5 break-all text-tone-green-fg">{formatValue(c.new)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {e.justification && <p className="mt-1 text-xs text-grey-600">Justification : {e.justification}</p>}
              </li>
            ))}
          </ol>
          <Pagination page={page} pageSize={events.data.pageSize} total={events.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
