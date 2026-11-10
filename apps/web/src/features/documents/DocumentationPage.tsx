import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from '@chandelier/shared';
import { errorMessage, get, qs } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  SelectField,
  Spinner,
  TextField,
} from '../../components/ui';
import { formatSize, type DocView } from './DocumentsPanel';

/** Liste transverse des pièces justificatives du périmètre. Le dépôt se fait depuis le SIA ou le modèle. */
export function DocumentsList() {
  const [sp, setSp] = useSearchParams();
  const params = {
    q: sp.get('q') ?? '',
    type: sp.get('type') ?? '',
    archived: sp.get('archived') ?? '',
    page: sp.get('page') ?? '',
  };
  const [search, setSearch] = useState(params.q);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const q = useQuery({
    queryKey: ['documents', 'all', params],
    queryFn: () =>
      get<{ items: DocView[]; total: number; page: number; pageSize: number }>(
        `/api/v1/documents${qs({ ...params, pageSize: 50 })}`,
      ),
  });
  return (
    <>
      <Card className="mb-4 !p-4">
        <form
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: search.trim() });
          }}
        >
          <TextField
            label="Recherche"
            placeholder="Titre, description, nom de fichier"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => update({ q: search.trim() })}
          />
          <SelectField label="Type" value={params.type} onChange={(e) => update({ type: e.target.value })}>
            <option value="">Tous</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Archivés" value={params.archived} onChange={(e) => update({ archived: e.target.value })}>
            <option value="">Masqués</option>
            <option value="include">Inclus</option>
            <option value="only">Uniquement</option>
          </SelectField>
        </form>
      </Card>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <Alert tone="red">{errorMessage(q.error)}</Alert>
      ) : q.data.items.length === 0 ? (
        <EmptyState>
          Aucun document. Les pièces se déposent depuis l’étape 11 d’un SIA ou depuis la fiche d’un modèle.
        </EmptyState>
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Documents</caption>
              <thead className="border-b border-grey-200 bg-grey-50 text-xs uppercase tracking-wide text-grey-500">
                <tr>
                  <th className="px-3 py-2">Document</th>
                  <th className="px-3 py-2">Rattachement</th>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Dernier dépôt</th>
                  <th className="px-3 py-2">Preuve pour</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((d) => (
                  <tr key={d.id} className="border-b border-grey-100 align-top hover:bg-grey-50">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold">
                        {d.title} {d.archivedAt && <Badge tone="gray">Archivé</Badge>}{' '}
                        {d.isDemo && <Badge tone="yellow">DEMO</Badge>}
                      </p>
                      <p className="text-xs text-grey-600">{DOCUMENT_TYPE_LABELS[d.type]}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      {d.aiSystem ? (
                        <Link
                          to={`/systemes/${d.aiSystem.id}?etape=documentation`}
                          className="text-gls-blue hover:underline"
                        >
                          {d.aiSystem.reference} {d.aiSystem.name}
                        </Link>
                      ) : d.aiModel ? (
                        <Link to={`/modeles/${d.aiModel.id}`} className="text-gls-blue hover:underline">
                          Modèle : {d.aiModel.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {d.current ? (
                        <a
                          className="text-gls-blue hover:underline"
                          href={`/api/v1/documents/${d.id}/versions/${d.current.versionNo}/download`}
                        >
                          v{d.current.versionNo} · {formatSize(d.current.sizeBytes)}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {d.current ? `${formatDateTime(d.current.uploadedAt)} — ${d.current.uploadedBy ?? '—'}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {[...d.obligations.map((o) => o.title), ...d.risks.map((r) => r.reference)].join(' ; ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

export function DocumentationPage() {
  return (
    <>
      <PageHeader
        eyebrow="Conformité"
        title="Documentation"
        description="Pièces justificatives versionnées de vos systèmes et modèles d’IA, et preuves rattachées aux obligations et aux risques."
      />
      <DocumentsList />
    </>
  );
}
