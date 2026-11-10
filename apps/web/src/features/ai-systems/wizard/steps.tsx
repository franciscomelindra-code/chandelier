import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage, post } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { AssessmentPanel } from '../../assessments/AssessmentPanel';
import clsx from 'clsx';
import {
  AI_ACT_ROLES,
  AI_ACT_ROLE_LABELS,
  AI_SYSTEM_STATUS_META,
  AUTONOMY_LEVELS,
  AUTONOMY_LEVEL_LABELS,
  EDITABLE_STATUSES,
  PARTY_FUNCTION_LABELS,
  RISK_CATEGORY_META,
  SECTION_LABELS,
  VALUE_DETAIL_LABELS,
  VALUE_LEVELS,
  VALUE_LEVEL_META,
  type PartyFunction,
  type RiskDisplayCategory,
  type ValueDetails,
  type ValueLevel,
} from '@chandelier/shared';
import { formatDate } from '../../../lib/format';
import { indent, useActiveUsers, useOrgUnits, useTags } from '../../../lib/queries';
import type { AiSystemDetail } from '../../../lib/types';
import { Alert, Badge, Button, Card, SelectField, TextField } from '../../../components/ui';
import { CompletenessBar, RiskBadge, StatusBadge, ValueBadge, rolesLabel } from '../badges';
import { DateInput, SaveBar, StepCard, TextArea, TriSelect, triLabel, useStepForm } from './form';
import {
  AssetLinks,
  Assignments,
  DataCategoriesEditor,
  DataSubjectsEditor,
  DatasetLinks,
  ProcessingLinks,
  StakeholderLinks,
  ModelLinks,
  VendorLinks,
} from './links';

export interface StepProps {
  s: AiSystemDetail;
  editable: (section: string) => boolean;
  reload: () => void;
}

const str = (v: unknown) => (v as string | null) ?? '';

// ── 1. Général ──────────────────────────────────────────────────────────────
const GENERAL_KEYS = [
  'name',
  'status',
  'orgUnitId',
  'autonomyLevel',
  'description',
  'purpose',
  'objectives',
  'useCases',
  'functioning',
  'scope',
  'operationalContext',
  'targetPopulations',
  'countries',
  'firstDeploymentDate',
  'productionDate',
  'plannedRetirementDate',
  'actualRetirementDate',
  'nextReviewDate',
  'tagIds',
] as const;

