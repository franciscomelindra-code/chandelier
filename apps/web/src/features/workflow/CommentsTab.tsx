import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SECTION_LABELS, SECTION_ORDER, type SectionKey } from '@chandelier/shared';
import { errorMessage, get, post } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useActiveUsers } from '../../lib/queries';
import { Alert, Badge, Button, Card, EmptyState, SelectField, Spinner } from '../../components/ui';

interface CommentView {
  id: string;
  section: string | null;
  body: string;
  author: string;
  mentions: { id: string; displayName: string }[];
  resolvedAt: string | null;
  createdAt: string;
}

export function CommentsTab({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const q = useQuery({
    queryKey: ['comments', systemId],
    queryFn: () => get<{ items: CommentView[]; canWrite: boolean }>(`/api/v1/ai-systems/${systemId}/comments`),
  });
  const [body, setBody] = useState('');
  const [section, setSection] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['comments', systemId] });
  const create = useMutation({
    mutationFn: () => post(`/api/v1/ai-systems/${systemId}/comments`, { body, section: section || null, mentions }),
    onSuccess: () => (setBody(''), setMentions([]), setError(null), refresh()),
    onError: (e) => setError(errorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => post(`/api/v1/comments/${id}/resolve`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <Card>
      <h2 className="mb-1 text-lg">Commentaires internes</h2>
      <p className="mb-3 text-sm text-grey-600">
        Échanges internes sur la fiche. Les personnes mentionnées sont notifiées (uniquement si elles ont accès à ce
        SIA). Les commentaires sont conservés et journalisés ; ils ne sont pas modifiables.
      </p>
      {q.data.items.length === 0 ? (
        <EmptyState>Aucun commentaire.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {q.data.items.map((c) => (
            <li
              key={c.id}
              className={`rounded-xl border p-3 ${c.resolvedAt ? 'border-grey-100 bg-grey-50' : 'border-grey-200'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-grey-600">
                <span>
                  <span className="font-bold text-ink">{c.author}</span> · {formatDateTime(c.createdAt)}
                  {c.section && ` · étape « ${SECTION_LABELS[c.section as SectionKey] ?? c.section} »`}
                </span>
                {c.resolvedAt ? (
                  <Badge tone="green">Traité</Badge>
                ) : (
                  q.data.canWrite && (
                    <Button size="sm" variant="ghost" onClick={() => resolve.mutate(c.id)}>
                      Marquer comme traité
                    </Button>
                  )
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{c.body}</p>
              {c.mentions.length > 0 && (
                <p className="mt-1 text-xs text-gls-blue">
                  Mentions : {c.mentions.map((m) => `@${m.displayName}`).join(', ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {q.data.canWrite ? (
        <div className="mt-4 space-y-2 rounded-xl bg-grey-50 p-3">
          {error && <Alert tone="red">{error}</Alert>}
          <label htmlFor="comment-body" className="block text-sm font-semibold text-grey-700">
            Nouveau commentaire
          </label>
          <textarea
            id="comment-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg border border-grey-300 bg-white px-3 py-2"
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <SelectField label="Étape concernée" value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">Fiche entière</option>
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABELS[s]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Mentionner"
              value=""
              onChange={(e) =>
                e.target.value && !mentions.includes(e.target.value) && setMentions([...mentions, e.target.value])
              }
            >
              <option value="">Ajouter une personne…</option>
              {users.data?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </SelectField>
          </div>
          {mentions.length > 0 && (
            <p className="flex flex-wrap gap-1 text-xs">
              {mentions.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="rounded-full bg-gls-blue-050 px-2 py-0.5 text-gls-blue"
                  onClick={() => setMentions(mentions.filter((x) => x !== m))}
                  aria-label={`Retirer la mention de ${users.data?.items.find((u) => u.id === m)?.displayName ?? m}`}
                >
                  @{users.data?.items.find((u) => u.id === m)?.displayName ?? m} ×
                </button>
              ))}
            </p>
          )}
          <Button size="sm" disabled={!body.trim() || create.isPending} onClick={() => create.mutate()}>
            Publier
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-grey-500">Lecture seule : votre rôle ne permet pas de commenter.</p>
      )}
    </Card>
  );
}
