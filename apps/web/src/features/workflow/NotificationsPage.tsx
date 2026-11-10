import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPROVAL_DOMAIN_LABELS, type ApprovalDomain } from '@chandelier/shared';
import { errorMessage, get, post } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';

interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

/** Compteur de notifications non lues (rafraîchi toutes les 60 s). */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => get<{ unread: number }>('/api/v1/notifications?unread=true'),
    refetchInterval: 60_000,
    select: (d) => d.unread,
  });
}

const TYPE_LABEL: Record<string, string> = {
  mention: 'Mention',
  approval: 'Validation',
  review: 'Revue',
  reminder: 'Rappel',
  action: 'Action',
};

function ApprovalsInbox() {
  const q = useQuery({
    queryKey: ['approvals-inbox'],
    queryFn: () =>
      get<{
        items: {
          id: string;
          domain: ApprovalDomain;
          entityVersion: number;
          requestedBy: string | null;
          createdAt: string;
          stale: boolean;
          aiSystem: { id: string; reference: string; name: string; isDemo: boolean };
        }[];
      }>('/api/v1/approvals'),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <Card>
      <h2 className="mb-2 text-lg">Validations qui m’attendent ({q.data.items.length})</h2>
      {q.data.items.length === 0 ? (
        <EmptyState>Aucune validation en attente pour vous.</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100 text-sm">
          {q.data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Link
                  to={`/systemes/${a.aiSystem.id}?onglet=validation`}
                  className="font-semibold text-gls-blue hover:underline"
                >
                  {a.aiSystem.reference} — {a.aiSystem.name}
                </Link>{' '}
                · {APPROVAL_DOMAIN_LABELS[a.domain]} · version {a.entityVersion} · demandé par {a.requestedBy ?? '—'} le{' '}
                {formatDateTime(a.createdAt)}
              </span>
              {a.stale && <Badge tone="orange">Fiche modifiée depuis la demande</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: () => get<{ unread: number; items: NotificationView[] }>('/api/v1/notifications'),
  });
  const read = useMutation({
    mutationFn: (ids?: string[]) => post('/api/v1/notifications/read', ids ? { ids } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <>
      <PageHeader
        eyebrow="Collaboration"
        title="Notifications"
        description="Mentions, demandes de validation, revues et rappels d’échéance (90, 60, 30 et 7 jours). Notifications internes à l’application uniquement."
        actions={
          q.data && q.data.unread > 0 ? (
            <Button variant="secondary" onClick={() => read.mutate(undefined)}>
              Tout marquer comme lu
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4">
        <ApprovalsInbox />
        <Card>
          <h2 className="mb-2 text-lg">Notifications</h2>
          {q.isPending ? (
            <Spinner />
          ) : q.isError ? (
            <Alert tone="red">{errorMessage(q.error)}</Alert>
          ) : q.data.items.length === 0 ? (
            <EmptyState>Aucune notification.</EmptyState>
          ) : (
            <ul className="divide-y divide-grey-100">
              {q.data.items.map((n) => (
                <li
                  key={n.id}
                  className={`flex flex-wrap items-start justify-between gap-2 py-2 ${n.readAt ? 'opacity-70' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      <Badge tone={n.readAt ? 'gray' : 'blue'}>{TYPE_LABEL[n.type] ?? n.type}</Badge>{' '}
                      {n.link ? (
                        <Link
                          to={n.link}
                          className="font-semibold text-gls-blue hover:underline"
                          onClick={() => !n.readAt && read.mutate([n.id])}
                        >
                          {n.title}
                        </Link>
                      ) : (
                        <span className="font-semibold">{n.title}</span>
                      )}
                    </p>
                    {n.body && <p className="text-xs text-grey-600">{n.body}</p>}
                    <p className="text-xs text-grey-500">{formatDateTime(n.createdAt)}</p>
                  </div>
                  {!n.readAt && (
                    <Button size="sm" variant="ghost" onClick={() => read.mutate([n.id])}>
                      Marquer comme lu
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
