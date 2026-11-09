import { useState, type ComponentType } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ORIGIN_LABELS, SECTION_LABELS, SECTION_ORDER, type SectionKey } from '@chandelier/shared';
import { errorMessage, get, post } from '../../lib/api';
import { formatDate, formatDateTime, formatValue } from '../../lib/format';
import type { AiSystemDetail, AuditEvent, Page } from '../../lib/types';
import { Alert, Badge, Button, Card, Modal, Pagination, Spinner, TextField } from '../../components/ui';
import { CompletenessBar, ComplianceBadge, RiskBadge, StatusBadge, ValueBadge } from './badges';
import {
  AssetsStep,
  ClassificationStep,
  DataStep,
  DocumentationStep,
  GeneralStep,
  ModelsStep,
  ProcessingStep,
  ResponsibilityStep,
  StakeholdersStep,
  SubjectsStep,
  SummaryStep,
  ValueStep,
  type StepProps,
} from './wizard/steps';

/** Étapes dont le contenu dépend d'une tranche ultérieure. */
const PLANNED: Partial<Record<SectionKey, string>> = { models: 'S4', classification: 'S5', documentation: 'S7' };

const STEP_COMPONENTS: Record<SectionKey, ComponentType<StepProps>> = {
  general: GeneralStep,
  responsibility: ResponsibilityStep,
  models: ModelsStep,
  stakeholders: StakeholdersStep,
  assets: AssetsStep,
  processing: ProcessingStep,
  data: DataStep,
  subjects: SubjectsStep,
  classification: ClassificationStep,
  value: ValueStep,
  documentation: DocumentationStep,
  summary: SummaryStep,
};

