import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AI_ACT_ROLES,
  AI_ACT_ROLE_LABELS,
  AI_SYSTEM_STATUS_META,
  AUTONOMY_LEVELS,
  AUTONOMY_LEVEL_LABELS,
  EDITABLE_STATUSES,
  ORIGIN_LABELS,
  VALUE_LEVELS,
  VALUE_LEVEL_META,
} from '@chandelier/shared';
import { ApiError, errorMessage, get, patch, post } from '../../lib/api';
import { formatDate, formatDateTime, formatValue } from '../../lib/format';
import { indent, useActiveUsers, useOrgUnits, useTags } from '../../lib/queries';
import type { AiSystemDetail, AuditEvent, Page } from '../../lib/types';
import { Alert, Badge, Button, Card, Modal, Pagination, SelectField, Spinner, TextField } from '../../components/ui';
import { CompletenessBar, ComplianceBadge, RiskBadge, StatusBadge, ValueBadge, rolesLabel } from './badges';

type Draft = Record<string, unknown>;
const EDITABLE_KEYS = [
  'name',
  'description',
  'purpose',
  'objectives',
  'useCases',
  'functioning',
  'scope',
  'operationalContext',
  'countries',
  'targetPopulations',
  'status',
  'autonomyLevel',
  'orgUnitId',
  'firstDeploymentDate',
  'productionDate',
  'plannedRetirementDate',
  'actualRetirementDate',
  'nextReviewDate',
  'ownerId',
  'businessOwnerId',
  'aiActRoles',
  'processesPersonalData',
  'includesMinors',
  'includesVulnerable',
  'affectedVolumeEstimate',
  'potentialConsequences',
  'valueLevel',
  'valueJustification',
  'tagIds',
] as const;

function toDraft(s: AiSystemDetail): Draft {
  return {
    ...Object.fromEntries(EDITABLE_KEYS.map((k) => [k, (s as unknown as Record<string, unknown>)[k]])),
    orgUnitId: s.orgUnit.id,
    ownerId: s.owner?.id ?? null,
    businessOwnerId: s.businessOwner?.id ?? null,
    tagIds: s.tags.map((t) => t.id),
  };
}

const TRI = [
  ['UNKNOWN', 'Non renseigné'],
  ['YES', 'Oui'],
  ['NO', 'Non'],
] as const;

