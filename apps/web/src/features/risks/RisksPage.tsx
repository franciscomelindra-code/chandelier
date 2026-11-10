import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  RISK_STATUS_META,
  RISK_STATUSES,
  RISK_TYPE_LABELS,
  RISK_TYPES,
  RISK_WARNINGS,
  type RiskWarning,
} from '@chandelier/shared';
import { errorMessage, get, qs } from '../../lib/api';
import { Alert, Button, Card, PageHeader, Pagination, SelectField, Spinner, TextField } from '../../components/ui';
import { NewActionModal } from '../actions/ActionForm';
import { ActionsTable } from '../actions/ActionsTable';
import { LevelBadge, RiskHeatmap } from './RiskHeatmap';
import { NewRiskModal, RisksTable } from './RiskList';
import type { ActionView, Heatmap, Methodology, Risk } from './types';

interface RiskPortfolio {
  items: Risk[];
  total: number;
  page: number;
  pageSize: number;
  truncated: boolean;
  heatmap: Heatmap;
  levelCounts: Record<string, number>;
  methodology: Methodology;
}

const FILTERS = ['q', 'category', 'status', 'level', 'warning', 'cell', 'includeClosed', 'demo', 'sort', 'dir', 'page'];

/** Portefeuille des risques du périmètre : filtres dans l'URL, carte de chaleur cliquable. */
export function RisksPage() {
  const [sp, setSp] = useSearchParams();
  const params = Object.fromEntries(FILTERS.map((k) => [k, sp.get(k) ?? '']));
  const [search, setSearch] = useState(params.q ?? '');
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const q = useQuery({
    queryKey: ['risks', params],
    queryFn: () => get<RiskPortfolio>(`/api/v1/risks${qs({ ...params, pageSize: 50 })}`),
  });
  return (
    <>
      <PageHeader
        eyebrow="Pilotage"
        title="Risques"
        description="Registre des risques de vos systèmes d’IA. Les scores et niveaux sont calculés selon la méthodologie paramétrée par l’administrateur ; chaque risque se crée depuis l’onglet « Risques » de la fiche du SIA."
      />
      {q.isError ? (
        <Alert tone="red">{errorMessage(q.error)}</Alert>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-4">
            <Card className="!p-4">
              <form
                className="grid grid-cols-1 gap-3 md:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  update({ q: search.trim() });
                }}
              >
                <TextField
                  label="Recherche"
                  placeholder="Référence, intitulé, scénario, SIA"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onBlur={() => update({ q: search.trim() })}
                />
                <SelectField
                  label="Catégorie"
                  value={params.category}
                  onChange={(e) => update({ category: e.target.value })}
                >
                  <option value="">Toutes</option>
                  {RISK_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {RISK_TYPE_LABELS[c]}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Statut" value={params.status} onChange={(e) => update({ status: e.target.value })}>
                  <option value="">Ouverts (hors clos)</option>
                  {RISK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {RISK_STATUS_META[s].label}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Niveau (résiduel, à défaut inhérent)"
                  value={params.level}
                  onChange={(e) => update({ level: e.target.value })}
                >
                  <option value="">Tous</option>
                  {q.data?.methodology.config.thresholds.map((t) => (
                    <option key={t.level} value={t.level}>
                      {t.label}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Point d’attention"
                  value={params.warning}
                  onChange={(e) => update({ warning: e.target.value })}
                >
                  <option value="">—</option>
                  {(Object.keys(RISK_WARNINGS) as RiskWarning[]).map((w) => (
                    <option key={w} value={w}>
                      {RISK_WARNINGS[w]}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Tri"
                  value={`${params.sort || 'score'}:${params.dir || 'desc'}`}
                  onChange={(e) => {
                    const [sort, dir] = e.target.value.split(':');
                    update({ sort: sort!, dir: dir! });
                  }}
                >
                  <option value="score:desc">Score décroissant</option>
                  <option value="dueDate:asc">Échéance la plus proche</option>
                  <option value="reference:asc">Référence</option>
                  <option value="updatedAt:desc">Dernière modification</option>
                </SelectField>
              </form>
              {(params.cell || Object.values(params).some(Boolean)) && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="ghost"
                  onClick={() => (setSearch(''), setSp(new URLSearchParams(), { replace: true }))}
                >
                  Réinitialiser les filtres
                </Button>
              )}
            </Card>
            {q.isPending ? (
              <Spinner />
            ) : (
              <Card className="!p-0">
                {q.data.truncated && (
                  <Alert tone="orange">Plus de 5 000 risques correspondent : affinez les filtres.</Alert>
                )}
                <RisksTable items={q.data.items} />
                <div className="px-4 pb-4">
                  <Pagination
                    page={q.data.page}
                    pageSize={q.data.pageSize}
                    total={q.data.total}
                    onPage={(p) => update({ page: String(p) })}
                  />
                </div>
              </Card>
            )}
          </div>
          {q.data && (
            <aside className="space-y-4">
              <Card>
                <h2 className="mb-2 text-base">Carte de chaleur</h2>
                <RiskHeatmap
                  config={q.data.methodology.config}
                  heatmap={q.data.heatmap}
                  selected={params.cell || null}
                  onSelect={(cell) => update({ cell })}
                />
              </Card>
              <Card>
                <h2 className="mb-2 text-base">Répartition par niveau</h2>
                <ul className="space-y-1 text-sm">
                  {q.data.methodology.config.thresholds.map((t) => (
                    <li key={t.level} className="flex items-center justify-between gap-4">
                      <LevelBadge level={{ level: t.level, label: t.label, tone: t.tone }} />
                      <button
                        type="button"
                        className="text-gls-blue hover:underline"
                        onClick={() => update({ level: t.level })}
                      >
                        {q.data.levelCounts[t.level] ?? 0}
                      </button>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-4 text-grey-600">
                    Non cotés <span>{q.data.levelCounts.NOT_SCORED ?? 0}</span>
                  </li>
                </ul>
                <p className="mt-2 text-xs text-grey-500">
                  Méthodologie active : {q.data.methodology.name} v{q.data.methodology.version}
                </p>
              </Card>
            </aside>
          )}
        </div>
      )}
    </>
  );
}

/** Onglet « Risques » de la fiche SIA. */
export function SystemRisks({ systemId }: { systemId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['risks', 'system', systemId],
    queryFn: () =>
      get<{
        items: Risk[];
        heatmap: Heatmap;
        methodology: Methodology;
        permissions: { canManage: boolean };
      }>(`/api/v1/ai-systems/${systemId}/risks`),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
      <Card className="min-w-0 !p-0">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-lg">Registre des risques ({q.data.items.length})</h2>
          {q.data.permissions.canManage && <Button onClick={() => setOpen(true)}>Nouveau risque</Button>}
        </div>
        <RisksTable items={q.data.items} showSystem={false} />
      </Card>
      <Card>
        <h2 className="mb-2 text-base">Carte de chaleur (risques ouverts)</h2>
        <RiskHeatmap config={q.data.methodology.config} heatmap={q.data.heatmap} />
      </Card>
      {open && (
        <NewRiskModal open onClose={() => setOpen(false)} aiSystemId={systemId} methodology={q.data.methodology} />
      )}
    </div>
  );
}

/** Onglet « Actions » de la fiche SIA. */
export function SystemActions({ systemId }: { systemId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['actions', 'system', systemId],
    queryFn: () =>
      get<{ items: ActionView[]; permissions: { canManage: boolean } }>(`/api/v1/ai-systems/${systemId}/actions`),
  });
  const risks = useQuery({
    queryKey: ['risks', 'system', systemId],
    queryFn: () => get<{ items: Risk[] }>(`/api/v1/ai-systems/${systemId}/risks`),
    enabled: open,
  });
  const obligations = useQuery({
    queryKey: ['obligations', systemId],
    queryFn: () => get<{ items: { id: string; title: string }[] }>(`/api/v1/ai-systems/${systemId}/obligations`),
    enabled: open,
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <Card className="!p-0">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-lg">Plan d’action ({q.data.items.length})</h2>
        {q.data.permissions.canManage && <Button onClick={() => setOpen(true)}>Nouvelle action</Button>}
      </div>
      <ActionsTable items={q.data.items} showSystem={false} />
      {open && risks.data && obligations.data && (
        <NewActionModal
          open
          onClose={() => setOpen(false)}
          aiSystemId={systemId}
          risks={risks.data.items.map((r) => ({ id: r.id, label: `${r.reference} — ${r.title}` }))}
          obligations={obligations.data.items.map((o) => ({ id: o.id, label: o.title }))}
        />
      )}
    </Card>
  );
}
