import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AI_ACT_ROLE_LABELS,
  AI_ACT_ROLES,
  AI_SYSTEM_STATUS_META,
  COMPLIANCE_STATUS_META,
  RISK_CATEGORY_META,
  VALUE_LEVEL_META,
} from '@chandelier/shared';
import { errorMessage, get } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { indent, useActiveUsers, useCatalog, useOrgUnits, useTags } from '../../lib/queries';
import type { AiModel, Vendor } from '../../lib/types';
import { Alert, Badge, Button, Card, PageHeader, SelectField, Spinner, TextField } from '../../components/ui';

interface DashboardData {
  generatedAt: string;
  total: number;
  truncated: boolean;
  byStatus: Record<string, number>;
  byRisk: Record<string, number>;
  byValue: Record<string, number>;
  byCompliance: Record<string, number>;
  byUnit: { id: string; name: string; count: number }[];
  otherUnits: number;
  matrix: Record<string, Record<string, number>>;
  evolution: { month: string; created: number; total: number }[];
  kpis: Record<string, number | null>;
  alerts: {
    code: string;
    severity: 'critical' | 'serious' | 'warning';
    message: string;
    count: number;
    link: string;
  }[];
}

/** Filtres du tableau de bord = filtres du registre ; ils sont reportés dans les liens d'exploration. */
const FILTER_KEYS = [
  'orgUnitId',
  'ownerId',
  'vendorId',
  'modelId',
  'risk',
  'role',
  'status',
  'tagId',
  'createdFrom',
  'createdTo',
  'demo',
];

const RISK_ROWS = ['PROHIBITED', 'HIGH', 'LIMITED', 'MINIMAL', 'UNDETERMINED', 'OUT_OF_SCOPE'] as const;
const VALUE_COLS = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;

const SEVERITY = {
  critical: { label: 'Critique', tone: 'red', icon: '⛔' },
  serious: { label: 'Important', tone: 'orange', icon: '⚠' },
  warning: { label: 'À suivre', tone: 'yellow', icon: '●' },
} as const;

function withFilters(base: string, sp: URLSearchParams, keys = FILTER_KEYS) {
  const [path, query = ''] = base.split('?');
  const out = new URLSearchParams(query);
  for (const k of keys) {
    const v = sp.get(k);
    if (v && !out.has(k)) out.set(k, v);
  }
  const s = out.toString();
  return s ? `${path}?${s}` : path!;
}