function TextArea({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useMemo(() => `ta-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-grey-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-grey-300 bg-white px-3 py-2 text-ink disabled:bg-grey-50 disabled:text-grey-600"
      />
      {hint && <p className="mt-1 text-xs text-grey-500">{hint}</p>}
    </div>
  );
}

function Section({ title, editable, children }: { title: string; editable: boolean; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg">{title}</h2>
        {!editable && <Badge tone="gray">Lecture seule</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </Card>
  );
}

function ReasonModal({
  title,
  confirmLabel,
  danger,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={pending || reason.trim().length < 10}
            onClick={() => onConfirm(reason)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="red">{error}</Alert>}
        <TextField
          label="Justification"
          required
          hint="10 caractères minimum. Conservée dans le journal d’audit."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function History({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const h = useQuery({
    queryKey: ['ai-system-history', id, page],
    queryFn: () => get<Page<AuditEvent>>(`/api/v1/ai-systems/${id}/history?page=${page}`),
  });
  if (h.isPending) return <Spinner />;
  if (h.isError) return <Alert tone="red">{errorMessage(h.error)}</Alert>;
  return (
    <>
      <ol className="divide-y divide-grey-100">
        {h.data.items.map((e) => (
          <li key={e.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <time className="text-grey-500">{formatDateTime(e.occurredAt)}</time>
              <Badge tone="blue">{e.action}</Badge>
              <span>{e.actorLabel}</span>
              <Badge tone="gray">{ORIGIN_LABELS[e.origin] ?? e.origin}</Badge>
            </div>
            {e.justification && <p className="mt-1 text-xs text-grey-600">Justification : {e.justification}</p>}
            {e.changes && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {Object.entries(e.changes).map(([f, c]) => (
                  <li key={f}>
                    <span className="font-mono">{f}</span> :{' '}
                    <span className="text-tone-red-fg line-through">{formatValue(c.old)}</span> →{' '}
                    <span className="text-tone-green-fg">{formatValue(c.new)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <Pagination page={page} pageSize={h.data.pageSize} total={h.data.total} onPage={setPage} />
    </>
  );
}

export function SystemPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const units = useOrgUnits();
  const users = useActiveUsers();
  const tags = useTags();
  const [tab, setTab] = useState<'fiche' | 'completude' | 'historique'>('fiche');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reasonFor, setReasonFor] = useState<'archive' | 'restore' | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');

  const detail = useQuery({
    queryKey: ['ai-system', id],
    queryFn: () => get<AiSystemDetail>(`/api/v1/ai-systems/${id}`),
  });
  const s = detail.data;
  const base = useMemo(() => (s ? toDraft(s) : null), [s]);
  const d = draft ?? base;
  const editable = new Set(s?.permissions.updatableSections ?? []);
  const archived = !!s?.archivedAt;
  const canEdit = (section: string) => !archived && editable.has(section);

  const changed = useMemo(() => {
    if (!d || !base) return {};
    return Object.fromEntries(Object.entries(d).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(base[k])));
  }, [d, base]);
  const dirty = Object.keys(changed).length > 0;

  const setField = (k: string, v: unknown) => {
    setSaved(false);
    setDraft({ ...(d ?? {}), [k]: v });
  };

  const save = useMutation({
    mutationFn: () => patch<AiSystemDetail>(`/api/v1/ai-systems/${id}`, { version: s!.version, ...changed }),
    onSuccess: (res) => {
      qc.setQueryData(['ai-system', id], res);
      setDraft(null);
      setError(null);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['ai-systems'] });
      void qc.invalidateQueries({ queryKey: ['ai-system-history', id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setConflict(true);
      setError(errorMessage(e));
    },
  });

  const archiveMut = useMutation({
    mutationFn: ({ kind, reason }: { kind: 'archive' | 'restore'; reason: string }) =>
      post<AiSystemDetail>(`/api/v1/ai-systems/${id}/${kind}`, { reason }),
    onSuccess: (res) => {
      qc.setQueryData(['ai-system', id], res);
      setReasonFor(null);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['ai-systems'] });
      void qc.invalidateQueries({ queryKey: ['ai-system-history', id] });
    },
    onError: (e) => setReasonError(errorMessage(e)),
  });

  const createTag = useMutation({
    mutationFn: () => post<{ id: string }>('/api/v1/tags', { label: newTag }),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ['tags'] });
      setField('tagIds', [...((d?.tagIds as string[]) ?? []), t.id]);
      setNewTag('');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (detail.isPending) return <Spinner />;
  if (detail.isError) {
    return (
      <Alert tone="red" title="Fiche inaccessible">
        {errorMessage(detail.error)}{' '}
        <Link className="underline" to="/systemes">
          Retour au registre
        </Link>
      </Alert>
    );
  }
  if (!s || !d) return null;

  const str = (k: string) => (d[k] as string | null) ?? '';
  const txt = (k: string, label: string, section: string, hint?: string) => (
    <TextArea label={label} hint={hint} value={str(k)} disabled={!canEdit(section)} onChange={(v) => setField(k, v)} />
  );
  const date = (k: string, label: string, section = 'general') => (
    <TextField
      label={label}
      type="date"
      value={str(k)}
      disabled={!canEdit(section)}
      onChange={(e) => setField(k, e.target.value || null)}
    />
  );
  const tri = (k: string, label: string, section: string) => (
    <SelectField
      label={label}
      value={str(k)}
      disabled={!canEdit(section)}
      onChange={(e) => setField(k, e.target.value)}
    >
      {TRI.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </SelectField>
  );
  const userSelect = (k: string, label: string) => (
    <SelectField
      label={label}
      value={str(k)}
      disabled={!canEdit('responsibility')}
      onChange={(e) => setField(k, e.target.value || null)}
    >
      <option value="">— Aucun —</option>
      {users.data?.items.map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
      {/* Utilisateur désactivé encore désigné : conservé pour l'affichage. */}
      {str(k) && !users.data?.items.some((u) => u.id === str(k)) && (
        <option value={str(k)}>(utilisateur inactif)</option>
      )}
    </SelectField>
  );

  return (
    <>
      {/* En-tête fixe : nom, référence, statut, risque, valeur, propriétaire, complétude (CDC §7) */}
      <header className="sticky top-0 z-10 -mx-4 mb-6 border-b border-grey-200 bg-grey-50/95 px-4 py-4 backdrop-blur md:-mx-10 md:px-10">
        <nav aria-label="Fil d’Ariane" className="text-xs text-grey-500">
          <Link to="/systemes" className="hover:underline">
            Systèmes d’IA
          </Link>{' '}
          › {s.reference}
        </nav>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl leading-tight font-extrabold">
              {s.name} {s.isDemo && <Badge tone="yellow">DEMO</Badge>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-grey-600">{s.reference}</span>
              <StatusBadge value={s.status} />
              <RiskBadge value={s.riskCategory} />
              <ValueBadge value={s.valueLevel} />
              <ComplianceBadge value={s.complianceStatus} />
              <span className="text-grey-600">Propriétaire : {s.owner?.displayName ?? '—'}</span>
              <CompletenessBar value={s.completeness} />
            </div>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              Imprimer
            </Button>
            {s.permissions.canArchive && !archived && (
              <Button
                variant="danger"
                onClick={() => {
                  setReasonError(null);
                  setReasonFor('archive');
                }}
              >
                Archiver
              </Button>
            )}
            {s.permissions.canArchive && archived && (
              <Button
                variant="secondary"
                onClick={() => {
                  setReasonError(null);
                  setReasonFor('restore');
                }}
              >
                Restaurer
              </Button>
            )}
          </div>
        </div>
      </header>

      {archived && (
        <div className="mb-4">
          <Alert tone="gray" title={`Archivé le ${formatDate(s.archivedAt)}`}>
            Motif : {s.archiveReason}. La fiche est en lecture seule.
          </Alert>
        </div>
      )}

      <nav aria-label="Onglets de la fiche" className="no-print mb-4 flex gap-2">
        {(
          [
            ['fiche', 'Fiche'],
            ['completude', `Complétude (${s.completeness} %)`],
            ['historique', 'Historique'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-current={tab === k ? 'page' : undefined}
            onClick={() => setTab(k)}
            className={clsx(
              'rounded-full px-4 py-1.5 text-sm font-bold',
              tab === k ? 'bg-gls-blue text-white' : 'text-gls-blue hover:bg-gls-blue-050',
            )}
          >
            {l}
          </button>
        ))}
      </nav>

      {tab === 'fiche' && (
        <>
          <Alert tone="blue">
            Fiche de registre (tranche S2). Le parcours complet en 12 étapes (modèles, parties prenantes, actifs,
            traitements, données, classification, documentation) arrive avec la tranche S3 ; ces sections ne sont pas
            encore saisissables.
          </Alert>
          <div className="h-4" />
          <Section title="Général" editable={canEdit('general')}>
            <TextField
              label="Nom"
              required
              value={str('name')}
              disabled={!canEdit('general')}
              onChange={(e) => setField('name', e.target.value)}
            />
            <SelectField
              label="Statut"
              value={str('status')}
              disabled={!canEdit('general') || archived}
              onChange={(e) => setField('status', e.target.value)}
            >
              {archived && <option value="ARCHIVED">Archivé</option>}
              {EDITABLE_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {AI_SYSTEM_STATUS_META[v].label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Unité organisationnelle"
              value={str('orgUnitId')}
              disabled={!canEdit('general')}
              onChange={(e) => setField('orgUnitId', e.target.value)}
            >
              {units.data?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {indent(u.depth)}
                  {u.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Niveau d’autonomie"
              value={str('autonomyLevel')}
              disabled={!canEdit('general')}
              onChange={(e) => setField('autonomyLevel', e.target.value)}
            >
              {AUTONOMY_LEVELS.map((v) => (
                <option key={v} value={v}>
                  {AUTONOMY_LEVEL_LABELS[v]}
                </option>
              ))}
            </SelectField>
            {txt('description', 'Description', 'general')}
            {txt('purpose', 'Finalité', 'general')}
            {txt('objectives', 'Objectifs', 'general')}
            {txt('useCases', 'Cas d’usage', 'general')}
            {txt('functioning', 'Fonctionnement', 'general')}
            {txt('scope', 'Périmètre', 'general')}
            {txt('operationalContext', 'Contexte opérationnel', 'general')}
            {txt('targetPopulations', 'Populations visées', 'general')}
            <TextField
              label="Pays (codes ISO, séparés par des virgules)"
              value={((d.countries as string[]) ?? []).join(', ')}
              disabled={!canEdit('general')}
              onChange={(e) =>
                setField(
                  'countries',
                  e.target.value
                    .split(',')
                    .map((x) => x.trim().toUpperCase())
                    .filter((x) => x.length === 2),
                )
              }
              hint="Ex. : FR, BE"
            />
            {date('firstDeploymentDate', 'Premier déploiement')}
            {date('productionDate', 'Mise en production')}
            {date('plannedRetirementDate', 'Retrait prévu')}
            {date('actualRetirementDate', 'Retrait effectif')}
            {date('nextReviewDate', 'Prochaine revue')}
            <fieldset className="md:col-span-2">
              <legend className="mb-1 text-sm font-semibold text-grey-700">Tags</legend>
              <div className="flex flex-wrap gap-3">
                {tags.data?.items.map((t) => (
                  <label key={t.id} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      disabled={!canEdit('general')}
                      checked={((d.tagIds as string[]) ?? []).includes(t.id)}
                      onChange={(e) => {
                        const cur = (d.tagIds as string[]) ?? [];
                        setField('tagIds', e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id));
                      }}
                    />
                    {t.label}
                  </label>
                ))}
                {tags.data?.items.length === 0 && <span className="text-sm text-grey-500">Aucun tag défini.</span>}
              </div>
              {canEdit('general') && (
                <div className="mt-2 flex items-end gap-2">
                  <TextField label="Nouveau tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!newTag.trim() || createTag.isPending}
                    onClick={() => createTag.mutate()}
                  >
                    Créer et ajouter
                  </Button>
                </div>
              )}
            </fieldset>
          </Section>

          <Section title="Responsabilités" editable={canEdit('responsibility')}>
            {userSelect('ownerId', 'Propriétaire')}
            {userSelect('businessOwnerId', 'Responsable métier')}
            <fieldset className="md:col-span-2">
              <legend className="mb-1 text-sm font-semibold text-grey-700">
                Rôle(s) de GLS au sens de l’AI Act (déclaratif)
              </legend>
              <p className="mb-2 text-xs text-grey-500">
                Saisie déclarative. La détermination guidée du rôle (art. 3 et 25) sera proposée par le questionnaire AI
                Act (S5).
              </p>
              <div className="flex flex-wrap gap-3">
                {AI_ACT_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      disabled={!canEdit('responsibility')}
                      checked={((d.aiActRoles as string[]) ?? []).includes(r)}
                      onChange={(e) => {
                        const cur = (d.aiActRoles as string[]) ?? [];
                        setField('aiActRoles', e.target.checked ? [...cur, r] : cur.filter((x) => x !== r));
                      }}
                    />
                    {AI_ACT_ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </fieldset>
          </Section>

          <Section title="Personnes concernées (synthèse)" editable={canEdit('subjects')}>
            {tri('processesPersonalData', 'Traite des données personnelles', 'subjects')}
            {tri('includesMinors', 'Concerne des mineurs', 'subjects')}
            {tri('includesVulnerable', 'Concerne des personnes vulnérables', 'subjects')}
            <TextField
              label="Volume approximatif de personnes"
              value={str('affectedVolumeEstimate')}
              disabled={!canEdit('subjects')}
              onChange={(e) => setField('affectedVolumeEstimate', e.target.value)}
            />
            {txt('potentialConsequences', 'Conséquences potentielles pour les personnes', 'subjects')}
          </Section>

          <Section title="Valeur ajoutée" editable={canEdit('value')}>
            <SelectField
              label="Niveau de valeur ajoutée"
              value={str('valueLevel')}
              disabled={!canEdit('value')}
              onChange={(e) => setField('valueLevel', e.target.value)}
            >
              {VALUE_LEVELS.map((v) => (
                <option key={v} value={v}>
                  {VALUE_LEVEL_META[v].label}
                </option>
              ))}
            </SelectField>
            {txt('valueJustification', 'Justification (bénéfices, KPI, gains)', 'value')}
          </Section>

          <Card className="mb-4">
            <h2 className="mb-2 text-lg">Qualification AI Act</h2>
            <p className="text-sm text-grey-600">
              Niveau affiché : <RiskBadge value={s.riskCategory} /> — rôles déclarés : {rolesLabel(s.aiActRoles)}.
            </p>
            <p className="mt-2 text-sm text-grey-600">
              Fonctionnalité non implémentée : le questionnaire décisionnel, la justification et les obligations
              applicables seront produits par le moteur AI Act (tranche S5). Aucun niveau de risque n’est attribué
              arbitrairement d’ici là.
            </p>
          </Card>

          {(dirty || error || saved) && (
            <div className="no-print sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-grey-200 bg-white px-4 py-3 shadow-pop md:-mx-10 md:px-10">
              {error && (
                <span className="text-sm text-tone-red-fg" role="alert">
                  {error}
                </span>
              )}
              {saved && !dirty && (
                <span className="text-sm text-tone-green-fg" role="status">
                  Modifications enregistrées.
                </span>
              )}
              {dirty && (
                <span className="text-sm text-grey-600">{Object.keys(changed).length} champ(s) modifié(s)</span>
              )}
              <div className="ml-auto flex gap-2">
                {conflict && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      setConflict(false);
                      setDraft(null);
                      setError(null);
                      await detail.refetch();
                    }}
                  >
                    Recharger la fiche (perdre mes modifications)
                  </Button>
                )}
                {dirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraft(null);
                      setError(null);
                    }}
                  >
                    Annuler
                  </Button>
                )}
                {dirty && (
                  <Button disabled={save.isPending} onClick={() => save.mutate()}>
                    Enregistrer
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'completude' && (
        <Card>
          <p className="mb-4 text-sm text-grey-600">
            Critères explicites (tranche S2) ; la liste s’enrichira avec les 12 sections de la fiche (S3). Calcul
            effectué par le serveur.
          </p>
          <ul className="space-y-2">
            {s.completenessChecks.map((c) => (
              <li key={c.key} className="flex items-center gap-2 text-sm">
                <Badge tone={c.ok ? 'green' : 'gray'}>{c.ok ? 'Renseigné' : 'Manquant'}</Badge>
                {c.label}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'historique' && (
        <Card>
          <History id={s.id} />
        </Card>
      )}

      {reasonFor && (
        <ReasonModal
          title={reasonFor === 'archive' ? `Archiver ${s.reference}` : `Restaurer ${s.reference}`}
          confirmLabel={reasonFor === 'archive' ? 'Archiver' : 'Restaurer'}
          danger={reasonFor === 'archive'}
          pending={archiveMut.isPending}
          error={reasonError}
          onClose={() => setReasonFor(null)}
          onConfirm={(reason) => archiveMut.mutate({ kind: reasonFor, reason })}
        />
      )}
    </>
  );
}
