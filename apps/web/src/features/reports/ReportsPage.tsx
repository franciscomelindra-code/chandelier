import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IMPORT_FIELDS, type ImportField } from '@chandelier/shared';
import { ApiError, errorMessage, get, post, upload } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { indent, useOrgUnits } from '../../lib/queries';
import type { AiSystemListItem, Page } from '../../lib/types';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, SelectField, Spinner } from '../../components/ui';

interface ReportDef {
  key: string;
  title: string;
  description: string;
  formats: string[];
  perSystem: boolean;
}

function AuditDossier() {
  const [sid, setSid] = useState('');
  const systems = useQuery({
    queryKey: ['ai-systems', 'for-reports'],
    queryFn: () => get<Page<AiSystemListItem>>('/api/v1/ai-systems?pageSize=200&sort=reference&dir=asc'),
  });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField className="min-w-72 flex-1" label="Système" value={sid} onChange={(e) => setSid(e.target.value)}>
        <option value="">— Choisir —</option>
        {systems.data?.items.map((s) => (
          <option key={s.id} value={s.id}>
            {s.reference} — {s.name}
          </option>
        ))}
      </SelectField>
      {sid && (
        <>
          <a
            className="rounded-full px-3 py-2 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
            href={`/api/v1/ai-systems/${sid}/audit-dossier`}
          >
            Dossier d’audit (ZIP)
          </a>
          <a
            className="rounded-full px-3 py-2 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
            href={`/api/v1/ai-systems/${sid}/sheet?format=html`}
          >
            Fiche (HTML)
          </a>
          <a
            className="rounded-full px-3 py-2 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
            href={`/api/v1/ai-systems/${sid}/sheet?format=md`}
          >
            Fiche (Markdown)
          </a>
        </>
      )}
    </div>
  );
}

interface Preview {
  jobId: string;
  fileName: string;
  headers: string[];
  suggestedMapping: Record<string, ImportField | null>;
  ignoredColumns: string[];
  sample: string[][];
  total: number;
}
interface RowError {
  row: number;
  field: string;
  message: string;
}

