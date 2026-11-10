import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  DATASET_ORIGINS,
  DATASET_ORIGIN_LABELS,
  DATASET_USAGES,
  DATASET_USAGE_LABELS,
  MODEL_ACCESS_LABELS,
  MODEL_ACCESS_MODES,
  MODEL_TYPES,
  MODEL_TYPE_LABELS,
  VENDOR_RELATIONS,
  VENDOR_RELATION_LABELS,
  PARTY_FUNCTIONS,
  PARTY_FUNCTION_LABELS,
  PRIORITY_LABELS,
  RACI,
  RACI_LABELS,
  RESPONSIBILITY_FUNCTIONS,
  SECTION_LABELS,
  SECTION_ORDER,
  type PartyFunction,
} from '@chandelier/shared';
import { api, errorMessage, get, post } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useActiveUsers, useCatalog } from '../../../lib/queries';
import { Link } from 'react-router';
import type {
  AiModel,
  Vendor,
  AiSystemDetail,
  Asset,
  Assignment,
  Dataset,
  ProcessingActivity,
  RefCategory,
  Stakeholder,
} from '../../../lib/types';
import { Badge, Button, EmptyState, SelectField, TextField } from '../../../components/ui';
import { ErrorLine, sectionCall, triLabel, useSectionMutation } from './form';

function Row({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </li>
  );
}

function AddPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="mt-3 rounded-xl border border-dashed border-grey-300 p-3">
      <summary className="cursor-pointer text-sm font-bold text-gls-blue">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** Création rapide dans un référentiel puis callback avec l'identifiant créé. */
