import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCEPT_ATTRIBUTE, DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, type DocumentType } from '@chandelier/shared';
import { api, errorMessage, get, post, upload } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, EmptyState, Modal, SelectField, Spinner, TextField } from '../../components/ui';

export interface DocView {
  id: string;
  title: string;
  type: DocumentType;
  description: string;
  currentVersionNo: number;
  aiSystem: { id: string; reference: string; name: string; isDemo: boolean } | null;
  aiModel: { id: string; name: string } | null;
  isDemo: boolean;
  archivedAt: string | null;
  current: {
    versionNo: number;
    fileName: string;
    sizeBytes: number;
    scanStatus: string;
    uploadedAt: string;
    uploadedBy: string | null;
  } | null;
  versions: {
    versionNo: number;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    scanStatus: string;
    changeNote: string;
    uploadedAt: string;
    uploadedBy: string | null;
  }[];
  obligations: { id: string; title: string }[];
  risks: { id: string; reference: string; title: string }[];
}

export const formatSize = (n: number) =>
  n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`;

const SCAN_LABEL: Record<string, { label: string; tone: 'gray' | 'green' | 'red' }> = {
  NOT_SCANNED: { label: 'Non analysé (antivirus inactif)', tone: 'gray' },
  CLEAN: { label: 'Analysé', tone: 'green' },
  INFECTED: { label: 'Infecté — bloqué', tone: 'red' },
  ERROR: { label: 'Erreur d’analyse', tone: 'gray' },
};

function UploadForm({
  url,
  maxMb,
  onDone,
  versionOf,
}: {
  url: string;
  maxMb: number;
  onDone: () => void;
  versionOf?: DocView;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DocumentType>('OTHER');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mut = useMutation({
    mutationFn: () =>
      upload(url, versionOf ? { changeNote: note } : { title: title || file!.name, type, description }, file!),
    onSuccess: () => {
      setFile(null);
      setTitle('');
      setDescription('');
      setNote('');
      if (input.current) input.current.value = '';
      setError(null);
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const tooBig = !!file && file.size > maxMb * 1024 * 1024;
  return (
    <div className="space-y-3 rounded-xl bg-grey-50 p-3">
      {error && <Alert tone="red">{error}</Alert>}
      <div>
        <label htmlFor={`file-${versionOf?.id ?? 'new'}`} className="mb-1 block text-sm font-semibold text-grey-700">
          Fichier (PDF, Office, OpenDocument, image PNG/JPEG, texte, CSV, Markdown, JSON — {maxMb} Mo maximum)
        </label>
        <input
          ref={input}
          id={`file-${versionOf?.id ?? 'new'}`}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        {tooBig && <p className="mt-1 text-xs text-tone-red-fg">Fichier supérieur à {maxMb} Mo.</p>}
      </div>
      {versionOf ? (
        <TextField label="Note de version" value={note} onChange={(e) => setNote(e.target.value)} />
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <TextField
            label="Titre"
            placeholder="Par défaut : nom du fichier"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </SelectField>
          <TextField
            className="md:col-span-2"
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      )}
      <Button size="sm" disabled={!file || tooBig || mut.isPending} onClick={() => mut.mutate()}>
        {mut.isPending ? 'Envoi…' : versionOf ? 'Déposer la nouvelle version' : 'Déposer le document'}
      </Button>
      <p className="text-xs text-grey-500">
        Le format est vérifié côté serveur (extension et contenu). Les fichiers sont téléchargés en pièce jointe, jamais
        affichés dans le navigateur. Antivirus : non actif sur cette instance.
      </p>
    </div>
  );
}

function DocumentRow({ d, onChange, maxMb }: { d: DocView; onChange: () => void; maxMb: number }) {
  const [open, setOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['document', d.id],
    queryFn: () => get<DocView & { permissions: { canWrite: boolean } }>(`/api/v1/documents/${d.id}`),
    enabled: open || archiveOpen,
  });
  const archive = useMutation({
    mutationFn: () => post(`/api/v1/documents/${d.id}/archive`, { reason }),
    onSuccess: () => (setArchiveOpen(false), onChange()),
    onError: (e) => setError(errorMessage(e)),
  });
  const scan = d.current ? SCAN_LABEL[d.current.scanStatus] : null;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {d.title} {d.archivedAt && <Badge tone="gray">Archivé</Badge>}{' '}
            {d.isDemo && <Badge tone="yellow">DEMO</Badge>}
          </p>
          <p className="text-xs text-grey-600">
            {DOCUMENT_TYPE_LABELS[d.type]} · v{d.currentVersionNo}
            {d.current && (
              <>
                {' '}
                · {d.current.fileName} · {formatSize(d.current.sizeBytes)} · déposé le{' '}
                {formatDateTime(d.current.uploadedAt)} par {d.current.uploadedBy ?? '—'}
              </>
            )}
          </p>
          {(d.obligations.length > 0 || d.risks.length > 0) && (
            <p className="text-xs text-grey-600">
              Preuve pour :{' '}
              {[...d.obligations.map((o) => o.title), ...d.risks.map((r) => `${r.reference} ${r.title}`)].join(' ; ')}
            </p>
          )}
          {scan && (
            <span className="mt-1 inline-block">
              <Badge tone={scan.tone}>{scan.label}</Badge>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {d.current && (
            <a
              className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
              href={`/api/v1/documents/${d.id}/versions/${d.current.versionNo}/download`}
            >
              Télécharger
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            {open ? 'Fermer' : 'Versions'}
          </Button>
          {!d.archivedAt && detail.data?.permissions.canWrite !== false && (
            <Button size="sm" variant="ghost" onClick={() => (setError(null), setArchiveOpen(true))}>
              Archiver
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {detail.isPending ? (
            <Spinner />
          ) : detail.isError ? (
            <Alert tone="red">{errorMessage(detail.error)}</Alert>
          ) : (
            <>
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Versions de {d.title}</caption>
                <thead className="text-grey-500">
                  <tr>
                    <th className="py-1">Version</th>
                    <th>Fichier</th>
                    <th>Taille</th>
                    <th>Empreinte SHA-256</th>
                    <th>Déposé</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.versions.map((v) => (
                    <tr key={v.versionNo} className="border-t border-grey-100">
                      <td className="py-1">
                        <a
                          className="text-gls-blue hover:underline"
                          href={`/api/v1/documents/${d.id}/versions/${v.versionNo}/download`}
                        >
                          v{v.versionNo}
                        </a>
                      </td>
                      <td>{v.fileName}</td>
                      <td>{formatSize(v.sizeBytes)}</td>
                      <td className="font-mono" title={v.sha256}>
                        {v.sha256.slice(0, 16)}…
                      </td>
                      <td>
                        {formatDateTime(v.uploadedAt)} — {v.uploadedBy ?? '—'}
                      </td>
                      <td>{v.changeNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.data.permissions.canWrite && (
                <UploadForm
                  url={`/api/v1/documents/${d.id}/versions`}
                  maxMb={maxMb}
                  versionOf={d}
                  onDone={() => (void detail.refetch(), onChange())}
                />
              )}
            </>
          )}
        </div>
      )}
      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={`Archiver « ${d.title} »`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 10 || archive.isPending}
              onClick={() => archive.mutate()}
            >
              Archiver
            </Button>
          </>
        }
      >
        {error && <Alert tone="red">{error}</Alert>}
        <p className="mb-2 text-sm">Les fichiers et les rattachements de preuve sont conservés.</p>
        <TextField label="Motif (10 caractères minimum)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </li>
  );
}

/** Documents d'un SIA (ownerPath = ai-systems/:id) ou d'un modèle (ai-models/:id). */
export function DocumentsPanel({
  ownerPath,
  title = 'Documents et pièces justificatives',
}: {
  ownerPath: string;
  title?: string;
}) {
  const qc = useQueryClient();
  const key = ['documents', ownerPath];
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      get<{ items: DocView[]; permissions: { canUpload: boolean }; maxMb: number }>(`/api/v1/${ownerPath}/documents`),
  });
  const [showArchived, setShowArchived] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['documents'] });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert tone="red">{errorMessage(list.error)}</Alert>;
  const items = list.data.items.filter((d) => showArchived || !d.archivedAt);
  const archivedCount = list.data.items.length - list.data.items.filter((d) => !d.archivedAt).length;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base">
          {title} ({items.length})
        </h3>
        {archivedCount > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Afficher les archivés ({archivedCount})
          </label>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState>Aucun document.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {items.map((d) => (
            <DocumentRow key={d.id} d={d} onChange={refresh} maxMb={list.data.maxMb} />
          ))}
        </ul>
      )}
      {list.data.permissions.canUpload && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-bold">Nouveau document</h4>
          <UploadForm url={`/api/v1/${ownerPath}/documents`} maxMb={list.data.maxMb} onDone={refresh} />
        </div>
      )}
    </Card>
  );
}

/** Rattachement de documents du SIA comme preuves d'un risque ou d'une obligation. */
export function EvidencePicker({
  systemId,
  targetPath,
  evidences,
  editable,
  onChange,
}: {
  systemId: string;
  targetPath: string;
  evidences: { id: string; title: string; archivedAt: string | null }[];
  editable: boolean;
  onChange: () => void;
}) {
  const [docId, setDocId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const docs = useQuery({
    queryKey: ['documents', `ai-systems/${systemId}`],
    queryFn: () => get<{ items: DocView[] }>(`/api/v1/ai-systems/${systemId}/documents`),
    enabled: editable,
  });
  const link = useMutation({
    mutationFn: () => post(`/api/v1/${targetPath}/evidence`, { documentId: docId }),
    onSuccess: () => (setDocId(''), setError(null), onChange()),
    onError: (e) => setError(errorMessage(e)),
  });
  const unlink = useMutation({
    mutationFn: (id: string) => api('DELETE', `/api/v1/${targetPath}/evidence/${id}`),
    onSuccess: () => onChange(),
    onError: (e) => setError(errorMessage(e)),
  });
  const available = (docs.data?.items ?? []).filter((d) => !d.archivedAt && !evidences.some((e) => e.id === d.id));
  return (
    <div className="text-sm">
      {error && <Alert tone="red">{error}</Alert>}
      {evidences.length === 0 ? (
        <p className="text-grey-500">Aucune preuve rattachée.</p>
      ) : (
        <ul className="space-y-1">
          {evidences.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span>
                {e.title} {e.archivedAt && <Badge tone="gray">Archivé</Badge>}
              </span>
              {editable && (
                <Button size="sm" variant="ghost" onClick={() => unlink.mutate(e.id)}>
                  Détacher
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <SelectField
            className="min-w-60 flex-1"
            label="Rattacher un document du SIA"
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
          >
            <option value="">—</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} (v{d.currentVersionNo})
              </option>
            ))}
          </SelectField>
          <Button size="sm" variant="secondary" disabled={!docId || link.isPending} onClick={() => link.mutate()}>
            Rattacher
          </Button>
        </div>
      )}
      {editable && available.length === 0 && (
        <p className="mt-1 text-xs text-grey-500">
          Déposez d’abord le document dans l’étape 11 « Documentation » du SIA.
        </p>
      )}
    </div>
  );
}