export function GeneralStep({ s, editable, reload }: StepProps) {
  const units = useOrgUnits();
  const tags = useTags();
  const init = useCallback(
    (x: AiSystemDetail) => ({
      ...Object.fromEntries(GENERAL_KEYS.map((k) => [k, (x as unknown as Record<string, unknown>)[k]])),
      orgUnitId: x.orgUnit.id,
      tagIds: x.tags.map((t) => t.id),
    }),
    [],
  );
  const f = useStepForm(s, GENERAL_KEYS, init);
  const ed = editable('general');
  const txt = (k: string, label: string) => (
    <TextArea label={label} value={str(f.get(k))} disabled={!ed} onChange={(v) => f.set(k, v)} />
  );
  return (
    <StepCard title="1. Général" editable={ed}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          label="Nom"
          required
          value={str(f.get('name'))}
          disabled={!ed}
          onChange={(e) => f.set('name', e.target.value)}
        />
        <SelectField
          label="Statut"
          value={str(f.get('status'))}
          disabled={!ed || !!s.archivedAt}
          onChange={(e) => f.set('status', e.target.value)}
        >
          {s.archivedAt && <option value="ARCHIVED">Archivé</option>}
          {EDITABLE_STATUSES.map((v) => (
            <option key={v} value={v}>
              {AI_SYSTEM_STATUS_META[v].label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Unité organisationnelle"
          value={str(f.get('orgUnitId'))}
          disabled={!ed}
          onChange={(e) => f.set('orgUnitId', e.target.value)}
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
          value={str(f.get('autonomyLevel'))}
          disabled={!ed}
          onChange={(e) => f.set('autonomyLevel', e.target.value)}
        >
          {AUTONOMY_LEVELS.map((v) => (
            <option key={v} value={v}>
              {AUTONOMY_LEVEL_LABELS[v]}
            </option>
          ))}
        </SelectField>
        {txt('description', 'Description')}
        {txt('purpose', 'Finalité')}
        {txt('objectives', 'Objectifs')}
        {txt('useCases', 'Cas d’usage')}
        {txt('functioning', 'Fonctionnement')}
        {txt('scope', 'Périmètre')}
        {txt('operationalContext', 'Contexte opérationnel')}
        {txt('targetPopulations', 'Populations visées')}
        <TextField
          label="Pays (codes ISO, séparés par des virgules)"
          hint="Ex. : FR, BE"
          value={((f.get('countries') as string[]) ?? []).join(', ')}
          disabled={!ed}
          onChange={(e) =>
            f.set(
              'countries',
              e.target.value
                .split(',')
                .map((x) => x.trim().toUpperCase())
                .filter((x) => x.length === 2),
            )
          }
        />
        <DateInput
          label="Premier déploiement"
          value={f.get('firstDeploymentDate') as string | null}
          disabled={!ed}
          onChange={(v) => f.set('firstDeploymentDate', v)}
        />
        <DateInput
          label="Mise en production"
          value={f.get('productionDate') as string | null}
          disabled={!ed}
          onChange={(v) => f.set('productionDate', v)}
        />
        <DateInput
          label="Retrait prévu"
          value={f.get('plannedRetirementDate') as string | null}
          disabled={!ed}
          onChange={(v) => f.set('plannedRetirementDate', v)}
        />
        <DateInput
          label="Retrait effectif"
          value={f.get('actualRetirementDate') as string | null}
          disabled={!ed}
          onChange={(v) => f.set('actualRetirementDate', v)}
        />
        <DateInput
          label="Prochaine revue"
          value={f.get('nextReviewDate') as string | null}
          disabled={!ed}
          onChange={(v) => f.set('nextReviewDate', v)}
        />
        <fieldset className="md:col-span-2">
          <legend className="mb-1 text-sm font-semibold text-grey-700">Tags</legend>
          <div className="flex flex-wrap gap-3">
            {tags.data?.items.map((t) => (
              <label key={t.id} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  disabled={!ed}
                  checked={((f.get('tagIds') as string[]) ?? []).includes(t.id)}
                  onChange={(e) => {
                    const cur = (f.get('tagIds') as string[]) ?? [];
                    f.set('tagIds', e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id));
                  }}
                />
                {t.label}
              </label>
            ))}
            {tags.data?.items.length === 0 && (
              <span className="text-sm text-grey-500">
                Aucun tag (création depuis le registre ou les référentiels).
              </span>
            )}
          </div>
        </fieldset>
      </div>
      <SaveBar form={f} onReload={reload} />
    </StepCard>
  );
}

// ── 2. Responsabilité ───────────────────────────────────────────────────────
const RESP_KEYS = ['ownerId', 'businessOwnerId', 'aiActRoles', 'raciEnabled'] as const;
export function ResponsibilityStep({ s, editable, reload }: StepProps) {
  const users = useActiveUsers();
  const init = useCallback(
    (x: AiSystemDetail) => ({
      ownerId: x.owner?.id ?? null,
      businessOwnerId: x.businessOwner?.id ?? null,
      aiActRoles: x.aiActRoles,
      raciEnabled: x.raciEnabled,
    }),
    [],
  );
  const f = useStepForm(s, RESP_KEYS, init);
  const ed = editable('responsibility');
  const userSelect = (k: string, label: string) => (
    <SelectField label={label} value={str(f.get(k))} disabled={!ed} onChange={(e) => f.set(k, e.target.value || null)}>
      <option value="">— Aucun —</option>
      {users.data?.items.map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
      {str(f.get(k)) && !users.data?.items.some((u) => u.id === str(f.get(k))) && (
        <option value={str(f.get(k))}>(utilisateur inactif)</option>
      )}
    </SelectField>
  );
  return (
    <>
      <StepCard title="2. Responsabilité" editable={ed}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {userSelect('ownerId', 'Propriétaire du SIA')}
          {userSelect('businessOwnerId', 'Responsable métier')}
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-sm font-semibold text-grey-700">
              Rôle(s) de GLS au sens de l’AI Act (déclaratif)
            </legend>
            <p className="mb-2 text-xs text-grey-500">
              La détermination guidée du rôle (art. 3 et 25) sera proposée par le questionnaire AI Act (S5).
            </p>
            <div className="flex flex-wrap gap-3">
              {AI_ACT_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    disabled={!ed}
                    checked={((f.get('aiActRoles') as string[]) ?? []).includes(r)}
                    onChange={(e) => {
                      const cur = (f.get('aiActRoles') as string[]) ?? [];
                      f.set('aiActRoles', e.target.checked ? [...cur, r] : cur.filter((x) => x !== r));
                    }}
                  />
                  {AI_ACT_ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              disabled={!ed}
              checked={!!f.get('raciEnabled')}
              onChange={(e) => f.set('raciEnabled', e.target.checked)}
            />
            Utiliser une matrice RACI pour les intervenants
          </label>
        </div>
        <SaveBar form={f} onReload={reload} />
      </StepCard>
      <StepCard title="Fonctions clés (sponsor, DSI, RSSI, DPO / juridique, fournisseur, intégrateur)" editable={ed}>
        <StakeholderLinks s={s} editable={ed} scope="responsibility" />
      </StepCard>
      <StepCard title="Fournisseurs, intégrateurs, hébergeurs" editable={ed}>
        <VendorLinks s={s} editable={ed} />
      </StepCard>
      <StepCard title="Affectation des sections à des contributeurs" editable={ed}>
        <Assignments s={s} canManage={ed && !s.archivedAt} />
      </StepCard>
    </>
  );
}

// ── Étapes reposant sur des tranches ultérieures ───────────────────────────
function Planned({ title, slice, children }: { title: string; slice: string; children?: React.ReactNode }) {
  return (
    <StepCard title={title} editable={false}>
      <Alert tone="gray" title="Fonctionnalité non implémentée">
        Cette étape sera livrée avec la tranche {slice}. Aucune donnée n’y est simulée.
      </Alert>
      {children && <div className="mt-4 text-sm text-grey-700">{children}</div>}
    </StepCard>
  );
}

export function ModelsStep({ s, editable }: StepProps) {
  const gpai = s.modelLinks.filter((l) => l.model.isGpai === 'YES');
  return (
    <StepCard
      title="3. Modèles d’IA"
      editable={editable('models')}
      intro="Un système d’IA n’est pas son modèle : chaque modèle lié porte la description de son utilisation propre à ce SIA, sa version et son mode d’hébergement."
    >
      {gpai.length > 0 && (
        <div className="mb-3">
          <Alert tone="blue" title="Repose sur un modèle d’IA à usage général (GPAI)">
            {gpai.map((g) => g.model.name).join(', ')}. Cette information alimentera la qualification AI Act (S5).
          </Alert>
        </div>
      )}
      <ModelLinks s={s} editable={editable('models')} />
    </StepCard>
  );
}

export function StakeholdersStep({ s, editable }: StepProps) {
  return (
    <StepCard
      title="4. Parties prenantes"
      editable={editable('stakeholders')}
      intro="Intervenants internes ou externes : utilisateurs, représentants, autres contributeurs."
    >
      <StakeholderLinks s={s} editable={editable('stakeholders')} scope="stakeholders" />
    </StepCard>
  );
}

export function AssetsStep({ s, editable }: StepProps) {
  return (
    <StepCard
      title="5. Actifs"
      editable={editable('assets')}
      intro="Applications, API, serveurs, SaaS, bases, appareils, infrastructures et dépendances. Un actif du référentiel peut être relié à plusieurs SIA."
    >
      <AssetLinks s={s} editable={editable('assets')} />
    </StepCard>
  );
}

export function ProcessingStep({ s, editable }: StepProps) {
  return (
    <StepCard
      title="6. Traitements de données"
      editable={editable('processing')}
      intro={
        <>
          Traitements du registre RGPD mobilisés par ce SIA. Données personnelles déclarées :{' '}
          <strong>{triLabel(s.processesPersonalData)}</strong> (étape 8).
        </>
      }
    >
      <ProcessingLinks s={s} editable={editable('processing')} />
    </StepCard>
  );
}

export function DataStep({ s, editable }: StepProps) {
  const ed = editable('data');
  return (
    <>
      <StepCard
        title="7. Données — sources et jeux de données"
        editable={ed}
        intro="Origine, nature et usage (entraînement, fine-tuning, RAG, inférence…) de chaque source."
      >
        <DatasetLinks s={s} editable={ed} />
      </StepCard>
      <StepCard title="Catégories de données" editable={ed}>
        <DataCategoriesEditor s={s} editable={ed} />
      </StepCard>
    </>
  );
}

// ── 8. Personnes concernées ─────────────────────────────────────────────────
const SUBJ_KEYS = [
  'processesPersonalData',
  'includesMinors',
  'includesVulnerable',
  'affectedVolumeEstimate',
  'potentialConsequences',
] as const;
export function SubjectsStep({ s, editable, reload }: StepProps) {
  const init = useCallback(
    (x: AiSystemDetail) => Object.fromEntries(SUBJ_KEYS.map((k) => [k, (x as unknown as Record<string, unknown>)[k]])),
    [],
  );
  const f = useStepForm(s, SUBJ_KEYS, init);
  const ed = editable('subjects');
  return (
    <>
      <StepCard title="8. Personnes concernées — synthèse" editable={ed}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TriSelect
            label="Traite des données personnelles"
            value={str(f.get('processesPersonalData'))}
            disabled={!ed}
            onChange={(v) => f.set('processesPersonalData', v)}
          />
          <TriSelect
            label="Concerne des mineurs"
            value={str(f.get('includesMinors'))}
            disabled={!ed}
            onChange={(v) => f.set('includesMinors', v)}
          />
          <TriSelect
            label="Concerne des personnes vulnérables"
            value={str(f.get('includesVulnerable'))}
            disabled={!ed}
            onChange={(v) => f.set('includesVulnerable', v)}
          />
          <TextField
            label="Volume global approximatif"
            value={str(f.get('affectedVolumeEstimate'))}
            disabled={!ed}
            onChange={(e) => f.set('affectedVolumeEstimate', e.target.value)}
          />
          <div className="md:col-span-2">
            <TextArea
              label="Conséquences potentielles pour les personnes"
              value={str(f.get('potentialConsequences'))}
              disabled={!ed}
              onChange={(v) => f.set('potentialConsequences', v)}
            />
          </div>
        </div>
        <SaveBar form={f} onReload={reload} />
      </StepCard>
      <StepCard title="Catégories de personnes" editable={ed}>
        <DataSubjectsEditor s={s} editable={ed} />
      </StepCard>
    </>
  );
}

export function ClassificationStep({ s }: StepProps) {
  return <AssessmentPanel s={s} />;
}

// ── 10. Valeur ajoutée ──────────────────────────────────────────────────────
const VALUE_KEYS = ['valueLevel', 'valueJustification', 'valueDetails'] as const;
const DETAIL_KEYS = Object.keys(VALUE_DETAIL_LABELS) as (keyof ValueDetails)[];

/** Matrice valeur × risque de ce SIA (la matrice de portefeuille arrive avec le tableau de bord, S8). */
export function ValueRiskMatrix({ value, risk }: { value: string; risk: string }) {
  const risks: RiskDisplayCategory[] = ['MINIMAL', 'LIMITED', 'HIGH', 'PROHIBITED'];
  const values: ValueLevel[] = ['HIGH', 'MEDIUM', 'LOW'];
  const placed = risks.includes(risk as RiskDisplayCategory) && values.includes(value as ValueLevel);
  return (
    <div>
      <table className="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
        <caption className="mb-2 text-left text-sm font-semibold text-grey-700">Position valeur × risque</caption>
        <thead>
          <tr>
            <th scope="col" className="w-28" />
            {risks.map((r) => (
              <th key={r} scope="col" className="font-semibold text-grey-600">
                {RISK_CATEGORY_META[r].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {values.map((v) => (
            <tr key={v}>
              <th scope="row" className="text-right font-semibold text-grey-600">
                Valeur {VALUE_LEVEL_META[v].label.toLowerCase()}
              </th>
              {risks.map((r) => {
                const here = placed && r === risk && v === value;
                const tone =
                  r === 'PROHIBITED'
                    ? 'bg-tone-red-bg'
                    : r === 'HIGH'
                      ? 'bg-tone-orange-bg'
                      : r === 'LIMITED'
                        ? 'bg-tone-yellow-bg'
                        : 'bg-tone-green-bg';
                return (
                  <td key={r} className={clsx('h-10 rounded-md', tone, here && 'ring-3 ring-gls-blue')}>
                    {here && <span className="font-bold text-gls-blue">● ce SIA</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!placed && (
        <p className="mt-2 text-xs text-grey-500">
          Position non déterminable :{' '}
          {risk === 'UNDETERMINED' || risk === 'OUT_OF_SCOPE' ? 'niveau de risque non qualifié (S5)' : ''}
          {value === 'UNKNOWN' ? ' · valeur ajoutée non évaluée' : ''}.
        </p>
      )}
    </div>
  );
}

export function ValueStep({ s, editable, reload }: StepProps) {
  const init = useCallback(
    (x: AiSystemDetail) => ({
      valueLevel: x.valueLevel,
      valueJustification: x.valueJustification,
      valueDetails: Object.fromEntries(DETAIL_KEYS.map((k) => [k, x.valueDetails?.[k] ?? ''])),
    }),
    [],
  );
  const f = useStepForm(s, VALUE_KEYS, init);
  const ed = editable('value');
  const details = (f.get('valueDetails') as Record<string, string>) ?? {};
  return (
    <StepCard title="10. Valeur ajoutée" editable={ed}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectField
          label="Niveau de valeur ajoutée"
          value={str(f.get('valueLevel'))}
          disabled={!ed}
          onChange={(e) => f.set('valueLevel', e.target.value)}
        >
          {VALUE_LEVELS.map((v) => (
            <option key={v} value={v}>
              {VALUE_LEVEL_META[v].label}
            </option>
          ))}
        </SelectField>
        <TextArea
          label="Justification du niveau"
          value={str(f.get('valueJustification'))}
          disabled={!ed}
          onChange={(v) => f.set('valueJustification', v)}
        />
        {DETAIL_KEYS.map((k) => (
          <TextArea
            key={k}
            label={VALUE_DETAIL_LABELS[k]}
            rows={2}
            value={details[k] ?? ''}
            disabled={!ed}
            onChange={(v) => f.set('valueDetails', { ...details, [k]: v })}
          />
        ))}
      </div>
      <SaveBar form={f} onReload={reload} />
      <div className="mt-6">
        <ValueRiskMatrix value={s.valueLevel} risk={s.riskCategory} />
      </div>
    </StepCard>
  );
}

export const DocumentationStep = () => (
  <Planned title="11. Documentation" slice="S7 (documents, preuves, versions) et S9 (notice, FRIA, DPIA)">
    Pièces jointes, notice de transparence, contrats / DPA, documentation fournisseur, DPIA / AIPD, FRIA, analyses de
    sécurité, tests, validations, instructions d’utilisation, journaux, certificats, rapports de conformité.
  </Planned>
);

// ── 12. Récapitulatif imprimable ────────────────────────────────────────────
function SaveAsTemplate({ s }: { s: AiSystemDetail }) {
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => post<{ name: string }>('/api/v1/system-templates', { name, fromSystemId: s.id }),
    onSuccess: (t) => {
      setDone(`Gabarit « ${t.name} » créé.`);
      setName('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['catalog', 'system-templates'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div className="no-print mt-6 rounded-xl border border-dashed border-grey-300 p-3">
      <p className="mb-2 text-sm font-semibold">Enregistrer cette fiche comme gabarit interne</p>
      <p className="mb-2 text-xs text-grey-500">
        Seuls les champs descriptifs sont recopiés (ni historique, ni liens, ni validations).
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      {done && <Alert tone="green">{done}</Alert>}
      <div className="flex items-end gap-2">
        <TextField label="Nom du gabarit" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          size="sm"
          variant="secondary"
          disabled={name.trim().length < 2 || m.isPending}
          onClick={() => m.mutate()}
        >
          Créer le gabarit
        </Button>
      </div>
    </div>
  );
}

export function SummaryStep({ s }: StepProps) {
  const { can } = useAuth();
  const missing = s.completenessChecks.filter((c) => !c.ok);
  const dl = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[14rem_1fr] gap-2 border-b border-grey-100 py-1.5 text-sm">
      <dt className="font-semibold text-grey-600">{label}</dt>
      <dd>{value || <span className="text-grey-400">—</span>}</dd>
    </div>
  );
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">12. Récapitulatif</h2>
        <span className="text-xs text-grey-500">
          Version {s.version} · édité le {formatDate(new Date().toISOString())}
        </span>
      </div>
      <section className="mb-6">
        <h3 className="mb-2 text-base">Synthèse</h3>
        <dl>
          {dl('Référence / nom', `${s.reference} — ${s.name}`)}
          {dl('Statut', <StatusBadge value={s.status} />)}
          {dl('Unité', s.orgUnit.name)}
          {dl('Niveau de risque', <RiskBadge value={s.riskCategory} />)}
          {dl('Valeur ajoutée', <ValueBadge value={s.valueLevel} />)}
          {dl('Complétude', <CompletenessBar value={s.completeness} />)}
          {dl('Finalité', s.purpose)}
          {dl('Rôle(s) AI Act déclarés', rolesLabel(s.aiActRoles))}
        </dl>
      </section>
      <section className="mb-6">
        <h3 className="mb-2 text-base">Alertes et informations manquantes</h3>
        {missing.length === 0 ? (
          <Alert tone="green">Tous les critères de complétude disponibles sont remplis.</Alert>
        ) : (
          <ul className="space-y-1">
            {missing.map((c) => (
              <li key={c.key} className="text-sm">
                <Badge tone="gray">{SECTION_LABELS[c.section as keyof typeof SECTION_LABELS]}</Badge> {c.label}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mb-6">
        <h3 className="mb-2 text-base">Responsables</h3>
        <dl>
          {dl('Propriétaire', s.owner?.displayName)}
          {dl('Responsable métier', s.businessOwner?.displayName)}
          {s.stakeholders.map((l) => (
            <div key={l.id}>
              {dl(
                PARTY_FUNCTION_LABELS[l.function as PartyFunction],
                `${l.stakeholder.name}${l.stakeholder.organization ? ` (${l.stakeholder.organization})` : ''}`,
              )}
            </div>
          ))}
        </dl>
      </section>
      <section className="mb-6">
        <h3 className="mb-2 text-base">Périmètre technique et données</h3>
        <dl>
          {dl(
            'Modèles d’IA (usage)',
            s.modelLinks
              .map((l) => `${l.model.name} ${l.versionUsed || l.model.version} : ${l.usageDescription}`)
              .join(' ; '),
          )}
          {dl('Fournisseurs', s.vendorLinks.map((l) => l.vendor.name).join(', '))}
          {dl('Actifs', s.assets.map((a) => a.asset.name).join(', '))}
          {dl(
            'Traitements RGPD',
            s.processing.map((p) => `${p.processingActivity.reference} ${p.processingActivity.name}`).join(', '),
          )}
          {dl('Jeux de données', s.datasets.map((d) => d.dataset.name).join(', '))}
          {dl('Catégories de données', s.dataCategories.map((d) => d.label).join(', '))}
          {dl('Personnes concernées', s.dataSubjects.map((d) => d.label).join(', '))}
          {dl('Données personnelles', triLabel(s.processesPersonalData))}
        </dl>
      </section>
      <section className="mb-6">
        <h3 className="mb-2 text-base">Prochaines échéances</h3>
        <dl>
          {dl('Prochaine revue', formatDate(s.nextReviewDate))}
          {dl('Retrait prévu', formatDate(s.plannedRetirementDate))}
        </dl>
      </section>
      <section>
        <h3 className="mb-2 text-base">Obligations, documents et validations</h3>
        <p className="text-sm text-grey-600">
          Fonctionnalité non implémentée : obligations (S5), documents et validations (S7). Rien n’est affiché tant que
          ces modules ne produisent pas de données réelles.
        </p>
      </section>
      {can('catalog:manage') && <SaveAsTemplate s={s} />}
    </Card>
  );
}