function Tile({
  label,
  value,
  to,
  hint,
  tone,
}: {
  label: string;
  value: number | string | null | undefined;
  to?: string;
  hint?: string;
  tone?: 'red' | 'orange';
}) {
  const body = (
    <>
      <span className="text-xs font-bold uppercase tracking-wide text-grey-500">{label}</span>
      <span
        className={clsx(
          'mt-1 block text-3xl font-extrabold',
          tone === 'red' ? 'text-tone-red-fg' : tone === 'orange' ? 'text-tone-orange-fg' : 'text-ink',
        )}
      >
        {value ?? '—'}
      </span>
      {hint && <span className="mt-1 block text-xs text-grey-500">{hint}</span>}
    </>
  );
  const cls = 'block rounded-[var(--radius-card)] bg-white p-4 shadow-card';
  return to ? (
    <Link to={to} className={clsx(cls, 'hover:ring-2 hover:ring-gls-blue/40 focus-visible:ring-2')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Barres horizontales (une seule série, une seule teinte, valeur affichée). Chaque ligne ouvre la liste filtrée. */
function BarList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; value: number; to?: string; badgeTone?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <h2 className="mb-3 text-base">{title}</h2>
      {rows.every((r) => r.value === 0) ? (
        <p className="text-sm text-grey-500">Aucun SIA.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="w-40 shrink-0 truncate" title={r.label}>
                  {r.label}
                </span>
                <span className="relative h-3 flex-1 rounded-r bg-grey-100" aria-hidden="true">
                  <span
                    className="absolute inset-y-0 left-0 rounded-r bg-gls-blue"
                    style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 3 : 0 }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-bold tabular-nums">{r.value}</span>
              </>
            );
            return (
              <li key={r.key}>
                {r.to && r.value > 0 ? (
                  <Link
                    to={r.to}
                    className="flex items-center gap-2 rounded hover:bg-gls-blue-050"
                    title={`${r.label} : ${r.value} — ouvrir la liste`}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2" title={`${r.label} : ${r.value}`}>
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Matrice risque AI Act × valeur ajoutée : intensité = nombre de SIA (une teinte), cellules cliquables. */
function RiskValueMatrix({ m, sp }: { m: DashboardData['matrix']; sp: URLSearchParams }) {
  const max = Math.max(1, ...RISK_ROWS.flatMap((r) => VALUE_COLS.map((v) => m[r]?.[v] ?? 0)));
  return (
    <Card>
      <h2 className="mb-1 text-base">Matrice risque × valeur</h2>
      <p className="mb-3 text-xs text-grey-500">
        Catégorie AI Act effective (lignes) et valeur ajoutée déclarée (colonnes). Chaque cellule ouvre la liste des SIA
        concernés.
      </p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-sm">
          <caption className="sr-only">
            Nombre de SIA par catégorie de risque AI Act et niveau de valeur ajoutée
          </caption>
          <thead>
            <tr>
              <th />
              {VALUE_COLS.map((v) => (
                <th key={v} scope="col" className="px-2 text-xs font-semibold text-grey-600">
                  Valeur {VALUE_LEVEL_META[v].label.toLowerCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RISK_ROWS.map((r) => (
              <tr key={r}>
                <th scope="row" className="pr-2 text-right">
                  <Badge tone={RISK_CATEGORY_META[r].tone}>{RISK_CATEGORY_META[r].label}</Badge>
                </th>
                {VALUE_COLS.map((v) => {
                  const n = m[r]?.[v] ?? 0;
                  const label = `${n} SIA — ${RISK_CATEGORY_META[r].label}, valeur ${VALUE_LEVEL_META[v].label.toLowerCase()}`;
                  const style = n
                    ? { backgroundColor: `color-mix(in srgb, var(--color-gls-blue) ${15 + (n / max) * 70}%, white)` }
                    : undefined;
                  const cls = clsx(
                    'flex h-11 w-20 items-center justify-center rounded-md font-bold tabular-nums',
                    n ? (n / max > 0.5 ? 'text-white' : 'text-ink') : 'bg-grey-50 text-grey-300',
                  );
                  return (
                    <td key={v} className="p-0">
                      {n ? (
                        <Link
                          to={withFilters(`/systemes?risk=${r}&value=${v}`, sp)}
                          className={clsx(cls, 'hover:ring-2 hover:ring-gls-yellow')}
                          style={style}
                          title={label}
                          aria-label={label}
                        >
                          {n}
                        </Link>
                      ) : (
                        <span className={cls} title={label} aria-label={label}>
                          0
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Évolution : SIA créés par mois (barres, une série) ; le cumul figure dans l'infobulle et le tableau. */
function Evolution({ data }: { data: DashboardData['evolution'] }) {
  const max = Math.max(1, ...data.map((d) => d.created));
  const fmt = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return (
    <Card>
      <h2 className="mb-1 text-base">SIA enregistrés par mois</h2>
      <p className="mb-3 text-xs text-grey-500">
        12 derniers mois, selon la date de création de la fiche. Total à date : {data.at(-1)?.total ?? 0}.
      </p>
      <div
        className="flex h-40 items-end gap-1"
        role="img"
        aria-label="Histogramme des SIA créés par mois (valeurs dans le tableau ci-dessous)"
      >
        {data.map((d) => (
          <div
            key={d.month}
            className="flex h-full flex-1 flex-col items-center justify-end"
            title={`${fmt(d.month)} : ${d.created} créé(s), ${d.total} au total`}
          >
            {d.created > 0 && <span className="text-xs font-bold tabular-nums">{d.created}</span>}
            <span
              className="w-full max-w-8 rounded-t bg-gls-blue"
              style={{ height: `${(d.created / max) * 80}%`, minHeight: d.created ? 3 : 0 }}
            />
            <span className="mt-1 h-px w-full bg-grey-300" />
            <span className="mt-1 text-[0.65rem] text-grey-500">{fmt(d.month)}</span>
          </div>
        ))}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-gls-blue">Afficher le tableau</summary>
        <table className="mt-1 w-full text-left">
          <thead className="text-grey-500">
            <tr>
              <th>Mois</th>
              <th>Créés</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <td>{fmt(d.month)}</td>
                <td>{d.created}</td>
                <td>{d.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

function Filters({ sp, setSp }: { sp: URLSearchParams; setSp: (p: URLSearchParams) => void }) {
  const units = useOrgUnits();
  const users = useActiveUsers();
  const tags = useTags();
  const vendors = useCatalog<Vendor>('vendors');
  const models = useCatalog<AiModel>('ai-models');
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next);
  };
  const sel = (k: string, label: string, options: { value: string; label: string }[]) => (
    <SelectField label={label} value={sp.get(k) ?? ''} onChange={(e) => set(k, e.target.value)}>
      <option value="">Tous</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectField>
  );
  return (
    <Card className="mb-4 !p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {sel(
          'orgUnitId',
          'Unité (sous-unités incluses)',
          (units.data?.items ?? []).map((u) => ({ value: u.id, label: `${indent(u.depth)}${u.name}` })),
        )}
        {sel(
          'ownerId',
          'Propriétaire',
          (users.data?.items ?? []).map((u) => ({ value: u.id, label: u.displayName })),
        )}
        {sel(
          'vendorId',
          'Fournisseur',
          (vendors.data?.items ?? []).map((v) => ({ value: v.id, label: v.name })),
        )}
        {sel(
          'modelId',
          'Modèle',
          (models.data?.items ?? []).map((m) => ({ value: m.id, label: m.name })),
        )}
        {sel(
          'risk',
          'Catégorie AI Act',
          RISK_ROWS.map((r) => ({ value: r, label: RISK_CATEGORY_META[r].label })),
        )}
        {sel(
          'role',
          'Rôle AI Act',
          AI_ACT_ROLES.map((r) => ({ value: r, label: AI_ACT_ROLE_LABELS[r] })),
        )}
        {sel(
          'status',
          'Statut',
          Object.entries(AI_SYSTEM_STATUS_META).map(([k, m]) => ({ value: k, label: m.label })),
        )}
        {sel(
          'tagId',
          'Tag',
          (tags.data?.items ?? []).map((t) => ({ value: t.id, label: t.label })),
        )}
        <TextField
          label="Créés depuis le"
          type="date"
          value={sp.get('createdFrom') ?? ''}
          onChange={(e) => set('createdFrom', e.target.value)}
        />
        <TextField
          label="Créés jusqu’au"
          type="date"
          value={sp.get('createdTo') ?? ''}
          onChange={(e) => set('createdTo', e.target.value)}
        />
        <SelectField label="Données DEMO" value={sp.get('demo') ?? ''} onChange={(e) => set('demo', e.target.value)}>
          <option value="">Incluses</option>
          <option value="exclude">Exclues</option>
          <option value="only">Uniquement</option>
        </SelectField>
      </div>
      {FILTER_KEYS.some((k) => sp.get(k)) && (
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => setSp(new URLSearchParams())}>
          Réinitialiser les filtres
        </Button>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const [sp, setSp] = useSearchParams();
  const query = new URLSearchParams();
  for (const k of FILTER_KEYS) if (sp.get(k)) query.set(k, sp.get(k)!);
  const q = useQuery({
    queryKey: ['dashboard', query.toString()],
    queryFn: () => get<DashboardData>(`/api/v1/dashboard?${query.toString()}`),
  });
  const link = (base: string, keys?: string[]) => withFilters(base, sp, keys);
  return (
    <>
      <PageHeader
        eyebrow="Pilotage"
        title="Tableau de bord"
        description="Indicateurs calculés à la demande sur les systèmes d’IA de votre périmètre (hors archivés), selon les filtres ci-dessous. Chaque indicateur ouvre la liste correspondante."
      />
      <Filters sp={sp} setSp={(p) => setSp(p, { replace: true })} />
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <Alert tone="red">{errorMessage(q.error)}</Alert>
      ) : (
        <div className="space-y-4">
          {q.data.truncated && <Alert tone="orange">Plus de 10 000 SIA : affinez les filtres.</Alert>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Tile label="SIA" value={q.data.total} to={link('/systemes')} />
            <Tile
              label="Haut risque"
              value={q.data.kpis.highRisk}
              to={link('/systemes?risk=HIGH')}
              tone={q.data.kpis.highRisk ? 'orange' : undefined}
            />
            <Tile
              label="Potentiellement interdits"
              value={q.data.kpis.prohibited}
              to={link('/systemes?risk=PROHIBITED')}
              tone={q.data.kpis.prohibited ? 'red' : undefined}
            />
            <Tile label="Non qualifiés" value={q.data.kpis.notQualified} to={link('/systemes?qualified=no')} />
            <Tile
              label="FRIA manquantes"
              value={q.data.kpis.friaMissing}
              hint={`${q.data.kpis.friaRequired} requise(s)`}
              to="/documentation/fria"
            />
            <Tile
              label="Notices manquantes"
              value={q.data.kpis.noticeMissing}
              hint={`${q.data.kpis.noticeRequired} SIA concerné(s)`}
              to="/documentation/notices"
            />
            <Tile
              label="Risques critiques ouverts"
              value={q.data.kpis.criticalRisks}
              hint={`${q.data.kpis.openRisks} risque(s) ouvert(s)`}
              to="/risques"
              tone={q.data.kpis.criticalRisks ? 'red' : undefined}
            />
            <Tile
              label="Actions échues"
              value={q.data.kpis.actionsOverdue}
              hint={`${q.data.kpis.actionsOpen} ouverte(s)`}
              to="/actions?overdue=true"
              tone={q.data.kpis.actionsOverdue ? 'orange' : undefined}
            />
            <Tile
              label="Revues en retard"
              value={q.data.kpis.reviewsOverdue}
              hint={`${q.data.kpis.reviewsNext30Days} dans les 30 jours`}
            />
            <Tile label="Validations en attente" value={q.data.kpis.pendingApprovals} to="/notifications" />
            <Tile label="Versions validées" value={q.data.kpis.validated} hint="version courante validée" />
            <Tile
              label="Complétude moyenne"
              value={q.data.kpis.averageCompleteness == null ? null : `${q.data.kpis.averageCompleteness} %`}
              hint={`${q.data.kpis.incomplete} fiche(s) < 50 %`}
              to={link('/systemes?completenessMax=49')}
            />
          </div>
          <p className="text-xs text-grey-500">
            Tous les compteurs respectent les filtres. Les listes des SIA s’ouvrent avec les mêmes filtres ; les pages
            Risques, Actions, Documentation et Notifications s’ouvrent sur l’ensemble de votre périmètre. Calculé le{' '}
            {formatDateTime(q.data.generatedAt)}.
          </p>

          <Card>
            <h2 className="mb-2 text-base">Alertes ({q.data.alerts.length})</h2>
            {q.data.alerts.length === 0 ? (
              <p className="text-sm text-grey-500">Aucune alerte sur ce périmètre.</p>
            ) : (
              <ul className="divide-y divide-grey-100">
                {q.data.alerts.map((a) => (
                  <li key={a.code} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge tone={SEVERITY[a.severity].tone}>
                        <span aria-hidden="true">{SEVERITY[a.severity].icon}</span> {SEVERITY[a.severity].label}
                      </Badge>
                      {a.message}
                    </span>
                    <Link
                      to={a.link.startsWith('/systemes') ? link(a.link) : a.link}
                      className="font-bold text-gls-blue hover:underline"
                    >
                      {a.count} — voir
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RiskValueMatrix m={q.data.matrix} sp={sp} />
            <Evolution data={q.data.evolution} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <BarList
              title="Par catégorie AI Act"
              rows={RISK_ROWS.map((r) => ({
                key: r,
                label: RISK_CATEGORY_META[r].label,
                value: q.data.byRisk[r] ?? 0,
                to: link(
                  `/systemes?risk=${r}`,
                  FILTER_KEYS.filter((k) => k !== 'risk'),
                ),
              }))}
            />
            <BarList
              title="Par statut"
              rows={Object.entries(AI_SYSTEM_STATUS_META).map(([k, m]) => ({
                key: k,
                label: m.label,
                value: q.data.byStatus[k] ?? 0,
                to: link(
                  `/systemes?status=${k}`,
                  FILTER_KEYS.filter((x) => x !== 'status'),
                ),
              }))}
            />
            <BarList
              title="Par valeur ajoutée"
              rows={VALUE_COLS.map((v) => ({
                key: v,
                label: VALUE_LEVEL_META[v].label,
                value: q.data.byValue[v] ?? 0,
                to: link(`/systemes?value=${v}`),
              }))}
            />
            <BarList
              title="Par conformité"
              rows={Object.entries(COMPLIANCE_STATUS_META).map(([k, m]) => ({
                key: k,
                label: m.label,
                value: q.data.byCompliance[k] ?? 0,
                to: link(`/systemes?compliance=${k}`),
              }))}
            />
            <BarList
              title={`Par unité${q.data.otherUnits ? ` (12 premières ; autres : ${q.data.otherUnits})` : ''}`}
              rows={q.data.byUnit.map((u) => ({
                key: u.id,
                label: u.name,
                value: u.count,
                to: link(
                  `/systemes?orgUnitId=${u.id}`,
                  FILTER_KEYS.filter((k) => k !== 'orgUnitId'),
                ),
              }))}
            />
          </div>
        </div>
      )}
    </>
  );
}