function ImportPanel() {
  const qc = useQueryClient();
  const units = useOrgUnits();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportField | null>>({});
  const [unitId, setUnitId] = useState('');
  const [errors, setErrors] = useState<RowError[] | null>(null);
  const [message, setMessage] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const jobs = useQuery({
    queryKey: ['imports'],
    queryFn: () =>
      get<{ items: { id: string; fileName: string; status: string; createdAt: string; count: number | null }[] }>(
        '/api/v1/imports',
      ),
  });
  const body = () => ({ mapping, defaultOrgUnitId: unitId || null });
  const send = useMutation({
    mutationFn: () => upload<Preview>('/api/v1/imports/ai-systems/preview', {}, file!),
    onSuccess: (p) => (setPreview(p), setMapping(p.suggestedMapping), setErrors(null), setMessage(null)),
    onError: (e) => setMessage({ tone: 'red', text: errorMessage(e) }),
  });
  const validate = useMutation({
    mutationFn: () =>
      post<{ valid: boolean; errors: RowError[]; errorCount: number; importable: number }>(
        `/api/v1/imports/${preview!.jobId}/validate`,
        body(),
      ),
    onSuccess: (r) => {
      setErrors(r.errors);
      setMessage(
        r.valid
          ? { tone: 'green', text: `${r.importable} ligne(s) prêtes à importer.` }
          : { tone: 'red', text: `${r.errorCount} erreur(s) : rien ne sera importé tant qu’elles subsistent.` },
      );
    },
    onError: (e) => setMessage({ tone: 'red', text: errorMessage(e) }),
  });
  const commit = useMutation({
    mutationFn: () =>
      post<{ imported: number; references: string[] }>(`/api/v1/imports/${preview!.jobId}/commit`, body()),
    onSuccess: async (r) => {
      setMessage({
        tone: 'green',
        text: `${r.imported} SIA importé(s) : ${r.references.join(', ')}. Qualification AI Act à réaliser pour chacun.`,
      });
      setPreview(null);
      setErrors(null);
      await qc.invalidateQueries({ queryKey: ['ai-systems'] });
      await qc.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (e) => {
      const details = e instanceof ApiError ? (e.details as { errors?: RowError[] } | undefined) : undefined;
      if (details?.errors) setErrors(details.errors);
      setMessage({ tone: 'red', text: errorMessage(e) });
    },
  });
  return (
    <Card>
      <h2 className="mb-1 text-lg">Importer des SIA (CSV ou JSON)</h2>
      <p className="mb-3 text-sm text-grey-600">
        Le mapping des colonnes est proposé à partir des en-têtes (dont les champs de compatibilité Label, Ref, State,
        RiskLevel, BenefitLevel…). L’import est transactionnel : une seule ligne en erreur et rien n’est importé. Le
        niveau de risque déclaré dans l’outil source n’est jamais repris comme qualification AI Act. Import XLSX :
        fonctionnalité non implémentée.
      </p>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="import-file" className="mb-1 block text-sm font-semibold text-grey-700">
            Fichier (2 Mo, 2 000 lignes maximum)
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv,.txt,.json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </div>
        <Button size="sm" disabled={!file || send.isPending} onClick={() => send.mutate()}>
          Analyser
        </Button>
      </div>
      {preview && (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            <span className="font-semibold">{preview.fileName}</span> — {preview.total} ligne(s)
            {preview.ignoredColumns.length > 0 && (
              <> · colonnes ignorées (gérées par Chandelier) : {preview.ignoredColumns.join(', ')}</>
            )}
          </p>
          <SelectField
            className="max-w-md"
            label="Unité par défaut (lignes sans unité)"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
          >
            <option value="">— Aucune —</option>
            {units.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {indent(u.depth)}
                {u.name}
              </option>
            ))}
          </SelectField>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Mapping et aperçu</caption>
              <thead>
                <tr className="align-bottom">
                  {preview.headers.map((h) => (
                    <th key={h} className="min-w-40 p-1">
                      <span className="block font-mono">{h}</span>
                      <label className="sr-only" htmlFor={`map-${h}`}>
                        Champ cible pour {h}
                      </label>
                      <select
                        id={`map-${h}`}
                        value={mapping[h] ?? ''}
                        onChange={(e) =>
                          setMapping({ ...mapping, [h]: (e.target.value || null) as ImportField | null })
                        }
                        className="mt-1 w-full rounded border border-grey-300 px-1 py-0.5"
                      >
                        <option value="">(ignorée)</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i} className="border-t border-grey-100">
                    {preview.headers.map((_, j) => (
                      <td key={j} className="max-w-60 truncate p-1" title={r[j]}>
                        {r[j]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.total > preview.sample.length && (
              <p className="text-xs text-grey-500">Aperçu des {preview.sample.length} premières lignes.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={validate.isPending} onClick={() => validate.mutate()}>
              Valider
            </Button>
            <Button size="sm" disabled={commit.isPending} onClick={() => commit.mutate()}>
              Importer
            </Button>
          </div>
          {errors && errors.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-tone-red-bg">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Rapport d’erreurs</caption>
                <thead className="bg-tone-red-bg text-tone-red-fg">
                  <tr>
                    <th className="p-1">Ligne</th>
                    <th>Champ</th>
                    <th>Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e, i) => (
                    <tr key={i} className="border-t border-grey-100">
                      <td className="p-1">{e.row || 'mapping'}</td>
                      <td>{e.field}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {jobs.data && jobs.data.items.length > 0 && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-gls-blue">Mes imports récents</summary>
          <ul className="mt-1 space-y-1">
            {jobs.data.items.map((j) => (
              <li key={j.id}>
                {formatDateTime(j.createdAt)} — {j.fileName} —{' '}
                <Badge tone={j.status === 'COMPLETED' ? 'green' : 'gray'}>
                  {j.status === 'COMPLETED' ? `${j.count} importé(s)` : 'aperçu'}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function ReportsPage() {
  const { can } = useAuth();
  const [demo, setDemo] = useState<'include' | 'exclude'>('include');
  const q = useQuery({ queryKey: ['reports'], queryFn: () => get<{ items: ReportDef[] }>('/api/v1/reports') });
  return (
    <>
      <PageHeader
        eyebrow="Pilotage"
        title="Rapports"
        description="Rapports standards générés à la demande sur votre périmètre (SIA non archivés). Chaque génération est journalisée. Rapports PDF / DOCX : fonctionnalité non implémentée."
      />
      <div className="space-y-4">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg">Rapports standards</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={demo === 'exclude'}
                onChange={(e) => setDemo(e.target.checked ? 'exclude' : 'include')}
              />
              Exclure les données DEMO
            </label>
          </div>
          {q.isPending ? (
            <Spinner />
          ) : q.isError ? (
            <Alert tone="red">{errorMessage(q.error)}</Alert>
          ) : q.data.items.length === 0 ? (
            <EmptyState>Aucun rapport.</EmptyState>
          ) : (
            <ul className="divide-y divide-grey-100">
              {q.data.items
                .filter((r) => !r.perSystem)
                .map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="font-semibold">{r.title}</p>
                      <p className="text-xs text-grey-600">{r.description}</p>
                    </div>
                    <span className="flex gap-1">
                      {r.formats.map((f) => (
                        <a
                          key={f}
                          className="rounded-full px-3 py-1.5 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
                          href={`/api/v1/reports/${r.key}?format=${f}&demo=${demo}`}
                        >
                          {f.toUpperCase()}
                        </a>
                      ))}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-1 text-lg">Dossier d’audit et fiche d’un SIA</h2>
          <p className="mb-3 text-sm text-grey-600">
            Le dossier ZIP contient la fiche, la qualification, les obligations, les risques, les actions, le journal,
            la notice et la FRIA validées, les pièces justificatives et un manifeste SHA-256. Il requiert le droit de
            consultation du journal d’audit. Pour l’ouvrir depuis la fiche :{' '}
            <Link to="/systemes" className="text-gls-blue underline">
              Systèmes d’IA
            </Link>
            .
          </p>
          <AuditDossier />
        </Card>
        {can('import:run') && <ImportPanel />}
      </div>
    </>
  );
}
