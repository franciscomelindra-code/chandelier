import { useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  DATASET_ORIGINS,
  DATASET_ORIGIN_LABELS,
  GDPR_ROLES,
  GDPR_ROLE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
} from '@chandelier/shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCatalog } from '../../lib/queries';
import type {
  Vendor,
  Asset,
  Dataset,
  ProcessingActivity,
  RefCategory,
  Stakeholder,
  SystemTemplate,
} from '../../lib/types';
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
import { TRI_OPTIONS, TextArea, triLabel } from '../ai-systems/wizard/form';
import { FrameworkView } from '../assessments/FrameworkView';

// ── Formulaire générique piloté par une description de champs ──────────────
export type FieldDef =
  | { key: string; label: string; kind: 'list'; hint?: string }
  | { key: string; label: string; kind: 'date' }
  | { key: string; label: string; kind: 'text'; required?: boolean; hint?: string }
  | { key: string; label: string; kind: 'area' }
  | { key: string; label: string; kind: 'select'; options: readonly (readonly [string, string])[]; nullable?: boolean }
  | { key: string; label: string; kind: 'tri' }
  | { key: string; label: string; kind: 'bool' }
  | { key: string; label: string; kind: 'multi'; options: { id: string; label: string }[] };

export function CatalogForm({
  fields,
  initial,
  onSubmit,
  pending,
  error,
}: {
  fields: FieldDef[];
  initial: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
  pending: boolean;
  error: string | null;
}) {
  const [v, setV] = useState<Record<string, unknown>>(initial);
  const set = (k: string, val: unknown) => setV({ ...v, [k]: val });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        // Champs « liste » saisis en texte : conversion en tableau à l'envoi.
        const out = { ...v };
        for (const f of fields) {
          if (f.kind === 'list' && typeof out[f.key] === 'string') {
            out[f.key] = (out[f.key] as string)
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
          }
        }
        onSubmit(out);
      }}
    >
      {error && <Alert tone="red">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {fields.map((f) => {
          const val = v[f.key];
          switch (f.kind) {
            case 'text':
              return (
                <TextField
                  key={f.key}
                  label={f.label}
                  required={f.required}
                  hint={f.hint}
                  value={(val as string) ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
            case 'area':
              return (
                <div key={f.key} className="md:col-span-2">
                  <TextArea label={f.label} value={(val as string) ?? ''} onChange={(x) => set(f.key, x)} />
                </div>
              );
            case 'select':
              return (
                <SelectField
                  key={f.key}
                  label={f.label}
                  value={(val as string) ?? ''}
                  onChange={(e) => set(f.key, e.target.value || (f.nullable ? null : ''))}
                >
                  {f.nullable && <option value="">—</option>}
                  {f.options.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </SelectField>
              );
            case 'tri':
              return (
                <SelectField
                  key={f.key}
                  label={f.label}
                  value={(val as string) ?? 'UNKNOWN'}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  {TRI_OPTIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </SelectField>
              );
            case 'list':
              return (
                <TextField
                  key={f.key}
                  label={f.label}
                  hint={f.hint ?? 'Valeurs séparées par des virgules'}
                  value={typeof val === 'string' ? val : ((val as string[]) ?? []).join(', ')}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
            case 'date':
              return (
                <TextField
                  key={f.key}
                  label={f.label}
                  type="date"
                  value={(val as string) ?? ''}
                  onChange={(e) => set(f.key, e.target.value || null)}
                />
              );
            case 'bool':
              return (
                <label key={f.key} className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" checked={!!val} onChange={(e) => set(f.key, e.target.checked)} />
                  {f.label}
                </label>
              );
            case 'multi': {
              const cur = (val as string[]) ?? [];
              return (
                <fieldset key={f.key} className="md:col-span-2">
                  <legend className="mb-1 text-sm font-semibold text-grey-700">{f.label}</legend>
                  <div className="flex flex-wrap gap-3">
                    {f.options.map((o) => (
                      <label key={o.id} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={cur.includes(o.id)}
                          onChange={(e) =>
                            set(f.key, e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id))
                          }
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
          }
        })}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function CatalogPanel<T extends { id: string; usage: number }>({
  path,
  title,
  intro,
  fields,
  empty,
  render,
}: {
  path: string;
  title: string;
  intro: ReactNode;
  fields: FieldDef[];
  empty: Record<string, unknown>;
  render: (item: T) => ReactNode;
}) {
  const { can } = useAuth();
  const manage = can('catalog:manage');
  const qc = useQueryClient();
  const list = useCatalog<T>(path);
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['catalog', path] });
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const body = Object.fromEntries(fields.map((f) => [f.key, v[f.key]]));
      return editing === 'new'
        ? api('POST', `/api/v1/${path}`, body)
        : api('PATCH', `/api/v1/${path}/${(editing as T).id}`, body);
    },
    onSuccess: async () => {
      await refresh();
      setEditing(null);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/api/v1/${path}/${id}`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const items = (list.data?.items ?? []).filter((i) => !q || JSON.stringify(i).toLowerCase().includes(q.toLowerCase()));
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg">{title}</h2>
          <p className="text-sm text-grey-600">{intro}</p>
        </div>
        <div className="flex items-end gap-2">
          <TextField label="Filtrer" value={q} onChange={(e) => setQ(e.target.value)} />
          {manage && (
            <Button
              onClick={() => {
                setError(null);
                setEditing('new');
              }}
            >
              Ajouter
            </Button>
          )}
        </div>
      </div>
      {error && !editing && (
        <div className="mb-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      {list.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState>Aucun élément.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">{render(i)}</div>
              <div className="flex items-center gap-2 text-xs text-grey-500">
                <span>
                  {i.usage} SIA lié{i.usage > 1 ? 's' : ''}
                </span>
                {manage && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setError(null);
                        setEditing(i);
                      }}
                    >
                      Modifier
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i.usage > 0}
                      title={i.usage > 0 ? 'Rattaché à des SIA : retirez d’abord les liens' : undefined}
                      onClick={() => {
                        if (confirm('Supprimer définitivement cet élément du référentiel ? (opération journalisée)'))
                          remove.mutate(i.id);
                      }}
                    >
                      Supprimer
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        title={editing === 'new' ? `Ajouter — ${title}` : `Modifier — ${title}`}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <CatalogForm
            key={editing === 'new' ? 'new' : editing.id}
            fields={fields}
            initial={editing === 'new' ? empty : (editing as unknown as Record<string, unknown>)}
            pending={save.isPending}
            error={error}
            onSubmit={(v) => {
              setError(null);
              save.mutate(v);
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

export const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  keys.map((k) => [k, labels[k]] as const);

function StakeholdersPanel() {
  return (
    <CatalogPanel<Stakeholder>
      path="stakeholders"
      title="Parties prenantes"
      intro="Personnes, équipes ou organisations intervenant sur les SIA. Coordonnées professionnelles uniquement."
      fields={[
        { key: 'name', label: 'Nom', kind: 'text', required: true },
        {
          key: 'kind',
          label: 'Type',
          kind: 'select',
          options: [
            ['INTERNAL', 'Interne'],
            ['EXTERNAL', 'Externe'],
          ],
        },
        { key: 'organization', label: 'Organisation', kind: 'text' },
        { key: 'contact', label: 'Contact professionnel', kind: 'text' },
      ]}
      empty={{ kind: 'INTERNAL', name: '', organization: '', contact: '' }}
      render={(s) => (
        <>
          <p className="font-semibold">
            {s.name} <Badge tone="gray">{s.kind === 'INTERNAL' ? 'Interne' : 'Externe'}</Badge>
          </p>
          <p className="text-xs text-grey-600">{[s.organization, s.contact].filter(Boolean).join(' · ')}</p>
        </>
      )}
    />
  );
}

function AssetsPanel() {
  return (
    <CatalogPanel<Asset>
      path="assets"
      title="Actifs"
      intro="Applications, API, serveurs, SaaS, bases, appareils et infrastructures, réutilisables entre SIA."
      fields={[
        { key: 'name', label: 'Nom', kind: 'text', required: true },
        { key: 'type', label: 'Type', kind: 'select', options: opts(ASSET_TYPES, ASSET_TYPE_LABELS) },
        { key: 'location', label: 'Localisation / hébergement', kind: 'text' },
        {
          key: 'criticality',
          label: 'Criticité',
          kind: 'select',
          options: opts(PRIORITIES, PRIORITY_LABELS),
          nullable: true,
        },
        { key: 'description', label: 'Description', kind: 'area' },
      ]}
      empty={{ name: '', type: 'APPLICATION', location: '', criticality: null, description: '' }}
      render={(a) => (
        <>
          <p className="font-semibold">
            {a.name} <Badge tone="blue">{ASSET_TYPE_LABELS[a.type as keyof typeof ASSET_TYPE_LABELS]}</Badge>{' '}
            {a.criticality && (
              <Badge tone="gray">
                Criticité {PRIORITY_LABELS[a.criticality as keyof typeof PRIORITY_LABELS].toLowerCase()}
              </Badge>
            )}
          </p>
          {a.description && <p className="line-clamp-2 text-xs text-grey-600">{a.description}</p>}
        </>
      )}
    />
  );
}

function ProcessingPanel() {
  const cats = useCatalog<RefCategory>('data-categories');
  const subs = useCatalog<RefCategory>('data-subject-categories');
  return (
    <CatalogPanel<ProcessingActivity>
      path="processing-activities"
      title="Traitements RGPD"
      intro="Traitements du registre RGPD (ou références vers l’outil registre existant) mobilisés par les SIA."
      fields={[
        { key: 'reference', label: 'Référence', kind: 'text', required: true },
        { key: 'name', label: 'Nom', kind: 'text', required: true },
        { key: 'legalBasis', label: 'Base légale', kind: 'text' },
        { key: 'gdprRole', label: 'Rôle RGPD', kind: 'select', options: opts(GDPR_ROLES, GDPR_ROLE_LABELS) },
        { key: 'dpiaRequired', label: 'AIPD requise', kind: 'tri' },
        { key: 'retention', label: 'Durée de conservation', kind: 'text' },
        { key: 'externalRef', label: 'Référence dans l’outil registre externe', kind: 'text' },
        { key: 'purpose', label: 'Finalité', kind: 'area' },
        {
          key: 'dataCategoryIds',
          label: 'Catégories de données',
          kind: 'multi',
          options: (cats.data?.items ?? []).map((c) => ({ id: c.id, label: c.label })),
        },
        {
          key: 'dataSubjectIds',
          label: 'Personnes concernées',
          kind: 'multi',
          options: (subs.data?.items ?? []).map((c) => ({ id: c.id, label: c.label })),
        },
      ]}
      empty={{
        reference: '',
        name: '',
        legalBasis: '',
        gdprRole: 'CONTROLLER',
        dpiaRequired: 'UNKNOWN',
        retention: '',
        externalRef: '',
        purpose: '',
        dataCategoryIds: [],
        dataSubjectIds: [],
      }}
      render={(p) => (
        <>
          <p className="font-semibold">
            <span className="font-mono text-xs">{p.reference}</span> {p.name}{' '}
            {p.dpiaRequired === 'YES' && <Badge tone="orange">AIPD requise</Badge>}
          </p>
          <p className="text-xs text-grey-600">
            {GDPR_ROLE_LABELS[p.gdprRole as keyof typeof GDPR_ROLE_LABELS]} · base légale :{' '}
            {p.legalBasis || 'non renseignée'}
          </p>
        </>
      )}
    />
  );
}

function DatasetsPanel() {
  return (
    <CatalogPanel<Dataset>
      path="datasets"
      title="Jeux de données"
      intro="Sources de données utilisées pour l’entraînement, le fine-tuning, le RAG ou l’inférence."
      fields={[
        { key: 'name', label: 'Nom', kind: 'text', required: true },
        { key: 'origin', label: 'Origine', kind: 'select', options: opts(DATASET_ORIGINS, DATASET_ORIGIN_LABELS) },
        { key: 'dataType', label: 'Type de données', kind: 'text' },
        { key: 'containsPersonalData', label: 'Données personnelles', kind: 'tri' },
        { key: 'containsSpecialCategories', label: 'Catégories particulières (art. 9)', kind: 'tri' },
        { key: 'containsCriminalData', label: 'Données pénales (art. 10)', kind: 'tri' },
        { key: 'isSynthetic', label: 'Données synthétiques', kind: 'bool' },
        { key: 'transfersOutsideEu', label: 'Transferts hors UE', kind: 'tri' },
        { key: 'provenance', label: 'Provenance', kind: 'text' },
        { key: 'license', label: 'Licence', kind: 'text' },
        { key: 'retention', label: 'Conservation', kind: 'text' },
        { key: 'storageLocation', label: 'Localisation', kind: 'text' },
        { key: 'recipients', label: 'Destinataires', kind: 'text' },
        { key: 'description', label: 'Description', kind: 'area' },
        { key: 'qualityNotes', label: 'Qualité', kind: 'area' },
        { key: 'representativenessNotes', label: 'Représentativité', kind: 'area' },
      ]}
      empty={{
        name: '',
        origin: 'INTERNAL',
        dataType: '',
        containsPersonalData: 'UNKNOWN',
        containsSpecialCategories: 'UNKNOWN',
        containsCriminalData: 'UNKNOWN',
        isSynthetic: false,
        transfersOutsideEu: 'UNKNOWN',
        provenance: '',
        license: '',
        retention: '',
        storageLocation: '',
        recipients: '',
        description: '',
        qualityNotes: '',
        representativenessNotes: '',
      }}
      render={(d) => (
        <>
          <p className="font-semibold">
            {d.name} <Badge tone="gray">{DATASET_ORIGIN_LABELS[d.origin as keyof typeof DATASET_ORIGIN_LABELS]}</Badge>
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={d.containsPersonalData === 'YES' ? 'yellow' : 'gray'}>
              Données perso. : {triLabel(d.containsPersonalData)}
            </Badge>
            {d.containsSpecialCategories === 'YES' && <Badge tone="red">Art. 9</Badge>}
            {d.containsCriminalData === 'YES' && <Badge tone="red">Art. 10</Badge>}
            {d.transfersOutsideEu === 'YES' && <Badge tone="orange">Hors UE</Badge>}
          </div>
        </>
      )}
    />
  );
}

function VendorsPanel() {
  return (
    <CatalogPanel<Vendor>
      path="vendors"
      title="Fournisseurs"
      intro="Éditeurs, intégrateurs et hébergeurs. Un fournisseur lié à un SIA, un modèle ou un actif ne peut pas être supprimé : désactivez-le."
      fields={[
        { key: 'name', label: 'Nom', kind: 'text', required: true },
        { key: 'legalName', label: 'Raison sociale', kind: 'text' },
        { key: 'country', label: 'Pays (ISO 2 lettres)', kind: 'text' },
        {
          key: 'website',
          label: 'Site web',
          kind: 'text',
          hint: 'Information saisie, jamais consultée par le serveur.',
        },
        { key: 'dpaSigned', label: 'Accord de traitement (DPA) signé', kind: 'tri' },
        { key: 'isActive', label: 'Actif', kind: 'bool' },
        { key: 'description', label: 'Description', kind: 'area' },
      ]}
      empty={{
        name: '',
        legalName: '',
        country: '',
        website: '',
        dpaSigned: 'UNKNOWN',
        isActive: true,
        description: '',
      }}
      render={(v) => (
        <>
          <p className="font-semibold">
            {v.name} {v.country && <Badge tone="gray">{v.country}</Badge>}{' '}
            <Badge tone={v.dpaSigned === 'YES' ? 'green' : v.dpaSigned === 'NO' ? 'orange' : 'gray'}>
              DPA : {triLabel(v.dpaSigned)}
            </Badge>{' '}
            {!v.isActive && <Badge tone="gray">Inactif</Badge>}
          </p>
          <p className="text-xs text-grey-600">
            {v.modelCount} modèle{v.modelCount > 1 ? 's' : ''} au référentiel{v.legalName ? ` · ${v.legalName}` : ''}
          </p>
        </>
      )}
    />
  );
}

function CategoriesPanel() {
  const cats = useCatalog<RefCategory>('data-categories');
  const subs = useCatalog<RefCategory>('data-subject-categories');
  return (
    <Card>
      <h2 className="mb-1 text-lg">Catégories RGPD</h2>
      <p className="mb-4 text-sm text-grey-600">Référentiel de base (lecture seule dans cette version).</p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-base">Catégories de données</h3>
          <ul className="space-y-1 text-sm">
            {cats.data?.items.map((c) => (
              <li key={c.id}>
                {c.label} {c.isSpecial && <Badge tone="red">Art. 9</Badge>}{' '}
                {c.isCriminal && <Badge tone="red">Art. 10</Badge>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-base">Catégories de personnes</h3>
          <ul className="space-y-1 text-sm">
            {subs.data?.items.map((c) => (
              <li key={c.id}>
                {c.label} {c.isVulnerable && <Badge tone="orange">Vulnérables</Badge>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function TemplatesPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useCatalog<SystemTemplate>('system-templates');
  const [error, setError] = useState<string | null>(null);
  const deactivate = useMutation({
    mutationFn: (id: string) => api('POST', `/api/v1/system-templates/${id}/deactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog', 'system-templates'] }),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card>
      <h2 className="mb-1 text-lg">Gabarits de SIA</h2>
      <p className="mb-4 text-sm text-grey-600">
        Un gabarit se crée depuis l’onglet Récapitulatif d’une fiche existante. Seuls les champs descriptifs sont
        recopiés : jamais l’historique, les validations ni les liens.
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      {list.data?.items.length ? (
        <ul className="divide-y divide-grey-100">
          {list.data.items.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">{t.name}</p>
                {t.description && <p className="text-sm text-grey-600">{t.description}</p>}
                <p className="text-xs text-grey-500">{t.fields.length} champs recopiés</p>
              </div>
              {can('catalog:manage') && (
                <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(t.id)}>
                  Désactiver
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Aucun gabarit actif.</EmptyState>
      )}
    </Card>
  );
}

const TABS = [
  ['fournisseurs', 'Fournisseurs', <VendorsPanel key="v" />],
  ['parties-prenantes', 'Parties prenantes', <StakeholdersPanel key="s" />],
  ['actifs', 'Actifs', <AssetsPanel key="a" />],
  ['traitements', 'Traitements RGPD', <ProcessingPanel key="p" />],
  ['jeux-de-donnees', 'Jeux de données', <DatasetsPanel key="d" />],
  ['categories', 'Catégories RGPD', <CategoriesPanel key="c" />],
  ['gabarits', 'Gabarits', <TemplatesPanel key="g" />],
  ['ai-act', 'Référentiel AI Act', <FrameworkView key="r" />],
] as const;

export function ReferentialsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Référentiels"
        title="Référentiels"
        description="Catalogues partagés entre les fiches : une source unique, des liens multiples. Consultation pour tous ; modification avec le droit de gestion des référentiels."
      />
      <nav aria-label="Référentiels" className="no-print mb-6 flex flex-wrap gap-2 border-b border-grey-200 pb-3">
        {TABS.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'rounded-full px-4 py-1.5 text-sm font-bold',
                isActive ? 'bg-gls-blue text-white' : 'text-gls-blue hover:bg-gls-blue-050',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="parties-prenantes" replace />} />
        {TABS.map(([to, , el]) => (
          <Route key={to} path={to} element={el} />
        ))}
      </Routes>
    </>
  );
}
