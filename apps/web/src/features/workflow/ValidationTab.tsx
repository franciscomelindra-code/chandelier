import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPROVAL_DOMAIN_LABELS,
  APPROVAL_DOMAINS,
  APPROVAL_STATUS_META,
  REVIEW_KIND_LABELS,
  REVIEW_STATUS_META,
  REVIEW_TRIGGER_LABELS,
  REVIEW_TRIGGERS,
  type ApprovalDomain,
} from '@chandelier/shared';
import { api, errorMessage, get, post } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { useActiveUsers } from '../../lib/queries';
import { Alert, Badge, Button, Card, EmptyState, Modal, SelectField, Spinner, TextField } from '../../components/ui';

interface ApprovalView {
  id: string;
  entityVersion: number;
  domain: ApprovalDomain;
  status: keyof typeof APPROVAL_STATUS_META;
  requestedBy: string | null;
  approver: string | null;
  decidedAt: string | null;
  comment: string;
  createdAt: string;
  canDecide?: boolean;
}
interface ReviewView {
  id: string;
  kind: keyof typeof REVIEW_KIND_LABELS;
  trigger: keyof typeof REVIEW_TRIGGER_LABELS;
  status: keyof typeof REVIEW_STATUS_META;
  dueDate: string;
  overdue: boolean;
  reviewer: { id: string; displayName: string } | null;
  completedAt: string | null;
  outcome: string;
  notes: string;
}

const STATE_META = {
  VALIDATED: { label: 'Version courante validée', tone: 'green' },
  PENDING: { label: 'Validation en cours', tone: 'yellow' },
  REJECTED: { label: 'Validation rejetée', tone: 'red' },
  MODIFIED_SINCE_VALIDATION: { label: 'Modifié depuis la dernière validation', tone: 'orange' },
  NOT_REQUESTED: { label: 'Jamais validé', tone: 'gray' },
} as const;

