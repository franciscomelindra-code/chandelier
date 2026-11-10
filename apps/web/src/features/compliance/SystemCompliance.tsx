import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DIMENSION_VALUE_META,
  FRIA_SECTIONS,
  NOTICE_BLOCKS,
  WORK_STATUS_META,
  WORK_STATUSES,
  type FriaSectionKey,
  type NoticeBlock,
  type WorkStatus,
} from '@chandelier/shared';
import { api, errorMessage, get, post } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, EmptyState, Modal, SelectField, Spinner, TextField } from '../../components/ui';
import { Markdown } from './Markdown';

const statusBadge = (s: string) => {
  const m = WORK_STATUS_META[s as WorkStatus];
  return <Badge tone={m?.tone ?? 'gray'}>{m?.label ?? s}</Badge>;
};
const dimLabel = (_dim: string, v: string | undefined) => (v ? (DIMENSION_VALUE_META[v]?.label ?? v) : 'non qualifié');

// ═════════════════════════════ Notice ═════════════════════════════
interface NoticeView {
  id: string;
  version: number;
  status: WorkStatus;
  blocks: NoticeBlock[];
  contentMarkdown: string;
  placeholders: number;
  validatedAt: string | null;
  validatedBy: string | null;
  withdrawnAt: string | null;
  documentId: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

function NoticeEditor({
  n,
  systemId,
  canManage,
  canValidate,
}: {
  n: NoticeView;
  systemId: string;
  canManage: boolean;
  canValidate: boolean;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState(n.contentMarkdown);
  const [blocks, setBlocks] = useState<NoticeBlock[]>(n.blocks);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [error, setError] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [comment, setComment] = useState('');
  const refresh = async () => {
    setError(null);
    await qc.invalidateQueries({ queryKey: ['notices', systemId] });
    await qc.invalidateQueries({ queryKey: ['documents'] });
  };
  const onError = (e: unknown) => setError(errorMessage(e));
  const save = useMutation({
    mutationFn: () => api('PATCH', `/api/v1/notices/${n.id}`, { contentMarkdown: text, blocks }),
    onSuccess: refresh,
    onError,
  });
  const regen = useMutation({
    mutationFn: () => post<NoticeView>(`/api/v1/notices/${n.id}/regenerate`, { blocks }),
    onSuccess: async (r) => (setText(r.contentMarkdown), await refresh()),
    onError,
  });
  const act = useMutation({
    mutationFn: (path: string) => post(`/api/v1/notices/${n.id}/${path}`, path === 'return' ? { comment } : undefined),
    onSuccess: async () => (setReturnOpen(false), await refresh()),
    onError,
  });
  const draft = n.status === 'IN_PROGRESS' || n.status === 'NOT_STARTED';
  const dirty = text !== n.contentMarkdown || JSON.stringify(blocks) !== JSON.stringify(n.blocks);
  return (
    <div className="space-y-3">
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Version {n.version}</span>
        {statusBadge(n.status)}
        <span className="text-grey-500">
          modifiée le {formatDateTime(n.updatedAt)} par {n.updatedBy ?? '—'}
          {n.validatedAt && ` · validée le ${formatDate(n.validatedAt)} par ${n.validatedBy}`}
        </span>
        {n.placeholders > 0 && <Badge tone="yellow">{n.placeholders} mention(s) à compléter</Badge>}
      </div>
      {draft && canManage && (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="mb-1 text-sm font-semibold">Blocs (proposés d’après la qualification, à confirmer)</legend>
          {NOTICE_BLOCKS.map((b) => (
            <label key={b.key} className="flex items-center gap-1" title={b.ref}>
              <input
                type="checkbox"
                checked={blocks.includes(b.key)}
                onChange={(e) => setBlocks(e.target.checked ? [...blocks, b.key] : blocks.filter((x) => x !== b.key))}
              />
              {b.label}
            </label>
          ))}
        </fieldset>
      )}
      {draft && canManage && (
        <div className="flex gap-2">
          <Button size="sm" variant={mode === 'preview' ? 'primary' : 'secondary'} onClick={() => setMode('preview')}>
            Aperçu
          </Button>
          <Button size="sm" variant={mode === 'edit' ? 'primary' : 'secondary'} onClick={() => setMode('edit')}>
            Modifier le texte
          </Button>
        </div>
      )}
      {mode === 'edit' && draft && canManage ? (
        <div>
          <label htmlFor={`notice-${n.id}`} className="sr-only">
            Texte de la notice (Markdown)
          </label>
          <textarea
            id={`notice-${n.id}`}
            rows={18}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-grey-300 px-3 py-2 font-mono text-xs"
          />
          <p className="text-xs text-grey-500">
            Mise en forme admise : # titre, ## sous-titre, **gras**, listes « - ». Le HTML n’est jamais interprété.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-grey-200 bg-white p-4">
          <Markdown source={text} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {draft && canManage && (
          <>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              Enregistrer
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={regen.isPending}
              onClick={() =>
                window.confirm('Régénérer remplace les modifications manuelles du texte. Continuer ?') && regen.mutate()
              }
            >
              Régénérer depuis la fiche
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={dirty || n.placeholders > 0 || act.isPending}
              onClick={() => act.mutate('submit')}
              title={n.placeholders > 0 ? 'Complétez d’abord les mentions signalées' : undefined}
            >
              Soumettre à validation
            </Button>
          </>
        )}
        {n.status === 'IN_REVIEW' && canValidate && (
          <>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('validate')}>
              Valider
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setReturnOpen(true)}>
              Renvoyer en rédaction
            </Button>
          </>
        )}
        <a
          className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
          href={`/api/v1/notices/${n.id}/export?format=md`}
        >
          Exporter (Markdown)
        </a>
        <a
          className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
          href={`/api/v1/notices/${n.id}/export?format=html`}
        >
          Exporter (HTML)
        </a>
        <span className="self-center text-xs text-grey-500">PDF / DOCX : fonctionnalité non implémentée</span>
      </div>
      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Renvoyer la notice en rédaction"
        footer={
          <Button disabled={comment.trim().length < 10} onClick={() => act.mutate('return')}>
            Renvoyer
          </Button>
        }
      >
        <TextField
          label="Commentaire (10 caractères minimum)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Modal>
    </div>
  );
}

export function NoticePanel({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notices', systemId],
    queryFn: () =>
      get<{
        items: NoticeView[];
        transparency: { value: string } | null;
        suggestedBlocks: NoticeBlock[];
        canManage: boolean;
        canValidate: boolean;
      }>(`/api/v1/ai-systems/${systemId}/notices`),
  });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post(`/api/v1/ai-systems/${systemId}/notices`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notices', systemId] }),
    onError: (e) => setError(errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  const current = q.data.items[0];
  const validated = q.data.items.find((n) => n.status === 'VALIDATED');
  const canCreate = q.data.canManage && (!current || ['VALIDATED', 'WITHDRAWN'].includes(current.status));
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base">Notice de transparence</h3>
        <span className="text-sm">
          Transparence (qualification) :{' '}
          <Badge tone={q.data.transparency?.value === 'APPLICABLE' ? 'orange' : 'gray'}>
            {dimLabel('transparency', q.data.transparency?.value)}
          </Badge>
        </span>
      </div>
      <p className="mb-3 text-sm text-grey-600">
        Générée à partir des données de la fiche (sans IA) ; les informations manquantes sont signalées « [À compléter]
        » et bloquent la soumission. À la validation, la notice est ajoutée aux pièces du SIA.
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      {validated && current && validated.id !== current.id && (
        <p className="mb-2 text-sm">
          Version en vigueur : v{validated.version}, validée le {formatDate(validated.validatedAt)}.
        </p>
      )}
      {current ? (
        <NoticeEditor
          key={`${current.id}-${current.updatedAt}`}
          n={current}
          systemId={systemId}
          canManage={q.data.canManage}
          canValidate={q.data.canValidate}
        />
      ) : (
        <EmptyState>Aucune notice.</EmptyState>
      )}
      {canCreate && (
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {current ? 'Préparer une nouvelle version' : 'Générer la notice'}
        </Button>
      )}
      {q.data.items.length > 1 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-gls-blue">Versions précédentes</summary>
          <ul className="mt-1 space-y-1">
            {q.data.items.slice(1).map((n) => (
              <li key={n.id}>
                v{n.version} — {WORK_STATUS_META[n.status].label}
                {n.validatedAt && ` (validée le ${formatDate(n.validatedAt)})`} ·{' '}
                <a className="text-gls-blue hover:underline" href={`/api/v1/notices/${n.id}/export?format=md`}>
                  exporter
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

// ═════════════════════════════ DPIA ═════════════════════════════
interface DpiaView {
  id: string;
  reference: string;
  title: string;
  status: WorkStatus;
  externalUrl: string;
  conductedOn: string | null;
  conclusion: string;
  coveredTopics: FriaSectionKey[];
}

function DpiaForm({ systemId, d, onDone }: { systemId: string; d?: DpiaView; onDone: () => void }) {
  const [f, setF] = useState({
    title: d?.title ?? '',
    status: d?.status ?? 'NOT_STARTED',
    externalUrl: d?.externalUrl ?? '',
    conductedOn: d?.conductedOn ?? '',
    conclusion: d?.conclusion ?? '',
    coveredTopics: d?.coveredTopics ?? ([] as FriaSectionKey[]),
  });
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => {
      const body = { ...f, conductedOn: f.conductedOn || null };
      return d ? api('PATCH', `/api/v1/dpias/${d.id}`, body) : post(`/api/v1/ai-systems/${systemId}/dpias`, body);
    },
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div className="space-y-2 rounded-xl bg-grey-50 p-3">
      {error && <Alert tone="red">{error}</Alert>}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <TextField label="Intitulé" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <SelectField
          label="Statut"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value as WorkStatus })}
        >
          {WORK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {WORK_STATUS_META[s].label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Lien vers l’outil RGPD (facultatif, jamais ouvert par le serveur)"
          value={f.externalUrl}
          onChange={(e) => setF({ ...f, externalUrl: e.target.value })}
        />
        <TextField
          label="Réalisée le"
          type="date"
          value={f.conductedOn}
          onChange={(e) => setF({ ...f, conductedOn: e.target.value })}
        />
        <TextField
          className="md:col-span-2"
          label="Conclusion"
          value={f.conclusion}
          onChange={(e) => setF({ ...f, conclusion: e.target.value })}
        />
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1 font-semibold">
          Thèmes de la FRIA traités par cette DPIA (réutilisables sans double saisie)
        </legend>
        <div className="flex flex-wrap gap-3">
          {FRIA_SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={f.coveredTopics.includes(s.key)}
                onChange={(e) =>
                  setF({
                    ...f,
                    coveredTopics: e.target.checked
                      ? [...f.coveredTopics, s.key]
                      : f.coveredTopics.filter((x) => x !== s.key),
                  })
                }
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Button size="sm" disabled={f.title.trim().length < 3 || mut.isPending} onClick={() => mut.mutate()}>
        {d ? 'Enregistrer' : 'Référencer la DPIA'}
      </Button>
    </div>
  );
}

export function DpiaPanel({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dpias', systemId],
    queryFn: () => get<{ items: DpiaView[]; canManage: boolean }>(`/api/v1/ai-systems/${systemId}/dpias`),
  });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const done = () => (
    setEditing(null),
    void qc.invalidateQueries({ queryKey: ['dpias', systemId] }),
    void qc.invalidateQueries({ queryKey: ['frias', systemId] })
  );
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <Card>
      <h3 className="mb-1 text-base">DPIA / AIPD</h3>
      <p className="mb-3 text-sm text-grey-600">
        Référence vers une analyse d’impact RGPD réalisée ici ou dans un outil tiers. Les thèmes cochés peuvent être
        repris dans la FRIA (art. 27(4)).
      </p>
      {q.data.items.length === 0 ? (
        <EmptyState>Aucune DPIA référencée.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100 text-sm">
          {q.data.items.map((d) => (
            <li key={d.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-mono text-xs text-grey-500">{d.reference}</span>{' '}
                  <span className="font-semibold">{d.title}</span> {statusBadge(d.status)}
                  {d.conductedOn && <span className="text-grey-500"> · réalisée le {formatDate(d.conductedOn)}</span>}
                </span>
                <span className="flex gap-1">
                  {d.externalUrl && (
                    <a
                      className="text-gls-blue hover:underline"
                      href={d.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      Ouvrir ↗
                    </a>
                  )}
                  {q.data.canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(editing === d.id ? null : d.id)}>
                      Modifier
                    </Button>
                  )}
                </span>
              </div>
              <p className="text-xs text-grey-600">
                Thèmes FRIA couverts :{' '}
                {d.coveredTopics.map((t) => FRIA_SECTIONS.find((s) => s.key === t)?.label).join(', ') || '—'}
              </p>
              {editing === d.id && <DpiaForm systemId={systemId} d={d} onDone={done} />}
            </li>
          ))}
        </ul>
      )}
      {q.data.canManage &&
        (editing === 'new' ? (
          <div className="mt-3">
            <DpiaForm systemId={systemId} onDone={done} />
          </div>
        ) : (
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => setEditing('new')}>
            Référencer une DPIA
          </Button>
        ))}
    </Card>
  );
}

// ═════════════════════════════ FRIA ═════════════════════════════
interface FriaView {
  id: string;
  version: number;
  status: WorkStatus;
  sections: Record<string, string>;
  dpia: { id: string; reference: string; title: string; coveredTopics: string[] } | null;
  coveredByDpia: FriaSectionKey[];
  conclusion: string;
  missingSections: FriaSectionKey[];
  validatedAt: string | null;
  validatedBy: string | null;
  notifiedAuthorityAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

function FriaEditor({
  f,
  systemId,
  suggestions,
  dpias,
  canManage,
}: {
  f: FriaView;
  systemId: string;
  suggestions: Record<string, string>;
  dpias: DpiaView[];
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [sections, setSections] = useState<Record<string, string>>(f.sections);
  const [conclusion, setConclusion] = useState(f.conclusion);
  const [dpiaId, setDpiaId] = useState(f.dpia?.id ?? '');
  const [covered, setCovered] = useState<FriaSectionKey[]>(f.coveredByDpia);
  const [notifDate, setNotifDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => (setError(null), void qc.invalidateQueries({ queryKey: ['frias', systemId] }));
  const onError = (e: unknown) => setError(errorMessage(e));
  const save = useMutation({
    mutationFn: () =>
      api('PATCH', `/api/v1/frias/${f.id}`, {
        sections,
        conclusion,
        dpiaId: dpiaId || null,
        coveredByDpia: dpiaId ? covered : [],
      }),
    onSuccess: refresh,
    onError,
  });
  const act = useMutation({
    mutationFn: (p: string) =>
      post(`/api/v1/frias/${f.id}/${p}`, p === 'authority-notification' ? { date: notifDate } : {}),
    onSuccess: refresh,
    onError,
  });
  const draft = f.status === 'IN_PROGRESS' || f.status === 'NOT_STARTED';
  const editable = draft && canManage;
  const dpia = dpias.find((d) => d.id === dpiaId);
  return (
    <div className="space-y-3">
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Version {f.version}</span>
        {statusBadge(f.status)}
        <span className="text-grey-500">
          modifiée le {formatDateTime(f.updatedAt)} par {f.updatedBy ?? '—'}
          {f.validatedAt && ` · validée le ${formatDate(f.validatedAt)} par ${f.validatedBy}`}
          {f.notifiedAuthorityAt && ` · notifiée à l’autorité le ${formatDate(f.notifiedAuthorityAt)}`}
        </span>
      </div>
      <SelectField
        label="DPIA réutilisée"
        value={dpiaId}
        disabled={!editable}
        onChange={(e) => setDpiaId(e.target.value)}
      >
        <option value="">Aucune</option>
        {dpias.map((d) => (
          <option key={d.id} value={d.id}>
            {d.reference} — {d.title}
          </option>
        ))}
      </SelectField>
      {FRIA_SECTIONS.map((s) => {
        const canCover = !!dpia?.coveredTopics.includes(s.key);
        const isCovered = canCover && covered.includes(s.key);
        const missing = f.missingSections.includes(s.key);
        return (
          <div key={s.key} className="rounded-xl border border-grey-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`fria-${f.id}-${s.key}`} className="text-sm font-bold">
                {s.label} <span className="font-normal text-grey-500">({s.ref})</span>{' '}
                {missing && <Badge tone="yellow">À compléter</Badge>}
              </label>
              {canCover && (
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={isCovered}
                    onChange={(e) =>
                      setCovered(e.target.checked ? [...covered, s.key] : covered.filter((x) => x !== s.key))
                    }
                  />
                  Traité dans la DPIA {dpia?.reference}
                </label>
              )}
            </div>
            <p className="text-xs text-grey-500">{s.guidance}</p>
            {!isCovered && (
              <textarea
                id={`fria-${f.id}-${s.key}`}
                rows={3}
                disabled={!editable}
                value={sections[s.key] ?? ''}
                onChange={(e) => setSections({ ...sections, [s.key]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-grey-300 bg-white px-3 py-2 text-sm disabled:bg-grey-50"
              />
            )}
            {editable && !isCovered && suggestions[s.key] && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setSections({
                    ...sections,
                    [s.key]: `${sections[s.key] ? `${sections[s.key]}\n` : ''}${suggestions[s.key]}`,
                  })
                }
              >
                Insérer la proposition issue de la fiche
              </Button>
            )}
          </div>
        );
      })}
      <div>
        <label htmlFor={`fria-${f.id}-conclusion`} className="text-sm font-bold">
          Conclusion
        </label>
        <textarea
          id={`fria-${f.id}-conclusion`}
          rows={3}
          disabled={!editable}
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
          className="mt-1 w-full rounded-lg border border-grey-300 bg-white px-3 py-2 text-sm disabled:bg-grey-50"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {editable && (
          <>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              Enregistrer
            </Button>
            <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate('submit')}>
              Soumettre à validation
            </Button>
          </>
        )}
        {f.status === 'IN_REVIEW' && canManage && (
          <>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('validate')}>
              Valider
            </Button>
            <Button size="sm" variant="secondary" onClick={() => act.mutate('return')}>
              Renvoyer en rédaction
            </Button>
          </>
        )}
        {f.status === 'VALIDATED' && canManage && !f.notifiedAuthorityAt && (
          <span className="flex items-end gap-2">
            <TextField
              label="Notifiée à l’autorité le (art. 27(3))"
              type="date"
              value={notifDate}
              onChange={(e) => setNotifDate(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!notifDate}
              onClick={() => act.mutate('authority-notification')}
            >
              Enregistrer
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

export function FriaPanel({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['frias', systemId],
    queryFn: () =>
      get<{
        items: FriaView[];
        requirement: { value: string } | null;
        suggestions: Record<string, string>;
        canManage: boolean;
      }>(`/api/v1/ai-systems/${systemId}/frias`),
  });
  const dpias = useQuery({
    queryKey: ['dpias', systemId],
    queryFn: () => get<{ items: DpiaView[] }>(`/api/v1/ai-systems/${systemId}/dpias`),
  });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post(`/api/v1/ai-systems/${systemId}/frias`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['frias', systemId] }),
    onError: (e) => setError(errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  const current = q.data.items[0];
  const req = q.data.requirement?.value;
  const canCreate = q.data.canManage && (!current || ['VALIDATED', 'WITHDRAWN'].includes(current.status));
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base">FRIA — analyse d’impact sur les droits fondamentaux</h3>
        <span className="text-sm">
          Exigence (qualification) :{' '}
          <Badge tone={req === 'REQUIRED' ? 'red' : req === 'TO_CONFIRM' ? 'yellow' : 'gray'}>
            {dimLabel('fria', req)}
          </Badge>
        </span>
      </div>
      <p className="mb-3 text-sm text-grey-600">
        Contenu de l’art. 27(1) a) à f). Les propositions issues de la fiche ne sont insérées qu’à votre demande.
        Validation par une autre personne que le dernier rédacteur.
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      {current ? (
        <FriaEditor
          key={`${current.id}-${current.updatedAt}`}
          f={current}
          systemId={systemId}
          suggestions={q.data.suggestions}
          dpias={dpias.data?.items ?? []}
          canManage={q.data.canManage}
        />
      ) : (
        <EmptyState>Aucune FRIA.</EmptyState>
      )}
      {canCreate && (
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {current ? 'Nouvelle version' : 'Commencer la FRIA'}
        </Button>
      )}
      {!q.data.canManage && (
        <p className="mt-2 text-xs text-grey-500">Rédaction réservée aux rôles DPO et juridique.</p>
      )}
    </Card>
  );
}
