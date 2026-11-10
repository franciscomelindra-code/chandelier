import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MODEL_ACCESS_LABELS,
  MODEL_ACCESS_MODES,
  MODEL_STATUSES,
  MODEL_STATUS_META,
  MODEL_TYPES,
  MODEL_TYPE_LABELS,
} from '@chandelier/shared';
import { api, errorMessage, get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { useCatalog } from '../../lib/queries';
import type { AiModel, AiModelDetail, Vendor } from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  SelectField,
  Spinner,
  TextField,
} from '../../components/ui';
import { CatalogForm, opts, type FieldDef } from '../referentials/ReferentialsPage';
import { triLabel } from '../ai-systems/wizard/form';
import { StatusBadge } from '../ai-systems/badges';

const typeLabel = (t: string) => MODEL_TYPE_LABELS[t as keyof typeof MODEL_TYPE_LABELS] ?? t;
const accessLabel = (t: string | null) => (t ? (MODEL_ACCESS_LABELS[t as keyof typeof MODEL_ACCESS_LABELS] ?? t) : '—');
const StatusTag = ({ v }: { v: string }) => {
  const m = MODEL_STATUS_META[v as keyof typeof MODEL_STATUS_META];
  return <Badge tone={m?.tone ?? 'gray'}>{m?.label ?? v}</Badge>;
};
const GpaiTag = ({ m }: { m: Pick<AiModel, 'isGpai' | 'gpaiSystemicRisk'> }) =>
  m.isGpai === 'YES' ? (
    <Badge tone={m.gpaiSystemicRisk === 'YES' ? 'orange' : 'blue'}>
      GPAI{m.gpaiSystemicRisk === 'YES' ? ' · risque systémique' : ''}
    </Badge>
  ) : m.isGpai === 'UNKNOWN' ? (
    <Badge tone="gray">GPAI : non renseigné</Badge>
  ) : null;

function modelFields(vendors: Vendor[]): FieldDef[] {
  return [
    { key: 'name', label: 'Nom', kind: 'text', required: true },
    { key: 'version', label: 'Version', kind: 'text' },
    { key: 'family', label: 'Famille', kind: 'text' },
    {
      key: 'vendorId',
      label: 'Fournisseur',
      kind: 'select',
      options: vendors.map((v) => [v.id, v.name] as const),
      nullable: true,
    },
    { key: 'type', label: 'Type', kind: 'select', options: opts(MODEL_TYPES, MODEL_TYPE_LABELS) },
    {
      key: 'accessMode',
      label: 'Modalité d’accès',
      kind: 'select',
      options: opts(MODEL_ACCESS_MODES, MODEL_ACCESS_LABELS),
    },
    {
      key: 'status',
      label: 'Statut',
      kind: 'select',
      options: MODEL_STATUSES.map((s) => [s, MODEL_STATUS_META[s].label] as const),
    },
    { key: 'hosting', label: 'Hébergement', kind: 'text' },
    { key: 'regions', label: 'Zones géographiques', kind: 'list', hint: 'Ex. : UE, États-Unis' },
    { key: 'documentationUrl', label: 'URL de documentation', kind: 'text' },
    { key: 'knowledgeDate', label: 'Date de connaissance', kind: 'date' },
    { key: 'versionDate', label: 'Date de version', kind: 'date' },
    { key: 'license', label: 'Licence', kind: 'text' },
    { key: 'isGpai', label: 'Modèle d’IA à usage général (GPAI)', kind: 'tri' },
    { key: 'gpaiSystemicRisk', label: 'GPAI à risque systémique', kind: 'tri' },
    { key: 'description', label: 'Description', kind: 'area' },
    { key: 'capabilities', label: 'Capacités', kind: 'area' },
    { key: 'knownLimitations', label: 'Limites connues', kind: 'area' },
    { key: 'gpaiNotes', label: 'Informations GPAI (documentation fournisseur, obligations art. 53…)', kind: 'area' },
  ];
}

const EMPTY_MODEL = {
  name: '',
  version: '',
  family: '',
  vendorId: null,
  type: 'LLM',
  accessMode: 'API',
  status: 'UNDER_EVALUATION',
  hosting: '',
  regions: [],
  documentationUrl: '',
  knowledgeDate: null,
  versionDate: null,
  license: '',
  isGpai: 'UNKNOWN',
  gpaiSystemicRisk: 'UNKNOWN',
  description: '',
  capabilities: '',
  knownLimitations: '',
  gpaiNotes: '',
};