function ReasonModal(props: {
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
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Annuler
          </Button>
          <Button
            variant={props.danger ? 'danger' : 'primary'}
            disabled={props.pending || reason.trim().length < 10}
            onClick={() => props.onConfirm(reason)}
          >
            {props.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {props.error && <Alert tone="red">{props.error}</Alert>}
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
                  <li key={f} className="break-words">
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

function stepState(s: AiSystemDetail, k: SectionKey): { tone: 'green' | 'yellow' | 'gray' | 'blue'; label: string } {
  if (PLANNED[k]) return { tone: 'gray', label: `à venir (${PLANNED[k]})` };
  if (k === 'summary') return { tone: 'blue', label: `${s.completeness} %` };
  const checks = s.completenessChecks.filter((c) => c.section === k);
  if (!checks.length) return { tone: 'blue', label: '' };
  const ok = checks.filter((c) => c.ok).length;
  if (ok === checks.length) return { tone: 'green', label: 'complète' };
  return { tone: ok === 0 ? 'gray' : 'yellow', label: `${ok}/${checks.length}` };
}

export function SystemPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'fiche' | 'historique'>('fiche');
  const [reasonFor, setReasonFor] = useState<'archive' | 'restore' | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const step = (SECTION_ORDER as readonly string[]).includes(sp.get('etape') ?? '')
    ? (sp.get('etape') as SectionKey)
    : 'general';

  const detail = useQuery({
    queryKey: ['ai-system', id],
    queryFn: () => get<AiSystemDetail>(`/api/v1/ai-systems/${id}`),
  });
  const s = detail.data;

  const archiveMut = useMutation({
    mutationFn: ({ kind, reason }: { kind: 'archive' | 'restore'; reason: string }) =>
      post<AiSystemDetail>(`/api/v1/ai-systems/${id}/${kind}`, { reason }),
    onSuccess: (res) => {
      qc.setQueryData(['ai-system', id], res);
      setReasonFor(null);
      void qc.invalidateQueries({ queryKey: ['ai-systems'] });
      void qc.invalidateQueries({ queryKey: ['ai-system-history', id] });
    },
    onError: (e) => setReasonError(errorMessage(e)),
  });

  if (detail.isPending) return <Spinner />;
  if (detail.isError || !s) {
    return (
      <Alert tone="red" title="Fiche inaccessible">
        {errorMessage(detail.error)}{' '}
        <Link className="underline" to="/systemes">
          Retour au registre
        </Link>
      </Alert>
    );
  }

  const archived = !!s.archivedAt;
  const editable = (section: string) => !archived && s.permissions.updatableSections.includes(section);
  const Step = STEP_COMPONENTS[step];
  const index = SECTION_ORDER.indexOf(step);
  const go = (k: SectionKey) => {
    const next = new URLSearchParams(sp);
    next.set('etape', k);
    setSp(next, { replace: true });
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      {/* En-tête fixe : nom, référence, statut, risque, valeur, propriétaire, complétude (CDC §7) */}
      <header className="sticky top-0 z-20 -mx-4 mb-6 border-b border-grey-200 bg-grey-50/95 px-4 py-4 backdrop-blur md:-mx-10 md:px-10">
        <nav aria-label="Fil d’Ariane" className="no-print text-xs text-grey-500">
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
            <Button
              variant="secondary"
              onClick={() => {
                go('summary');
                setTab('fiche');
                setTimeout(() => window.print(), 300);
              }}
            >
              Imprimer le récapitulatif
            </Button>
            {s.permissions.canArchive && !archived && (
              <Button variant="danger" onClick={() => (setReasonError(null), setReasonFor('archive'))}>
                Archiver
              </Button>
            )}
            {s.permissions.canArchive && archived && (
              <Button variant="secondary" onClick={() => (setReasonError(null), setReasonFor('restore'))}>
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
            ['fiche', 'Fiche (12 étapes)'],
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

      {tab === 'historique' ? (
        <Card>
          <History id={s.id} />
        </Card>
      ) : (
        <div className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-6">
          <nav aria-label="Étapes de la fiche" className="no-print mb-4 lg:sticky lg:top-40 lg:mb-0 lg:self-start">
            <ol className="space-y-1">
              {SECTION_ORDER.map((k, i) => {
                const st = stepState(s, k);
                const active = k === step;
                return (
                  <li key={k}>
                    <button
                      type="button"
                      aria-current={active ? 'step' : undefined}
                      onClick={() => go(k)}
                      className={clsx(
                        'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm',
                        active ? 'bg-gls-blue font-bold text-white' : 'hover:bg-gls-blue-050',
                      )}
                    >
                      <span>
                        {i + 1}. {SECTION_LABELS[k]}
                        {!editable(k) && !PLANNED[k] && k !== 'summary' && (
                          <span className="sr-only"> (lecture seule)</span>
                        )}
                      </span>
                      {st.label && (
                        <span
                          className={clsx(
                            'shrink-0 rounded-full px-2 text-[0.65rem] font-bold',
                            active
                              ? 'bg-white/20'
                              : {
                                  'bg-tone-green-bg text-tone-green-fg': st.tone === 'green',
                                  'bg-tone-yellow-bg text-tone-yellow-fg': st.tone === 'yellow',
                                  'bg-tone-gray-bg text-tone-gray-fg': st.tone === 'gray',
                                  'bg-tone-blue-bg text-tone-blue-fg': st.tone === 'blue',
                                },
                          )}
                        >
                          {st.label}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 px-3 text-xs text-grey-500">Chaque étape s’enregistre indépendamment.</p>
          </nav>
          <div>
            {/* key : réinitialise le brouillon de l'étape quand on change d'étape ou de version. */}
            <Step key={`${step}`} s={s} editable={editable} reload={() => void detail.refetch()} />
            <div className="no-print mt-2 flex justify-between">
              <Button variant="ghost" disabled={index === 0} onClick={() => go(SECTION_ORDER[index - 1]!)}>
                ← Étape précédente
              </Button>
              <Button
                variant="ghost"
                disabled={index === SECTION_ORDER.length - 1}
                onClick={() => go(SECTION_ORDER[index + 1]!)}
              >
                Étape suivante →
              </Button>
            </div>
          </div>
        </div>
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
