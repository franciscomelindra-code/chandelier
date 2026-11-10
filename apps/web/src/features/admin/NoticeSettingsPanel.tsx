import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Button, Card, Spinner, TextField } from '../../components/ui';

/** Mentions reprises dans les notices générées (aucune donnée personnelle attendue : préférer une adresse générique). */
export function NoticeSettingsPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notice-settings'],
    queryFn: () => get<{ organization: string; contact: string }>('/api/v1/settings/notice'),
  });
  const [f, setF] = useState({ organization: '', contact: '' });
  const [msg, setMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  useEffect(() => {
    if (q.data) setF(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('PUT', '/api/v1/settings/notice', f),
    onSuccess: () => (
      setMsg({
        tone: 'green',
        text: 'Enregistré. Les nouvelles notices et les régénérations utiliseront ces mentions.',
      }),
      void qc.invalidateQueries({ queryKey: ['notice-settings'] })
    ),
    onError: (e) => setMsg({ tone: 'red', text: errorMessage(e) }),
  });
  const admin = can('settings:manage');
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <Card>
      <h2 className="mb-1 text-lg">Mentions des notices de transparence</h2>
      <p className="mb-3 text-sm text-grey-600">
        Reprises dans chaque notice générée. Préférez une adresse de contact générique (boîte fonctionnelle) plutôt
        qu’une adresse nominative.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextField
          label="Organisation responsable"
          disabled={!admin}
          value={f.organization}
          onChange={(e) => setF({ ...f, organization: e.target.value })}
        />
        <TextField
          label="Contact (questions, intervention humaine)"
          disabled={!admin}
          value={f.contact}
          onChange={(e) => setF({ ...f, contact: e.target.value })}
        />
      </div>
      {msg && (
        <div className="mt-3">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      {admin ? (
        <Button className="mt-3" disabled={save.isPending} onClick={() => save.mutate()}>
          Enregistrer
        </Button>
      ) : (
        <p className="mt-3 text-sm text-grey-500">Seul un super administrateur peut modifier ces mentions.</p>
      )}
    </Card>
  );
}
