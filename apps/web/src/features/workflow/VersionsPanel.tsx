import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, get, post } from '../../lib/api';
import { formatDateTime, formatValue } from '../../lib/format';
import { Alert, Badge, Button, Card, Modal, SelectField, Spinner, TextField } from '../../components/ui';

interface VersionList {
  current: number;
  lockedVersion: number | null;
  items: { version: number; reason: string; createdAt: string; createdBy: string | null }[];
  canRestore: boolean;
}

/** Comparaison de deux versions et restauration des champs d'une version antérieure (F-043). */
export function VersionsPanel({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['versions', systemId],
    queryFn: () => get<VersionList>(`/api/v1/ai-systems/${systemId}/versions`),
  });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cmp = useQuery({
    queryKey: ['versions-compare', systemId, from, to],
    queryFn: () =>
      get<{ changes: { field: string; from: unknown; to: unknown; isLink: boolean }[] }>(
        `/api/v1/ai-systems/${systemId}/versions/compare?from=${from}&to=${to}`,
      ),
    enabled: !!from && !!to && from !== to,
  });
  const restore = useMutation({
    mutationFn: () =>
      post<{ version: number; restoredFields: string[] }>(`/api/v1/ai-systems/${systemId}/versions/${from}/restore`, {
        reason,
      }),
    onSuccess: async () => {
      setRestoreOpen(false);
      setReason('');
      await qc.invalidateQueries({ queryKey: ['ai-system', systemId] });
      await qc.invalidateQueries({ queryKey: ['versions', systemId] });
      await qc.invalidateQueries({ queryKey: ['ai-system-history', systemId] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert tone="red">{errorMessage(list.error)}</Alert>;
  const opts = list.data.items.map((v) => (
    <option key={v.version} value={v.version}>
      v{v.version} — {formatDateTime(v.createdAt)} — {v.reason}
      {v.version === list.data.lockedVersion ? ' (validée)' : ''}
    </option>
  ));
  return (
    <Card>
      <h2 className="mb-1 text-lg">Versions</h2>
      <p className="mb-3 text-sm text-grey-600">
        Version courante : {list.data.current}
        {list.data.lockedVersion && ` · version validée : ${list.data.lockedVersion}`}. La restauration reprend les
        champs de la fiche d’une version antérieure (pas les liens : modèles, parties prenantes, données…) et crée une
        nouvelle version, journalisée avec son motif.
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <SelectField label="Version de référence" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">—</option>
          {opts}
        </SelectField>
        <SelectField label="Comparer avec" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">—</option>
          {opts}
        </SelectField>
      </div>
      {cmp.data && (
        <div className="mt-3 overflow-x-auto">
          {cmp.data.changes.length === 0 ? (
            <p className="text-sm text-grey-500">Aucune différence.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Différences entre versions</caption>
              <thead className="text-grey-500">
                <tr>
                  <th className="py-1">Champ</th>
                  <th>v{from}</th>
                  <th>v{to}</th>
                </tr>
              </thead>
              <tbody>
                {cmp.data.changes.map((c) => (
                  <tr key={c.field} className="border-t border-grey-100 align-top">
                    <td className="py-1 font-semibold">
                      {c.field} {c.isLink && <Badge tone="gray">lien</Badge>}
                    </td>
                    <td className="max-w-80 break-words">
                      {c.isLink ? `${(c.from as unknown[] | null)?.length ?? 0} élément(s)` : formatValue(c.from)}
                    </td>
                    <td className="max-w-80 break-words">
                      {c.isLink ? `${(c.to as unknown[] | null)?.length ?? 0} élément(s)` : formatValue(c.to)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {list.data.canRestore && from && Number(from) < list.data.current && (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => (setError(null), setRestoreOpen(true))}>
          Restaurer les champs de la v{from}
        </Button>
      )}
      <Modal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title={`Restaurer la version ${from}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoreOpen(false)}>
              Annuler
            </Button>
            <Button disabled={reason.trim().length < 10 || restore.isPending} onClick={() => restore.mutate()}>
              Restaurer
            </Button>
          </>
        }
      >
        {error && <Alert tone="red">{error}</Alert>}
        <TextField label="Motif (10 caractères minimum)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </Card>
  );
}