function useQuickCreate<T extends { id: string }>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => post<T>(`/api/v1/${path}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog', path] }),
  });
}

// ── Parties prenantes (étapes 2 et 4) ───────────────────────────────────────
export function StakeholderLinks({
  s,
  editable,
  scope,
}: {
  s: AiSystemDetail;
  editable: boolean;
  scope: 'responsibility' | 'stakeholders';
}) {
  const { can } = useAuth();
  const catalog = useCatalog<Stakeholder>('stakeholders');
  const functions = PARTY_FUNCTIONS.filter(
    (f) => (scope === 'responsibility') === RESPONSIBILITY_FUNCTIONS.includes(f),
  );
  const links = s.stakeholders.filter((l) => functions.includes(l.function as PartyFunction));
  const [stakeholderId, setStakeholderId] = useState('');
  const [fn, setFn] = useState<PartyFunction>(functions[0]!);
  const [responsibility, setResponsibility] = useState('');
  const [access, setAccess] = useState('');
  const [raci, setRaci] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  const [newOrg, setNewOrg] = useState('');
  const quick = useQuickCreate<Stakeholder>('stakeholders');
  const add = useSectionMutation(s.id, () =>
    sectionCall(s.id, 'POST', 'stakeholders', {
      stakeholderId,
      function: fn,
      responsibility,
      access,
      raci: raci || null,
    }),
  );
  const remove = useSectionMutation(s.id, (linkId: string) => sectionCall(s.id, 'DELETE', `stakeholders/${linkId}`));
  const setRaciMut = useSectionMutation(s.id, ({ linkId, value }: { linkId: string; value: string }) =>
    sectionCall(s.id, 'PATCH', `stakeholders/${linkId}`, { raci: value || null }),
  );
  return (
    <>
      <ErrorLine
        error={add.error ?? remove.error ?? setRaciMut.error ?? (quick.error ? errorMessage(quick.error) : null)}
      />
      {links.length === 0 ? (
        <EmptyState>Aucun intervenant rattaché.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {links.map((l) => (
            <Row
              key={l.id}
              actions={
                editable && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id)}>
                    Retirer
                  </Button>
                )
              }
            >
              <p className="font-semibold">
                {l.stakeholder.name} <Badge tone="blue">{PARTY_FUNCTION_LABELS[l.function as PartyFunction]}</Badge>{' '}
                <Badge tone="gray">{l.stakeholder.kind === 'INTERNAL' ? 'Interne' : 'Externe'}</Badge>
              </p>
              <p className="text-xs text-grey-600">
                {[l.stakeholder.organization, l.stakeholder.contact].filter(Boolean).join(' · ')}
              </p>
              {(l.responsibility || l.access) && (
                <p className="mt-1 text-sm text-grey-700">
                  {l.responsibility && <>Responsabilité : {l.responsibility}. </>}
                  {l.access && <>Accès : {l.access}.</>}
                </p>
              )}
              {s.raciEnabled && (
                <div className="mt-1 max-w-56">
                  <SelectField
                    label="RACI"
                    value={l.raci ?? ''}
                    disabled={!editable}
                    onChange={(e) => setRaciMut.mutate({ linkId: l.id, value: e.target.value })}
                  >
                    <option value="">—</option>
                    {RACI.map((r) => (
                      <option key={r} value={r}>
                        {RACI_LABELS[r]}
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}
            </Row>
          ))}
        </ul>
      )}
      {editable && (
        <AddPanel title="Rattacher un intervenant">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField
              label="Intervenant (référentiel)"
              value={stakeholderId}
              onChange={(e) => setStakeholderId(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {catalog.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.organization ? ` (${c.organization})` : ''}
                </option>
              ))}
            </SelectField>
            <SelectField label="Fonction" value={fn} onChange={(e) => setFn(e.target.value as PartyFunction)}>
              {functions.map((f) => (
                <option key={f} value={f}>
                  {PARTY_FUNCTION_LABELS[f]}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Responsabilité"
              value={responsibility}
              onChange={(e) => setResponsibility(e.target.value)}
            />
            <TextField label="Accès au système" value={access} onChange={(e) => setAccess(e.target.value)} />
            {s.raciEnabled && (
              <SelectField label="RACI" value={raci} onChange={(e) => setRaci(e.target.value)}>
                <option value="">—</option>
                {RACI.map((r) => (
                  <option key={r} value={r}>
                    {RACI_LABELS[r]}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          <Button
            className="mt-3"
            size="sm"
            disabled={!stakeholderId || add.isPending}
            onClick={() => add.mutate(undefined)}
          >
            Rattacher
          </Button>
          {can('catalog:manage') && (
            <div className="mt-4 border-t border-grey-200 pt-3">
              <p className="mb-2 text-sm font-semibold">Absent du référentiel ? Le créer :</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <TextField
                  label="Nom (personne ou équipe)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <SelectField
                  label="Type"
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as 'INTERNAL' | 'EXTERNAL')}
                >
                  <option value="INTERNAL">Interne</option>
                  <option value="EXTERNAL">Externe</option>
                </SelectField>
                <TextField label="Organisation" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} />
              </div>
              <p className="mt-1 text-xs text-grey-500">Coordonnées professionnelles uniquement.</p>
              <Button
                className="mt-2"
                size="sm"
                variant="secondary"
                disabled={newName.trim().length < 2 || quick.isPending}
                onClick={() =>
                  quick.mutate(
                    { kind: newKind, name: newName, organization: newOrg },
                    {
                      onSuccess: (c) => {
                        setStakeholderId(c.id);
                        setNewName('');
                        setNewOrg('');
                      },
                    },
                  )
                }
              >
                Créer et sélectionner
              </Button>
            </div>
          )}
        </AddPanel>
      )}
    </>
  );
}

// ── Actifs (étape 5) ────────────────────────────────────────────────────────
export function AssetLinks({ s, editable }: { s: AiSystemDetail; editable: boolean }) {
  const { can } = useAuth();
  const catalog = useCatalog<Asset>('assets');
  const [assetId, setAssetId] = useState('');
  const [dependency, setDependency] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<string>('APPLICATION');
  const quick = useQuickCreate<Asset>('assets');
  const add = useSectionMutation(s.id, () => sectionCall(s.id, 'POST', 'assets', { assetId, dependency }));
  const remove = useSectionMutation(s.id, (id: string) => sectionCall(s.id, 'DELETE', `assets/${id}`));
  const linked = new Set(s.assets.map((a) => a.asset.id));
  return (
    <>
      <ErrorLine error={add.error ?? remove.error ?? (quick.error ? errorMessage(quick.error) : null)} />
      {s.assets.length === 0 ? (
        <EmptyState>Aucun actif ou dépendance rattaché.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {s.assets.map((l) => (
            <Row
              key={l.asset.id}
              actions={
                editable && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.asset.id)}>
                    Retirer
                  </Button>
                )
              }
            >
              <p className="font-semibold">
                {l.asset.name}{' '}
                <Badge tone="blue">{ASSET_TYPE_LABELS[l.asset.type as keyof typeof ASSET_TYPE_LABELS]}</Badge>{' '}
                {l.asset.criticality && (
                  <Badge
                    tone={
                      l.asset.criticality === 'CRITICAL' ? 'red' : l.asset.criticality === 'HIGH' ? 'orange' : 'gray'
                    }
                  >
                    Criticité {PRIORITY_LABELS[l.asset.criticality as keyof typeof PRIORITY_LABELS].toLowerCase()}
                  </Badge>
                )}
              </p>
              {l.dependency && <p className="text-sm text-grey-700">Dépendance : {l.dependency}</p>}
            </Row>
          ))}
        </ul>
      )}
      {editable && (
        <AddPanel title="Rattacher un actif existant">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField label="Actif (référentiel)" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">— Choisir —</option>
              {catalog.data?.items
                .filter((a) => !linked.has(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {ASSET_TYPE_LABELS[a.type as keyof typeof ASSET_TYPE_LABELS]}
                  </option>
                ))}
            </SelectField>
            <TextField
              label="Nature de la dépendance"
              value={dependency}
              onChange={(e) => setDependency(e.target.value)}
            />
          </div>
          <Button className="mt-3" size="sm" disabled={!assetId || add.isPending} onClick={() => add.mutate(undefined)}>
            Rattacher
          </Button>
          {can('catalog:manage') && (
            <div className="mt-4 grid grid-cols-1 items-end gap-3 border-t border-grey-200 pt-3 md:grid-cols-3">
              <TextField label="Nouvel actif" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <SelectField label="Type" value={newType} onChange={(e) => setNewType(e.target.value)}>
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ASSET_TYPE_LABELS[t]}
                  </option>
                ))}
              </SelectField>
              <Button
                size="sm"
                variant="secondary"
                disabled={newName.trim().length < 2 || quick.isPending}
                onClick={() =>
                  quick.mutate(
                    { name: newName, type: newType },
                    { onSuccess: (a) => (setAssetId(a.id), setNewName('')) },
                  )
                }
              >
                Créer et sélectionner
              </Button>
            </div>
          )}
        </AddPanel>
      )}
    </>
  );
}

// ── Traitements RGPD (étape 6) ──────────────────────────────────────────────
export function ProcessingLinks({ s, editable }: { s: AiSystemDetail; editable: boolean }) {
  const { can } = useAuth();
  const catalog = useCatalog<ProcessingActivity>('processing-activities');
  const [pid, setPid] = useState('');
  const [notes, setNotes] = useState('');
  const [ref, setRef] = useState('');
  const [name, setName] = useState('');
  const quick = useQuickCreate<ProcessingActivity>('processing-activities');
  const add = useSectionMutation(s.id, () =>
    sectionCall(s.id, 'POST', 'processing', { processingActivityId: pid, notes }),
  );
  const remove = useSectionMutation(s.id, (id: string) => sectionCall(s.id, 'DELETE', `processing/${id}`));
  const linked = new Set(s.processing.map((p) => p.processingActivity.id));
  return (
    <>
      <ErrorLine error={add.error ?? remove.error ?? (quick.error ? errorMessage(quick.error) : null)} />
      {s.processing.length === 0 ? (
        <EmptyState>Aucun traitement RGPD lié.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {s.processing.map((l) => (
            <Row
              key={l.processingActivity.id}
              actions={
                editable && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.processingActivity.id)}>
                    Retirer
                  </Button>
                )
              }
            >
              <p className="font-semibold">
                <span className="font-mono text-xs">{l.processingActivity.reference}</span> {l.processingActivity.name}{' '}
                {l.processingActivity.dpiaRequired === 'YES' && <Badge tone="orange">AIPD requise</Badge>}
              </p>
              <p className="text-xs text-grey-600">
                Base légale : {l.processingActivity.legalBasis || 'non renseignée'}
              </p>
              {l.notes && <p className="text-sm text-grey-700">{l.notes}</p>}
            </Row>
          ))}
        </ul>
      )}
      {editable && (
        <AddPanel title="Lier un traitement du registre RGPD">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField label="Traitement" value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="">— Choisir —</option>
              {catalog.data?.items
                .filter((p) => !linked.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference} — {p.name}
                  </option>
                ))}
            </SelectField>
            <TextField label="Précisions" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button className="mt-3" size="sm" disabled={!pid || add.isPending} onClick={() => add.mutate(undefined)}>
            Lier
          </Button>
          {can('catalog:manage') && (
            <div className="mt-4 grid grid-cols-1 items-end gap-3 border-t border-grey-200 pt-3 md:grid-cols-3">
              <TextField label="Référence du traitement" value={ref} onChange={(e) => setRef(e.target.value)} />
              <TextField label="Nom" value={name} onChange={(e) => setName(e.target.value)} />
              <Button
                size="sm"
                variant="secondary"
                disabled={ref.trim().length < 2 || name.trim().length < 2 || quick.isPending}
                onClick={() =>
                  quick.mutate({ reference: ref, name }, { onSuccess: (p) => (setPid(p.id), setRef(''), setName('')) })
                }
              >
                Créer et sélectionner
              </Button>
            </div>
          )}
          <p className="mt-3 text-xs text-grey-500">
            Synchronisation sélective avec un registre RGPD externe : fonctionnalité non implémentée (prévue avec le
            lien DPIA, tranche S9). Aucune donnée locale n’est écrasée.
          </p>
        </AddPanel>
      )}
    </>
  );
}

// ── Données (étape 7) ───────────────────────────────────────────────────────
export function DatasetLinks({ s, editable }: { s: AiSystemDetail; editable: boolean }) {
  const { can } = useAuth();
  const catalog = useCatalog<Dataset>('datasets');
  const [datasetId, setDatasetId] = useState('');
  const [usages, setUsages] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [newName, setNewName] = useState('');
  const [newOrigin, setNewOrigin] = useState<string>('INTERNAL');
  const quick = useQuickCreate<Dataset>('datasets');
  const add = useSectionMutation(s.id, () => sectionCall(s.id, 'POST', 'datasets', { datasetId, usages, notes }));
  const remove = useSectionMutation(s.id, (id: string) => sectionCall(s.id, 'DELETE', `datasets/${id}`));
  return (
    <>
      <ErrorLine error={add.error ?? remove.error ?? (quick.error ? errorMessage(quick.error) : null)} />
      {s.datasets.length === 0 ? (
        <EmptyState>Aucune source de données rattachée.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {s.datasets.map((l) => (
            <Row
              key={l.dataset.id}
              actions={
                editable && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.dataset.id)}>
                    Retirer
                  </Button>
                )
              }
            >
              <p className="font-semibold">
                {l.dataset.name}{' '}
                <Badge tone="gray">
                  {DATASET_ORIGIN_LABELS[l.dataset.origin as keyof typeof DATASET_ORIGIN_LABELS]}
                </Badge>
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {l.usages.map((u) => (
                  <Badge key={u} tone="blue">
                    {DATASET_USAGE_LABELS[u as keyof typeof DATASET_USAGE_LABELS]}
                  </Badge>
                ))}
                <Badge tone={l.dataset.containsPersonalData === 'YES' ? 'yellow' : 'gray'}>
                  Données perso. : {triLabel(l.dataset.containsPersonalData)}
                </Badge>
                {l.dataset.containsSpecialCategories === 'YES' && <Badge tone="red">Catégories particulières</Badge>}
                {l.dataset.containsCriminalData === 'YES' && <Badge tone="red">Données pénales</Badge>}
                {l.dataset.isSynthetic && <Badge tone="gray">Synthétique</Badge>}
                {l.dataset.transfersOutsideEu === 'YES' && <Badge tone="orange">Transferts hors UE</Badge>}
              </div>
              {l.notes && <p className="mt-1 text-sm text-grey-700">{l.notes}</p>}
            </Row>
          ))}
        </ul>
      )}
      {editable && (
        <AddPanel title="Rattacher un jeu de données">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField
              label="Jeu de données (référentiel)"
              value={datasetId}
              onChange={(e) => {
                setDatasetId(e.target.value);
                const cur = s.datasets.find((d) => d.dataset.id === e.target.value);
                setUsages(cur?.usages ?? []);
              }}
            >
              <option value="">— Choisir —</option>
              {catalog.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Précisions (qualité, représentativité…)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <fieldset className="mt-3">
            <legend className="mb-1 text-sm font-semibold text-grey-700">Usage dans ce SIA</legend>
            <div className="flex flex-wrap gap-3">
              {DATASET_USAGES.map((u) => (
                <label key={u} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={usages.includes(u)}
                    onChange={(e) => setUsages(e.target.checked ? [...usages, u] : usages.filter((x) => x !== u))}
                  />
                  {DATASET_USAGE_LABELS[u]}
                </label>
              ))}
            </div>
          </fieldset>
          <Button
            className="mt-3"
            size="sm"
            disabled={!datasetId || usages.length === 0 || add.isPending}
            onClick={() => add.mutate(undefined)}
          >
            Enregistrer le rattachement
          </Button>
          {can('catalog:manage') && (
            <div className="mt-4 grid grid-cols-1 items-end gap-3 border-t border-grey-200 pt-3 md:grid-cols-3">
              <TextField label="Nouveau jeu de données" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <SelectField label="Origine" value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)}>
                {DATASET_ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {DATASET_ORIGIN_LABELS[o]}
                  </option>
                ))}
              </SelectField>
              <Button
                size="sm"
                variant="secondary"
                disabled={newName.trim().length < 2 || quick.isPending}
                onClick={() =>
                  quick.mutate(
                    { name: newName, origin: newOrigin },
                    { onSuccess: (d) => (setDatasetId(d.id), setNewName('')) },
                  )
                }
              >
                Créer et sélectionner
              </Button>
              <p className="text-xs text-grey-500 md:col-span-3">
                Les caractéristiques détaillées (licence, provenance, conservation, transferts…) se complètent dans
                Référentiels › Jeux de données.
              </p>
            </div>
          )}
        </AddPanel>
      )}
    </>
  );
}

export function DataCategoriesEditor({ s, editable }: { s: AiSystemDetail; editable: boolean }) {
  const cats = useCatalog<RefCategory>('data-categories');
  const [sel, setSel] = useState<string[] | null>(null);
  const current = sel ?? s.dataCategories.map((c) => c.id);
  const save = useSectionMutation(s.id, () => sectionCall(s.id, 'PUT', 'data-categories', { ids: current }));
  const dirty =
    sel !== null && JSON.stringify([...sel].sort()) !== JSON.stringify(s.dataCategories.map((c) => c.id).sort());
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-grey-700">Catégories de données personnelles traitées</legend>
      <ErrorLine error={save.error} />
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
        {cats.data?.items.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!editable}
              checked={current.includes(c.id)}
              onChange={(e) => setSel(e.target.checked ? [...current, c.id] : current.filter((x) => x !== c.id))}
            />
            {c.label}
            {c.isSpecial && <Badge tone="red">Art. 9</Badge>}
            {c.isCriminal && <Badge tone="red">Art. 10</Badge>}
          </label>
        ))}
      </div>
      {dirty && (
        <Button
          className="mt-3"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => setSel(null) })}
        >
          Enregistrer les catégories
        </Button>
      )}
    </fieldset>
  );
}

// ── Personnes concernées (étape 8) ──────────────────────────────────────────
export function DataSubjectsEditor({ s, editable }: { s: AiSystemDetail; editable: boolean }) {
  const cats = useCatalog<RefCategory>('data-subject-categories');
  const init = () =>
    Object.fromEntries(
      s.dataSubjects.map((d) => [d.id, { volumeEstimate: d.volumeEstimate, consequences: d.consequences }]),
    );
  const [items, setItems] = useState<Record<string, { volumeEstimate: string; consequences: string }> | null>(null);
  const current = items ?? init();
  const save = useSectionMutation(s.id, () =>
    sectionCall(s.id, 'PUT', 'data-subjects', {
      items: Object.entries(current).map(([dataSubjectId, v]) => ({ dataSubjectId, ...v })),
    }),
  );
  const dirty = items !== null && JSON.stringify(items) !== JSON.stringify(init());
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-grey-700">Catégories de personnes concernées</legend>
      <ErrorLine error={save.error} />
      <ul className="space-y-2">
        {cats.data?.items.map((c) => {
          const on = c.id in current;
          return (
            <li key={c.id} className="rounded-lg bg-grey-50 p-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={on}
                  onChange={(e) => {
                    const next = { ...current };
                    if (e.target.checked) next[c.id] = { volumeEstimate: '', consequences: '' };
                    else delete next[c.id];
                    setItems(next);
                  }}
                />
                {c.label}
                {c.isVulnerable && <Badge tone="orange">Vulnérables</Badge>}
              </label>
              {on && (
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <TextField
                    label="Volume approximatif"
                    disabled={!editable}
                    value={current[c.id]!.volumeEstimate}
                    onChange={(e) =>
                      setItems({ ...current, [c.id]: { ...current[c.id]!, volumeEstimate: e.target.value } })
                    }
                  />
                  <TextField
                    label="Conséquences potentielles"
                    disabled={!editable}
                    value={current[c.id]!.consequences}
                    onChange={(e) =>
                      setItems({ ...current, [c.id]: { ...current[c.id]!, consequences: e.target.value } })
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {dirty && (
        <Button
          className="mt-3"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => setItems(null) })}
        >
          Enregistrer les personnes concernées
        </Button>
      )}
    </fieldset>
  );
}

// ── Affectation de sections ─────────────────────────────────────────────────
export function Assignments({ s, canManage }: { s: AiSystemDetail; canManage: boolean }) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const list = useQuery({
    queryKey: ['assignments', s.id],
    queryFn: () => get<{ items: Assignment[] }>(`/api/v1/ai-systems/${s.id}/assignments`),
  });
  const [section, setSection] = useState<string>('general');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['assignments', s.id] });
  const add = useMutation({
    mutationFn: () => post(`/api/v1/ai-systems/${s.id}/assignments`, { section, userId }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/api/v1/ai-systems/${s.id}/assignments/${id}`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div>
      <ErrorLine error={error} />
      {list.data?.items.length ? (
        <ul className="mb-3 flex flex-wrap gap-2">
          {list.data.items.map((a) => (
            <li key={a.id} className="flex items-center gap-1 rounded-full bg-gls-blue-050 px-3 py-1 text-sm">
              <strong>{SECTION_LABELS[a.section as keyof typeof SECTION_LABELS]}</strong> → {a.user.displayName}
              {canManage && (
                <button
                  type="button"
                  className="ml-1 text-grey-500 hover:text-tone-red-fg"
                  aria-label="Retirer l’affectation"
                  onClick={() => remove.mutate(a.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-grey-500">Aucune section affectée.</p>
      )}
      {canManage && (
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
          <SelectField label="Section" value={section} onChange={(e) => setSection(e.target.value)}>
            {SECTION_ORDER.filter((k) => k !== 'summary').map((k) => (
              <option key={k} value={k}>
                {SECTION_LABELS[k]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Contributeur" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— Choisir —</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </SelectField>
          <Button size="sm" disabled={!userId || add.isPending} onClick={() => add.mutate()}>
            Affecter
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-grey-500">
        Un utilisateur au rôle Contributeur ne peut modifier que les sections qui lui sont affectées (contrôle côté
        serveur).
      </p>
    </div>
  );
}

// ── Modèles d'IA (étape 3) ──────────────────────────────────────────────────
export function ModelLinks({ s, editable }: { s: AiSystemDetail; editable: boolean }) {
  const { can } = useAuth();
  const catalog = useCatalog<AiModel>('ai-models');
  const vendors = useCatalog<Vendor>('vendors');
  const [aiModelId, setAiModelId] = useState('');
  const [usageDescription, setUsage] = useState('');
  const [versionUsed, setVersionUsed] = useState('');
  const [hostingMode, setHostingMode] = useState('');
  const [integrationDate, setIntegrationDate] = useState('');
  const [isPrimary, setIsPrimary] = useState(s.modelLinks.length === 0);
  const [editId, setEditId] = useState<string | null>(null);
  const [editUsage, setEditUsage] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<string>('LLM');
  const [newAccess, setNewAccess] = useState<string>('API');
  const [newVendor, setNewVendor] = useState('');
  const quick = useQuickCreate<AiModel>('ai-models');
  const add = useSectionMutation(s.id, () =>
    sectionCall(s.id, 'POST', 'models', {
      aiModelId,
      usageDescription,
      versionUsed,
      hostingMode: hostingMode || null,
      integrationDate: integrationDate || null,
      isPrimary,
    }),
  );
  const update = useSectionMutation(s.id, (v: { linkId: string; body: Record<string, unknown> }) =>
    sectionCall(s.id, 'PATCH', `models/${v.linkId}`, v.body),
  );
  const remove = useSectionMutation(s.id, (linkId: string) => sectionCall(s.id, 'DELETE', `models/${linkId}`));
  const err = add.error ?? update.error ?? remove.error ?? (quick.error ? errorMessage(quick.error) : null);
  return (
    <>
      <ErrorLine error={err} />
      {s.modelLinks.length === 0 ? (
        <EmptyState>Aucun modèle lié.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {s.modelLinks.map((l) => (
            <Row
              key={l.id}
              actions={
                editable && (
                  <>
                    {!l.isPrimary && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update.mutate({ linkId: l.id, body: { isPrimary: true } })}
                      >
                        Définir principal
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => (setEditId(l.id), setEditUsage(l.usageDescription))}
                    >
                      Modifier l’usage
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id)}>
                      Retirer
                    </Button>
                  </>
                )
              }
            >
              <p className="flex flex-wrap items-center gap-1 font-semibold">
                <Link to={`/modeles/${l.model.id}`} className="text-gls-blue hover:underline">
                  {l.model.name} {l.versionUsed || l.model.version}
                </Link>
                {l.isPrimary && <Badge tone="blue">Principal</Badge>}
                <Badge tone="gray">{MODEL_TYPE_LABELS[l.model.type as keyof typeof MODEL_TYPE_LABELS]}</Badge>
                {l.model.isGpai === 'YES' && (
                  <Badge tone={l.model.gpaiSystemicRisk === 'YES' ? 'orange' : 'blue'}>GPAI</Badge>
                )}
                {l.model.status === 'DEPRECATED' || l.model.status === 'RETIRED' ? (
                  <Badge tone="orange">Modèle obsolète ou retiré</Badge>
                ) : null}
              </p>
              <p className="text-xs text-grey-600">
                {l.model.vendor?.name ?? 'Fournisseur non renseigné'} · accès :{' '}
                {MODEL_ACCESS_LABELS[(l.hostingMode ?? l.model.accessMode) as keyof typeof MODEL_ACCESS_LABELS]}
                {l.integrationDate ? ` · intégré le ${l.integrationDate}` : ''}
              </p>
              {editId === l.id ? (
                <div className="mt-2 flex items-end gap-2">
                  <TextField
                    className="flex-1"
                    label="Description de l’utilisation"
                    value={editUsage}
                    onChange={(e) => setEditUsage(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={editUsage.trim().length < 10 || update.isPending}
                    onClick={() =>
                      update.mutate(
                        { linkId: l.id, body: { usageDescription: editUsage } },
                        { onSuccess: () => setEditId(null) },
                      )
                    }
                  >
                    Enregistrer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                    Annuler
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-grey-700">
                  <span className="font-semibold">Utilisation dans ce SIA :</span> {l.usageDescription}
                </p>
              )}
            </Row>
          ))}
        </ul>
      )}
      {editable && (
        <AddPanel title="Lier un modèle du référentiel">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField label="Modèle" value={aiModelId} onChange={(e) => setAiModelId(e.target.value)}>
              <option value="">— Choisir —</option>
              {catalog.data?.items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.version} {m.vendor ? `— ${m.vendor.name}` : ''}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Version utilisée (si différente)"
              value={versionUsed}
              onChange={(e) => setVersionUsed(e.target.value)}
            />
            <div className="md:col-span-2">
              <TextField
                label="Description de l’utilisation du modèle dans ce SIA"
                required
                hint="10 caractères minimum. Propre à ce SIA : un même modèle peut avoir des usages différents ailleurs."
                value={usageDescription}
                onChange={(e) => setUsage(e.target.value)}
              />
            </div>
            <SelectField
              label="Hébergement / accès pour ce SIA"
              value={hostingMode}
              onChange={(e) => setHostingMode(e.target.value)}
            >
              <option value="">Comme le modèle</option>
              {MODEL_ACCESS_MODES.map((a) => (
                <option key={a} value={a}>
                  {MODEL_ACCESS_LABELS[a]}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Date d’intégration"
              type="date"
              value={integrationDate}
              onChange={(e) => setIntegrationDate(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
              Modèle principal du SIA
            </label>
          </div>
          <Button
            className="mt-3"
            size="sm"
            disabled={!aiModelId || usageDescription.trim().length < 10 || add.isPending}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => (setAiModelId(''), setUsage(''), setVersionUsed(''), setIsPrimary(false)),
              })
            }
          >
            Lier le modèle
          </Button>
          {can('catalog:manage') && (
            <div className="mt-4 grid grid-cols-1 items-end gap-3 border-t border-grey-200 pt-3 md:grid-cols-4">
              <TextField label="Nouveau modèle" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <SelectField label="Type" value={newType} onChange={(e) => setNewType(e.target.value)}>
                {MODEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MODEL_TYPE_LABELS[t]}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Accès" value={newAccess} onChange={(e) => setNewAccess(e.target.value)}>
                {MODEL_ACCESS_MODES.map((t) => (
                  <option key={t} value={t}>
                    {MODEL_ACCESS_LABELS[t]}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Fournisseur" value={newVendor} onChange={(e) => setNewVendor(e.target.value)}>
                <option value="">—</option>
                {vendors.data?.items.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </SelectField>
              <Button
                size="sm"
                variant="secondary"
                disabled={newName.trim().length < 2 || quick.isPending}
                onClick={() =>
                  quick.mutate(
                    { name: newName, type: newType, accessMode: newAccess, vendorId: newVendor || null },
                    { onSuccess: (m) => (setAiModelId(m.id), setNewName('')) },
                  )
                }
              >
                Créer et sélectionner
              </Button>
              <p className="text-xs text-grey-500 md:col-span-3">
                La fiche complète du modèle (capacités, limites, GPAI…) se complète dans « Modèles d’IA ».
              </p>
            </div>
          )}
        </AddPanel>
      )}
    </>
  );
}

// ── Fournisseurs du SIA (étape 2) ───────────────────────────────────────────
export function VendorLinks({ s, editable }: { s: AiSystemDetail; editable: boolean }) {
  const catalog = useCatalog<Vendor>('vendors');
  const [vendorId, setVendorId] = useState('');
  const [relation, setRelation] = useState<string>('PROVIDER');
  const [notes, setNotes] = useState('');
  const add = useSectionMutation(s.id, () => sectionCall(s.id, 'POST', 'vendors', { vendorId, relation, notes }));
  const remove = useSectionMutation(s.id, (v: { vendorId: string; relation: string }) =>
    sectionCall(s.id, 'DELETE', `vendors/${v.vendorId}/${v.relation}`),
  );
  return (
    <>
      <ErrorLine error={add.error ?? remove.error} />
      {s.vendorLinks.length === 0 ? (
        <EmptyState>Aucun fournisseur déclaré pour ce SIA.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {s.vendorLinks.map((l) => (
            <Row
              key={`${l.vendor.id}-${l.relation}`}
              actions={
                editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate({ vendorId: l.vendor.id, relation: l.relation })}
                  >
                    Retirer
                  </Button>
                )
              }
            >
              <p className="font-semibold">
                {l.vendor.name}{' '}
                <Badge tone="blue">{VENDOR_RELATION_LABELS[l.relation as keyof typeof VENDOR_RELATION_LABELS]}</Badge>{' '}
                <Badge tone={l.vendor.dpaSigned === 'YES' ? 'green' : l.vendor.dpaSigned === 'NO' ? 'orange' : 'gray'}>
                  DPA : {triLabel(l.vendor.dpaSigned)}
                </Badge>
              </p>
              {l.notes && <p className="text-sm text-grey-700">{l.notes}</p>}
            </Row>
          ))}
        </ul>
      )}
      {editable && (
        <AddPanel title="Rattacher un fournisseur">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SelectField
              label="Fournisseur (référentiel)"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {catalog.data?.items
                .filter((v) => v.isActive)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </SelectField>
            <SelectField label="Rôle" value={relation} onChange={(e) => setRelation(e.target.value)}>
              {VENDOR_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {VENDOR_RELATION_LABELS[r]}
                </option>
              ))}
            </SelectField>
            <TextField label="Précisions" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button
            className="mt-3"
            size="sm"
            disabled={!vendorId || add.isPending}
            onClick={() => add.mutate(undefined)}
          >
            Rattacher
          </Button>
          <p className="mt-2 text-xs text-grey-500">Nouveau fournisseur : Référentiels › Fournisseurs.</p>
        </AddPanel>
      )}
    </>
  );
}