function DecideButtons({ a, systemId }: { a: ApprovalView; systemId: string }) {
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') => post(`/api/v1/approvals/${a.id}/decide`, { decision, comment }),
    onSuccess: async () => {
      setRejectOpen(false);
      await qc.invalidateQueries({ queryKey: ['approvals', systemId] });
      await qc.invalidateQueries({ queryKey: ['ai-system', systemId] });
      await qc.invalidateQueries({ queryKey: ['approvals-inbox'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <span className="flex gap-1">
      <Button size="sm" disabled={mut.isPending} onClick={() => mut.mutate('APPROVED')}>
        Approuver
      </Button>
      <Button size="sm" variant="danger" onClick={() => (setError(null), setRejectOpen(true))}>
        Rejeter
      </Button>
      {error && !rejectOpen && <span className="text-xs text-tone-red-fg">{error}</span>}
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Rejeter — ${APPROVAL_DOMAIN_LABELS[a.domain]}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              disabled={comment.trim().length < 10 || mut.isPending}
              onClick={() => mut.mutate('REJECTED')}
            >
              Rejeter
            </Button>
          </>
        }
      >
        {error && <Alert tone="red">{error}</Alert>}
        <TextField label="Motif (10 caractères minimum)" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Modal>
    </span>
  );
}

function Approvals({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const q = useQuery({
    queryKey: ['approvals', systemId],
    queryFn: () =>
      get<{
        version: number;
        lockedVersion: number | null;
        validatedAt: string | null;
        state: keyof typeof STATE_META;
        items: ApprovalView[];
        canRequest: boolean;
      }>(`/api/v1/ai-systems/${systemId}/approvals`),
  });
  const [domains, setDomains] = useState<ApprovalDomain[]>(['BUSINESS', 'DPO']);
  const [approvers, setApprovers] = useState<Partial<Record<ApprovalDomain, string>>>({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: () =>
      post(`/api/v1/ai-systems/${systemId}/validation-requests`, {
        domains,
        approvers: Object.fromEntries(
          Object.entries(approvers).filter(([k, v]) => v && domains.includes(k as ApprovalDomain)),
        ),
        comment,
      }),
    onSuccess: () => (setError(null), setComment(''), void qc.invalidateQueries({ queryKey: ['approvals', systemId] })),
    onError: (e) => setError(errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  const st = STATE_META[q.data.state];
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">Circuit de validation</h2>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="mb-3 text-sm text-grey-600">
        Version courante : {q.data.version}
        {q.data.lockedVersion &&
          ` · dernière version validée : ${q.data.lockedVersion} le ${formatDate(q.data.validatedAt)}`}
        . Toute modification de la fiche crée une nouvelle version non validée ; une modification substantielle d’un SIA
        validé (finalité, modèle, données, fournisseur, autonomie, population) ouvre automatiquement une revue
        exceptionnelle.
      </p>
      {q.data.items.length === 0 ? (
        <EmptyState>Aucune demande de validation.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100 text-sm">
          {q.data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-semibold">{APPROVAL_DOMAIN_LABELS[a.domain]}</span> · version {a.entityVersion} ·
                demandé par {a.requestedBy ?? '—'} le {formatDateTime(a.createdAt)}
                {a.approver && ` · ${a.status === 'PENDING' ? 'approbateur désigné' : 'décidé par'} : ${a.approver}`}
                {a.decidedAt && ` le ${formatDateTime(a.decidedAt)}`}
                {a.comment && <p className="text-xs text-grey-600">Motif : {a.comment}</p>}
              </div>
              <span className="flex items-center gap-2">
                <Badge tone={APPROVAL_STATUS_META[a.status].tone}>{APPROVAL_STATUS_META[a.status].label}</Badge>
                {a.canDecide && a.entityVersion === q.data.version && <DecideButtons a={a} systemId={systemId} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      {q.data.canRequest && q.data.state !== 'VALIDATED' && (
        <div className="mt-4 space-y-2 rounded-xl bg-grey-50 p-3">
          <p className="text-sm font-bold">Demander la validation de la version {q.data.version}</p>
          {error && <Alert tone="red">{error}</Alert>}
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="sr-only">Domaines</legend>
            {APPROVAL_DOMAINS.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={domains.includes(d)}
                  onChange={(e) => setDomains(e.target.checked ? [...domains, d] : domains.filter((x) => x !== d))}
                />
                {APPROVAL_DOMAIN_LABELS[d]}
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {domains.map((d) => (
              <SelectField
                key={d}
                label={`Approbateur ${APPROVAL_DOMAIN_LABELS[d]} (facultatif)`}
                value={approvers[d] ?? ''}
                onChange={(e) => setApprovers({ ...approvers, [d]: e.target.value })}
              >
                <option value="">Toute personne habilitée</option>
                {users.data?.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </SelectField>
            ))}
          </div>
          <TextField label="Message (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button size="sm" disabled={!domains.length || request.isPending} onClick={() => request.mutate()}>
            Envoyer la demande
          </Button>
          <p className="text-xs text-grey-500">
            Habilitations : Métier = validateur ou référent IA ; DPO, RSSI, juridique, DSI = rôle correspondant. Le
            demandeur ne peut pas valider sa propre demande.
          </p>
        </div>
      )}
    </Card>
  );
}

function ReviewRow({
  r,
  systemId,
  canManage,
  isReviewer,
}: {
  r: ReviewView;
  systemId: string;
  canManage: boolean;
  isReviewer: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ['reviews', systemId] });
  const complete = useMutation({
    mutationFn: () => post(`/api/v1/reviews/${r.id}/complete`, { outcome }),
    onSuccess: () => (setOpen(false), done(), void qc.invalidateQueries({ queryKey: ['ai-system', systemId] })),
    onError: (e) => setError(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api('PATCH', `/api/v1/reviews/${r.id}`, { status: 'CANCELLED' }),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e)),
  });
  const openReview = r.status === 'PLANNED' || r.status === 'IN_PROGRESS';
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{REVIEW_KIND_LABELS[r.kind]}</span> — {REVIEW_TRIGGER_LABELS[r.trigger]} ·
          échéance {r.overdue ? <Badge tone="red">{formatDate(r.dueDate)} (dépassée)</Badge> : formatDate(r.dueDate)} ·
          réviseur {r.reviewer?.displayName ?? '—'}
          {r.notes && <p className="text-xs text-grey-600">{r.notes}</p>}
          {r.outcome && (
            <p className="text-xs">
              Conclusion ({formatDate(r.completedAt)}) : {r.outcome}
            </p>
          )}
        </div>
        <span className="flex items-center gap-1">
          <Badge tone={REVIEW_STATUS_META[r.status].tone}>{REVIEW_STATUS_META[r.status].label}</Badge>
          {openReview && (canManage || isReviewer) && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
              Clôturer
            </Button>
          )}
          {openReview && canManage && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>
              Annuler
            </Button>
          )}
        </span>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-grey-50 p-3">
          <TextField
            className="min-w-72 flex-1"
            label="Conclusion (10 caractères minimum)"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
          <Button
            size="sm"
            disabled={outcome.trim().length < 10 || complete.isPending}
            onClick={() => complete.mutate()}
          >
            Clôturer la revue
          </Button>
        </div>
      )}
    </li>
  );
}

function Reviews({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const q = useQuery({
    queryKey: ['reviews', systemId],
    queryFn: () =>
      get<{
        items: ReviewView[];
        nextReviewDate: string | null;
        lastReviewDate: string | null;
        intervalMonths: number;
        canManage: boolean;
        reviewerIds: string[];
      }>(`/api/v1/ai-systems/${systemId}/reviews`),
  });
  const [f, setF] = useState({ kind: 'PERIODIC', trigger: 'SCHEDULED', dueDate: '', reviewerId: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post(`/api/v1/ai-systems/${systemId}/reviews`, { ...f, reviewerId: f.reviewerId || null }),
    onSuccess: () => (setError(null), void qc.invalidateQueries({ queryKey: ['reviews', systemId] })),
    onError: (e) => setError(errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <Card>
      <h2 className="mb-1 text-lg">Revues</h2>
      <p className="mb-3 text-sm text-grey-600">
        Dernière revue : {formatDate(q.data.lastReviewDate)} · prochaine revue : {formatDate(q.data.nextReviewDate)} ·
        périodicité applicable : {q.data.intervalMonths} mois (selon la catégorie AI Act, paramétrable par
        l’administrateur). Rappels in-app à 90, 60, 30 et 7 jours.
      </p>
      {q.data.items.length === 0 ? (
        <EmptyState>Aucune revue.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100">
          {q.data.items.map((r) => (
            <ReviewRow
              key={r.id}
              r={r}
              systemId={systemId}
              canManage={q.data.canManage}
              isReviewer={q.data.reviewerIds.includes(r.id)}
            />
          ))}
        </ul>
      )}
      {q.data.canManage && (
        <div className="mt-4 rounded-xl bg-grey-50 p-3">
          <p className="mb-2 text-sm font-bold">Planifier une revue</p>
          {error && <Alert tone="red">{error}</Alert>}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <SelectField label="Type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {Object.entries(REVIEW_KIND_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Déclencheur"
              value={f.trigger}
              onChange={(e) => setF({ ...f, trigger: e.target.value })}
            >
              {REVIEW_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {REVIEW_TRIGGER_LABELS[t]}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Échéance"
              type="date"
              value={f.dueDate}
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            />
            <SelectField
              label="Réviseur"
              value={f.reviewerId}
              onChange={(e) => setF({ ...f, reviewerId: e.target.value })}
            >
              <option value="">—</option>
              {users.data?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </SelectField>
          </div>
          <Button className="mt-2" size="sm" disabled={!f.dueDate || create.isPending} onClick={() => create.mutate()}>
            Planifier
          </Button>
        </div>
      )}
    </Card>
  );
}

export function ValidationTab({ systemId }: { systemId: string }) {
  return (
    <div className="space-y-4">
      <Approvals systemId={systemId} />
      <Reviews systemId={systemId} />
    </div>
  );
}