function ModelEditor({
  model,
  onClose,
  onSaved,
}: {
  model: AiModel | null;
  onClose: () => void;
  onSaved: (m: AiModel) => void;
}) {
  const vendors = useCatalog<Vendor>('vendors');
  const [error, setError] = useState<string | null>(null);
  const fields = modelFields(vendors.data?.items ?? []);
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const body = Object.fromEntries(fields.map((f) => [f.key, v[f.key]]));
      return model
        ? api<AiModel>('PATCH', `/api/v1/ai-models/${model.id}`, body)
        : api<AiModel>('POST', '/api/v1/ai-models', body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal open title={model ? `Modifier — ${model.name}` : 'Nouveau modèle d’IA'} onClose={onClose}>
      {vendors.isPending ? (
        <Spinner />
      ) : (
        <CatalogForm
          fields={fields}
          initial={model ? (model as unknown as Record<string, unknown>) : EMPTY_MODEL}
          pending={save.isPending}
          error={error}
          onSubmit={(v) => {
            setError(null);
            save.mutate(v);
          }}
        />
      )}
    </Modal>
  );
}

export function ModelsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const models = useCatalog<AiModel>('ai-models');
  const vendors = useCatalog<Vendor>('vendors');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [gpai, setGpai] = useState('');
  const [editing, setEditing] = useState<AiModel | 'new' | null>(null);
  const items = (models.data?.items ?? []).filter(
    (m) =>
      (!q || `${m.name} ${m.family} ${m.version}`.toLowerCase().includes(q.toLowerCase())) &&
      (!type || m.type === type) &&
      (!status || m.status === status) &&
      (!vendorId || m.vendorId === vendorId) &&
      (!gpai || m.isGpai === gpai),
  );
  return (
    <>
      <PageHeader
        eyebrow="Référentiel"
        title="Modèles d’IA"
        description="Modèles et services sous-jacents, réutilisables par plusieurs systèmes. Un système d’IA n’est pas son modèle : chaque lien porte sa propre description de l’utilisation."
        actions={can('catalog:manage') && <Button onClick={() => setEditing('new')}>Nouveau modèle</Button>}
      />
      <Card className="mb-4 !p-4">
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            className="min-w-56 flex-1"
            label="Rechercher"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField className="w-52" label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tous</option>
            {MODEL_TYPES.map((t) => (
              <option key={t} value={t}>
                {MODEL_TYPE_LABELS[t]}
              </option>
            ))}
          </SelectField>
          <SelectField className="w-44" label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            {MODEL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MODEL_STATUS_META[s].label}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="w-48"
            label="Fournisseur"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          >
            <option value="">Tous</option>
            {vendors.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </SelectField>
          <SelectField className="w-36" label="GPAI" value={gpai} onChange={(e) => setGpai(e.target.value)}>
            <option value="">Tous</option>
            <option value="YES">Oui</option>
            <option value="NO">Non</option>
            <option value="UNKNOWN">Non renseigné</option>
          </SelectField>
        </div>
      </Card>
      {models.isPending ? (
        <Spinner />
      ) : models.isError ? (
        <Alert tone="red">{errorMessage(models.error)}</Alert>
      ) : items.length === 0 ? (
        <EmptyState>
          {models.data.items.length ? 'Aucun modèle ne correspond.' : 'Le référentiel des modèles est vide.'}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((m) => (
            <li key={m.id}>
              <Link
                to={`/modeles/${m.id}`}
                className="block h-full rounded-[var(--radius-card)] bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-grey-500">{m.vendor?.name ?? 'Fournisseur non renseigné'}</span>
                  <StatusTag v={m.status} />
                </div>
                <h2 className="mt-1 text-lg leading-snug">
                  {m.name} {m.version && <span className="text-base font-semibold text-grey-500">{m.version}</span>}
                </h2>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge tone="blue">{typeLabel(m.type)}</Badge>
                  <Badge tone="gray">{accessLabel(m.accessMode)}</Badge>
                  <GpaiTag m={m} />
                </div>
                <p className="mt-3 text-xs text-grey-500">
                  Utilisé par {m.usage} SIA{m.regions.length ? ` · ${m.regions.join(', ')}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ModelEditor
          model={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ['catalog', 'ai-models'] });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

export function ModelPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const d = useQuery({ queryKey: ['ai-model', id], queryFn: () => get<AiModelDetail>(`/api/v1/ai-models/${id}`) });
  if (d.isPending) return <Spinner />;
  if (d.isError) return <Alert tone="red">{errorMessage(d.error)}</Alert>;
  const m = d.data;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[13rem_1fr] gap-2 border-b border-grey-100 py-1.5 text-sm">
      <dt className="font-semibold text-grey-600">{label}</dt>
      <dd className="whitespace-pre-line">{value || <span className="text-grey-400">—</span>}</dd>
    </div>
  );
  return (
    <>
      <nav aria-label="Fil d’Ariane" className="text-xs text-grey-500">
        <Link to="/modeles" className="hover:underline">
          Modèles d’IA
        </Link>{' '}
        › {m.name}
      </nav>
      <PageHeader
        title={`${m.name}${m.version ? ` ${m.version}` : ''}`}
        description={
          <span className="flex flex-wrap gap-1">
            <StatusTag v={m.status} />
            <Badge tone="blue">{typeLabel(m.type)}</Badge>
            <Badge tone="gray">{accessLabel(m.accessMode)}</Badge>
            <GpaiTag m={m} />
          </span>
        }
        actions={can('catalog:manage') && <Button onClick={() => setEditing(true)}>Modifier</Button>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-3 text-lg">Fiche modèle</h2>
          <dl>
            {row('Fournisseur', m.vendor?.name)}
            {row('Famille', m.family)}
            {row('Hébergement', m.hosting)}
            {row('Zones géographiques', m.regions.join(', '))}
            {row('Date de connaissance', m.knowledgeDate ? formatDate(m.knowledgeDate) : null)}
            {row('Date de version', m.versionDate ? formatDate(m.versionDate) : null)}
            {row('Licence', m.license)}
            {row(
              'Documentation',
              m.documentationUrl && (
                <a
                  className="text-gls-blue underline"
                  href={m.documentationUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {m.documentationUrl}
                </a>
              ),
            )}
            {row('GPAI', `${triLabel(m.isGpai)} — risque systémique : ${triLabel(m.gpaiSystemicRisk)}`)}
            {row('Informations GPAI', m.gpaiNotes)}
            {row('Description', m.description)}
            {row('Capacités', m.capabilities)}
            {row('Limites connues', m.knownLimitations)}
          </dl>
          <p className="mt-3 text-xs text-grey-500">
            Pièces justificatives du modèle : fonctionnalité non implémentée (tranche S7).
          </p>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg">Systèmes d’IA utilisateurs</h2>
          {m.systems.length === 0 ? (
            <EmptyState>Aucun SIA de votre périmètre n’utilise ce modèle.</EmptyState>
          ) : (
            <ul className="divide-y divide-grey-100">
              {m.systems.map((l) => (
                <li key={l.linkId} className="py-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/systemes/${l.system.id}?etape=models`}
                      className="font-semibold text-gls-blue hover:underline"
                    >
                      {l.system.reference} — {l.system.name}
                    </Link>
                    <StatusBadge value={l.system.status} />
                    {l.isPrimary && <Badge tone="blue">Modèle principal</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-grey-700">
                    <span className="font-semibold">Utilisation :</span> {l.usageDescription}
                  </p>
                  <p className="text-xs text-grey-500">
                    Version utilisée : {l.versionUsed || m.version || '—'} · accès : {accessLabel(l.hostingMode)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {m.hiddenSystems > 0 && (
            <p className="mt-3 text-xs text-grey-500">
              {m.hiddenSystems} autre{m.hiddenSystems > 1 ? 's' : ''} SIA hors de votre périmètre (non affiché
              {m.hiddenSystems > 1 ? 's' : ''}).
            </p>
          )}
        </Card>
      </div>
      {editing && (
        <ModelEditor
          model={m}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ['ai-model', id] });
            await qc.invalidateQueries({ queryKey: ['catalog', 'ai-models'] });
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
