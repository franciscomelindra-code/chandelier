import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AI_ACT_ROLES,
  AI_ACT_ROLE_LABELS,
  AI_SYSTEM_STATUSES,
  AI_SYSTEM_STATUS_META,
  EDITABLE_STATUSES,
  RISK_CATEGORIES,
  RISK_CATEGORY_META,
  VALUE_LEVELS,
  VALUE_LEVEL_META,
} from '@chandelier/shared';
import { ApiError, api, errorMessage, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { indent, useActiveUsers, useCatalog, useOrgUnits, useTags } from '../../lib/queries';
import type { AiModel, AiSystemListItem, Page, SavedView, Vendor } from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  SelectField,
  Spinner,
  TextField,
} from '../../components/ui';
import { CompletenessBar, RiskBadge, StatusBadge, ValueBadge, rolesLabel } from './badges';
import { CreateSystemModal } from './CreateSystemModal';

// ── Colonnes ────────────────────────────────────────────────────────────────
interface Column {
  key: string;
  label: string;
  sort?: string;
  render: (s: AiSystemListItem) => ReactNode;
}
const COLUMNS: Column[] = [
  {
    key: 'reference',
    label: 'Référence',
    sort: 'reference',
    render: (s) => <span className="whitespace-nowrap font-mono text-xs">{s.reference}</span>,
  },
  {
    key: 'name',
    label: 'Nom',
    sort: 'name',
    render: (s) => (
      <div className="min-w-56">
        <Link to={`/systemes/${s.id}`} className="font-semibold text-gls-blue hover:underline">
          {s.name}
        </Link>
        {s.isDemo && (
          <span className="ml-2">
            <Badge tone="yellow">DEMO</Badge>
          </span>
        )}
        {s.purpose && <p className="line-clamp-1 text-xs text-grey-500">{s.purpose}</p>}
      </div>
    ),
  },
  { key: 'status', label: 'Statut', sort: 'status', render: (s) => <StatusBadge value={s.status} /> },
  { key: 'risk', label: 'Niveau de risque', sort: 'riskCategory', render: (s) => <RiskBadge value={s.riskCategory} /> },
  { key: 'value', label: 'Valeur ajoutée', sort: 'valueLevel', render: (s) => <ValueBadge value={s.valueLevel} /> },
  { key: 'orgUnit', label: 'Unité', render: (s) => s.orgUnit.name },
  {
    key: 'owner',
    label: 'Propriétaire',
    render: (s) => s.owner?.displayName ?? <span className="text-grey-400">—</span>,
  },
  {
    key: 'businessOwner',
    label: 'Responsable métier',
    render: (s) => s.businessOwner?.displayName ?? <span className="text-grey-400">—</span>,
  },
  { key: 'roles', label: 'Rôle(s) AI Act', render: (s) => rolesLabel(s.aiActRoles) },
  {
    key: 'vendors',
    label: 'Fournisseurs',
    render: (s) => (s.vendors.length ? s.vendors.join(', ') : <span className="text-grey-400">—</span>),
  },
  {
    key: 'models',
    label: 'Modèles',
    render: (s) =>
      s.models.length ? (
        s.models.map((m) => `${m.name}${m.version ? ` ${m.version}` : ''}`).join(', ')
      ) : (
        <span className="text-grey-400">—</span>
      ),
  },
  {
    key: 'tags',
    label: 'Tags',
    render: (s) => (
      <div className="flex flex-wrap gap-1">
        {s.tags.map((t) => (
          <Badge key={t.id} tone="blue">
            {t.label}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    key: 'completeness',
    label: 'Complétude',
    sort: 'completeness',
    render: (s) => <CompletenessBar value={s.completeness} compact />,
  },
  { key: 'nextReview', label: 'Prochaine revue', sort: 'nextReviewDate', render: (s) => formatDate(s.nextReviewDate) },
  { key: 'updatedAt', label: 'Modifié le', sort: 'updatedAt', render: (s) => formatDate(s.updatedAt) },
];
const DEFAULT_COLUMNS = [
  'reference',
  'name',
  'status',
  'risk',
  'value',
  'orgUnit',
  'owner',
  'models',
  'completeness',
  'nextReview',
];

// Paramètres d'URL relayés à l'API (les autres — vue, colonnes — sont propres à l'interface).
const API_PARAMS = [
  'q',
  'status',
  'risk',
  'value',
  'role',
  'orgUnitId',
  'ownerId',
  'tagId',
  'vendorId',
  'modelId',
  'archived',
  'demo',
  'sort',
  'dir',
  'page',
];

function apiQuery(sp: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of API_PARAMS) {
    const v = sp.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}

// ── Filtre à choix multiples (liste séparée par des virgules dans l'URL) ────
function MultiFilter({
  label,
  param,
  options,
  sp,
  set,
}: {
  label: string;
  param: string;
  options: { value: string; label: string }[];
  sp: URLSearchParams;
  set: (k: string, v: string | null) => void;
}) {
  const selected = (sp.get(param) ?? '').split(',').filter(Boolean);
  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    set(param, next.length ? next.join(',') : null);
  };
  return (
    <details className="relative">
      <summary
        className={clsx(
          'cursor-pointer list-none rounded-full border px-3 py-1.5 text-sm font-semibold',
          selected.length ? 'border-gls-blue bg-gls-blue-050 text-gls-blue' : 'border-grey-300 bg-white text-grey-700',
        )}
      >
        {label}
        {selected.length > 0 && ` (${selected.length})`} ▾
      </summary>
      <fieldset className="absolute z-20 mt-1 min-w-56 space-y-1 rounded-xl border border-grey-200 bg-white p-3 shadow-pop">
        <legend className="sr-only">{label}</legend>
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

// ── Barre d'actions de masse ────────────────────────────────────────────────
type BulkAction = 'assignOwner' | 'setOrgUnit' | 'setStatus' | 'addTags' | 'removeTags' | 'archive';
const BULK_LABELS: Record<BulkAction, string> = {
  assignOwner: 'Assigner un propriétaire',
  setOrgUnit: 'Changer d’unité',
  setStatus: 'Changer de statut',
  addTags: 'Ajouter un tag',
  removeTags: 'Retirer un tag',
  archive: 'Archiver',
};

function BulkModal({
  action,
  ids,
  onClose,
  onDone,
}: {
  action: BulkAction;
  ids: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const units = useOrgUnits();
  const users = useActiveUsers();
  const tags = useTags();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { action, ids };
      if (action === 'assignOwner') body.ownerId = value;
      if (action === 'setOrgUnit') body.orgUnitId = value;
      if (action === 'setStatus') body.status = value;
      if (action === 'addTags' || action === 'removeTags') body.tagIds = [value];
      if (action === 'archive') body.reason = value;
      return post('/api/v1/ai-systems/bulk', body);
    },
    onSuccess: onDone,
    onError: (e) => {
      const denied = e instanceof ApiError ? (e.details as { denied?: string[] } | undefined)?.denied : undefined;
      setError(denied?.length ? `${errorMessage(e)} SIA concernés : ${denied.join(', ')}` : errorMessage(e));
    },
  });
  return (
    <Modal
      open
      title={`${BULK_LABELS[action]} — ${ids.length} SIA`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={action === 'archive' ? 'danger' : 'primary'}
            disabled={run.isPending || (action === 'archive' ? value.trim().length < 10 : !value)}
            onClick={() => run.mutate()}
          >
            Appliquer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="red">{error}</Alert>}
        <p className="text-sm text-grey-600">
          L’opération est appliquée à tous les SIA sélectionnés ou à aucun : si un seul n’est pas modifiable par vous,
          rien n’est changé.
        </p>
        {action === 'assignOwner' && (
          <SelectField label="Nouveau propriétaire" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">— Choisir —</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </SelectField>
        )}
        {action === 'setOrgUnit' && (
          <SelectField label="Nouvelle unité" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">— Choisir —</option>
            {units.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {indent(u.depth)}
                {u.name}
              </option>
            ))}
          </SelectField>
        )}
        {action === 'setStatus' && (
          <SelectField label="Nouveau statut" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">— Choisir —</option>
            {EDITABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {AI_SYSTEM_STATUS_META[s].label}
              </option>
            ))}
          </SelectField>
        )}
        {(action === 'addTags' || action === 'removeTags') && (
          <SelectField label="Tag" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">— Choisir —</option>
            {tags.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectField>
        )}
        {action === 'archive' && (
          <TextField
            label="Justification de l’archivage"
            required
            hint="10 caractères minimum ; conservée dans le journal."
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>
    </Modal>
  );
}

// ── Vues sauvegardées ───────────────────────────────────────────────────────
function SavedViews({
  sp,
  columns,
  layout,
  apply,
}: {
  sp: URLSearchParams;
  columns: string[];
  layout: 'table' | 'cards';
  apply: (v: SavedView) => void;
}) {
  const qc = useQueryClient();
  const views = useQuery({
    queryKey: ['saved-views'],
    queryFn: () => get<{ items: SavedView[] }>('/api/v1/saved-views?scope=ai-systems'),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      post('/api/v1/saved-views', {
        name,
        scope: 'ai-systems',
        isShared: shared,
        state: { query: apiQuery(sp).replace(/(^|&)page=\d+/, ''), columns, layout },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['saved-views'] });
      setOpen(false);
      setName('');
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const [chosen, setChosen] = useState('');
  const chosenView = views.data?.items.find((x) => x.id === chosen);
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/api/v1/saved-views/${id}`),
    onSuccess: async () => {
      setChosen('');
      await qc.invalidateQueries({ queryKey: ['saved-views'] });
    },
  });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField
        label="Vue"
        value={chosen}
        onChange={(e) => {
          setChosen(e.target.value);
          const v = views.data?.items.find((x) => x.id === e.target.value);
          if (v) apply(v);
        }}
      >
        <option value="">— Vues enregistrées —</option>
        {views.data?.items.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.isShared ? ` (partagée${v.mine ? '' : ` par ${v.ownerName}`})` : ''}
          </option>
        ))}
      </SelectField>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Enregistrer la vue
      </Button>
      {chosenView?.mine && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (confirm(`Supprimer la vue « ${chosenView.name} » ?`)) remove.mutate(chosenView.id);
          }}
        >
          Supprimer la vue
        </Button>
      )}
      <Modal
        open={open}
        title="Enregistrer la vue courante"
        onClose={() => setOpen(false)}
        footer={
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="red">{error}</Alert>}
          <p className="text-sm text-grey-600">Filtres, tri, colonnes et disposition actuels sont enregistrés.</p>
          <TextField label="Nom de la vue" required value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Partager avec tous les utilisateurs (chacun ne voit que les SIA de son périmètre)
          </label>
        </div>
      </Modal>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export function RegistryPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const units = useOrgUnits();
  const users = useActiveUsers();
  const tags = useTags();
  const vendorList = useCatalog<Vendor>('vendors');
  const modelList = useCatalog<AiModel>('ai-models');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState(sp.get('q') ?? '');

  const layout = sp.get('view') === 'cards' ? 'cards' : 'table';
  const columns = useMemo(
    () => (sp.get('cols') ?? DEFAULT_COLUMNS.join(',')).split(',').filter((c) => COLUMNS.some((x) => x.key === c)),
    [sp],
  );
  const sort = sp.get('sort') ?? 'updatedAt';
  const dir = sp.get('dir') ?? 'desc';
  const query = apiQuery(sp);

  const set = (k: string, v: string | null, resetPage = true) => {
    const next = new URLSearchParams(sp);
    if (v === null || v === '') next.delete(k);
    else next.set(k, v);
    if (resetPage && k !== 'page') next.delete('page');
    setSp(next, { replace: true });
  };

  // Recherche différée (300 ms) pour limiter les requêtes.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get('q') ?? '') !== q) set('q', q || null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useQuery({
    queryKey: ['ai-systems', query],
    queryFn: () => get<Page<AiSystemListItem>>(`/api/v1/ai-systems?${query}`),
    placeholderData: keepPreviousData,
  });

  useEffect(() => setSelected(new Set()), [query]);

  const toggleSort = (field: string) => {
    const next = new URLSearchParams(sp);
    if (sort === field) next.set('dir', dir === 'asc' ? 'desc' : 'asc');
    else {
      next.set('sort', field);
      next.set('dir', field === 'name' || field === 'reference' ? 'asc' : 'desc');
    }
    next.delete('page');
    setSp(next, { replace: true });
  };

  const visibleCols = COLUMNS.filter((c) => columns.includes(c.key));
  const items = list.data?.items ?? [];
  const selectable = items.filter((i) => i.canUpdate || i.canArchive);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const filtersActive = API_PARAMS.filter((k) => !['sort', 'dir', 'page'].includes(k)).some((k) => sp.get(k));

  return (
    <>
      <PageHeader
        eyebrow="Registre"
        title="Systèmes d’IA"
        description="Registre central des systèmes d’intelligence artificielle. Le niveau de risque est issu de la qualification AI Act (tranche S5) : il reste « À déterminer » tant qu’aucune évaluation n’est réalisée."
        actions={
          <>
            {can('aiSystem:export') && (
              <>
                <a
                  className="inline-flex items-center rounded-full border-2 border-gls-blue px-4 py-2 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
                  href={`/api/v1/ai-systems/export?format=csv&${query}`}
                >
                  Export CSV
                </a>
                <a
                  className="inline-flex items-center rounded-full border-2 border-gls-blue px-4 py-2 text-sm font-bold text-gls-blue hover:bg-gls-blue-050"
                  href={`/api/v1/ai-systems/export?format=json&${query}`}
                >
                  Export JSON
                </a>
              </>
            )}
            {can('aiSystem:create') && <Button onClick={() => setCreating(true)}>Nouveau SIA</Button>}
          </>
        }
      />

      <Card className="mb-4 !p-4">
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            className="min-w-64 flex-1"
            label="Rechercher"
            placeholder="Nom, référence, finalité, cas d’usage…"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            className="w-56"
            label="Unité"
            value={sp.get('orgUnitId') ?? ''}
            onChange={(e) => set('orgUnitId', e.target.value || null)}
          >
            <option value="">Toutes</option>
            {units.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {indent(u.depth)}
                {u.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="w-48"
            label="Propriétaire"
            value={sp.get('ownerId') ?? ''}
            onChange={(e) => set('ownerId', e.target.value || null)}
          >
            <option value="">Tous</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="w-40"
            label="Tag"
            value={sp.get('tagId') ?? ''}
            onChange={(e) => set('tagId', e.target.value || null)}
          >
            <option value="">Tous</option>
            {tags.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="w-48"
            label="Fournisseur"
            value={sp.get('vendorId') ?? ''}
            onChange={(e) => set('vendorId', e.target.value || null)}
          >
            <option value="">Tous</option>
            {vendorList.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="w-52"
            label="Modèle"
            value={sp.get('modelId') ?? ''}
            onChange={(e) => set('modelId', e.target.value || null)}
          >
            <option value="">Tous</option>
            {modelList.data?.items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.version}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="w-36"
            label="Archivés"
            value={sp.get('archived') ?? 'exclude'}
            onChange={(e) => set('archived', e.target.value === 'exclude' ? null : e.target.value)}
          >
            <option value="exclude">Masqués</option>
            <option value="include">Inclus</option>
            <option value="only">Uniquement</option>
          </SelectField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MultiFilter
            label="Statut"
            param="status"
            sp={sp}
            set={set}
            options={AI_SYSTEM_STATUSES.map((s) => ({ value: s, label: AI_SYSTEM_STATUS_META[s].label }))}
          />
          <MultiFilter
            label="Niveau de risque"
            param="risk"
            sp={sp}
            set={set}
            options={RISK_CATEGORIES.map((s) => ({ value: s, label: RISK_CATEGORY_META[s].label }))}
          />
          <MultiFilter
            label="Valeur ajoutée"
            param="value"
            sp={sp}
            set={set}
            options={VALUE_LEVELS.map((s) => ({ value: s, label: VALUE_LEVEL_META[s].label }))}
          />
          <MultiFilter
            label="Rôle AI Act"
            param="role"
            sp={sp}
            set={set}
            options={AI_ACT_ROLES.map((s) => ({ value: s, label: AI_ACT_ROLE_LABELS[s] }))}
          />
          {filtersActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQ('');
                setSp(new URLSearchParams(), { replace: true });
              }}
            >
              Réinitialiser les filtres
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <SavedViews
              sp={sp}
              columns={columns}
              layout={layout}
              apply={(v) => {
                const next = new URLSearchParams(v.state.query);
                next.set('cols', v.state.columns.join(','));
                if (v.state.layout === 'cards') next.set('view', 'cards');
                setQ(next.get('q') ?? '');
                setSp(next, { replace: true });
              }}
            />
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full border border-grey-300 bg-white px-3 py-1.5 text-sm font-semibold">
                Colonnes ▾
              </summary>
              <fieldset className="absolute right-0 z-20 mt-1 w-60 space-y-1 rounded-xl border border-grey-200 bg-white p-3 shadow-pop">
                <legend className="sr-only">Colonnes affichées</legend>
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={columns.includes(c.key)}
                      disabled={c.key === 'name'}
                      onChange={() => {
                        const next = columns.includes(c.key)
                          ? columns.filter((k) => k !== c.key)
                          : COLUMNS.map((x) => x.key).filter((k) => k === c.key || columns.includes(k));
                        set('cols', next.join(','), false);
                      }}
                    />
                    {c.label}
                  </label>
                ))}
              </fieldset>
            </details>
            <div
              role="group"
              aria-label="Disposition"
              className="flex rounded-full border border-grey-300 bg-white p-0.5"
            >
              {(['table', 'cards'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={layout === l}
                  onClick={() => set('view', l === 'cards' ? 'cards' : null, false)}
                  className={clsx(
                    'rounded-full px-3 py-1 text-sm font-semibold',
                    layout === l ? 'bg-gls-blue text-white' : 'text-grey-700',
                  )}
                >
                  {l === 'table' ? 'Tableau' : 'Cartes'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {notice && (
        <div className="mb-3">
          <Alert tone="green">{notice}</Alert>
        </div>
      )}

      {selected.size > 0 && (
        <div className="no-print sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-gls-blue px-4 py-2 text-white shadow-pop">
          <span className="font-bold">{selected.size} sélectionné(s)</span>
          {(Object.keys(BULK_LABELS) as BulkAction[]).map((a) => (
            <button
              key={a}
              type="button"
              className="rounded-full px-3 py-1 text-sm font-semibold hover:bg-white/15"
              onClick={() => setBulk(a)}
            >
              {BULK_LABELS[a]}
            </button>
          ))}
          {can('aiSystem:export') && (
            <a
              className="rounded-full px-3 py-1 text-sm font-semibold hover:bg-white/15"
              href={`/api/v1/ai-systems/export?format=csv&${query}`}
            >
              Exporter la vue
            </a>
          )}
          <button type="button" className="ml-auto text-sm underline" onClick={() => setSelected(new Set())}>
            Désélectionner
          </button>
        </div>
      )}

      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <Alert tone="red">{errorMessage(list.error)}</Alert>
      ) : items.length === 0 ? (
        <EmptyState>
          {filtersActive ? 'Aucun SIA ne correspond à ces critères.' : 'Le registre est vide.'}
          {can('aiSystem:create') && !filtersActive && ' Créez le premier système avec « Nouveau SIA ».'}
        </EmptyState>
      ) : layout === 'table' ? (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Registre des systèmes d’IA</caption>
              <thead className="border-b border-grey-200 bg-grey-50 text-xs uppercase tracking-wide text-grey-500">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Tout sélectionner sur la page"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.id)))}
                    />
                  </th>
                  {visibleCols.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="px-3 py-2"
                      aria-sort={c.sort && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {c.sort ? (
                        <button
                          type="button"
                          className="font-semibold uppercase hover:text-gls-blue"
                          onClick={() => toggleSort(c.sort!)}
                        >
                          {c.label} {sort === c.sort ? (dir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr
                    key={s.id}
                    className={clsx(
                      'border-b border-grey-100 align-top hover:bg-grey-50',
                      s.archivedAt && 'opacity-70',
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${s.reference}`}
                        disabled={!s.canUpdate && !s.canArchive}
                        checked={selected.has(s.id)}
                        onChange={() => {
                          const n = new Set(selected);
                          if (n.has(s.id)) n.delete(s.id);
                          else n.add(s.id);
                          setSelected(n);
                        }}
                      />
                    </td>
                    {visibleCols.map((c) => (
                      <td key={c.key} className="px-3 py-2.5">
                        {c.render(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={(p) => set('page', String(p), false)}
            />
          </div>
        </Card>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/systemes/${s.id}`}
                  className="block h-full rounded-[var(--radius-card)] bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs text-grey-500">{s.reference}</span>
                    <StatusBadge value={s.status} />
                  </div>
                  <h2 className="mt-1 text-lg leading-snug">{s.name}</h2>
                  {s.isDemo && <Badge tone="yellow">DEMO</Badge>}
                  <p className="mt-1 line-clamp-2 text-sm text-grey-600">
                    {s.purpose || <span className="text-grey-400">Finalité non renseignée</span>}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <RiskBadge value={s.riskCategory} />
                    <ValueBadge value={s.valueLevel} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-grey-500">
                    <span>{s.orgUnit.name}</span>
                    <CompletenessBar value={s.completeness} compact />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={(p) => set('page', String(p), false)}
          />
        </>
      )}

      {bulk && (
        <BulkModal
          action={bulk}
          ids={[...selected]}
          onClose={() => setBulk(null)}
          onDone={async () => {
            setNotice(`${BULK_LABELS[bulk]} : ${selected.size} SIA mis à jour.`);
            setBulk(null);
            setSelected(new Set());
            await qc.invalidateQueries({ queryKey: ['ai-systems'] });
            await qc.invalidateQueries({ queryKey: ['tags'] });
          }}
        />
      )}
      {creating && (
        <CreateSystemModal onClose={() => setCreating(false)} onCreated={(id) => navigate(`/systemes/${id}`)} />
      )}
    </>
  );
}
