import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RISK_CATEGORY_META, reviewIntervalsSchema, type ReviewIntervals } from '@chandelier/shared';
import { api, errorMessage, get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Button, Card, Spinner, TextField } from '../../components/ui';

const KEYS = ['HIGH', 'PROHIBITED', 'LIMITED', 'MINIMAL', 'UNDETERMINED', 'OUT_OF_SCOPE'] as const;

/** Périodicité des revues par catégorie AI Act (CDC §13 : revue annuelle par défaut, paramétrable selon le risque). */
export function ReviewSettingsPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['review-intervals'],
    queryFn: () => get<ReviewIntervals>('/api/v1/settings/review-intervals'),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, String(v)])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(
        Object.entries(draft)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => [k, Number(v)]),
      );
      const parsed = reviewIntervalsSchema.safeParse(body);
      if (!parsed.success) throw new Error('Valeurs entre 1 et 60 mois ; la valeur par défaut est obligatoire');
      return api('PUT', '/api/v1/settings/review-intervals', parsed.data);
    },
    onSuccess: () => (
      setMsg({ tone: 'green', text: 'Enregistré.' }),
      void qc.invalidateQueries({ queryKey: ['review-intervals'] })
    ),
    onError: (e) => setMsg({ tone: 'red', text: e instanceof Error && !('code' in e) ? e.message : errorMessage(e) }),
  });
  const admin = can('settings:manage');
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  return (
    <Card>
      <h2 className="mb-1 text-lg">Périodicité des revues</h2>
      <p className="mb-3 text-sm text-grey-600">
        Nombre de mois entre deux revues, selon la catégorie AI Act effective du SIA. À la clôture d’une revue, la date
        de prochaine revue est recalculée. Laisser vide pour appliquer la valeur par défaut.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TextField
          label="Par défaut (mois)"
          type="number"
          min={1}
          max={60}
          disabled={!admin}
          value={draft.default ?? ''}
          onChange={(e) => setDraft({ ...draft, default: e.target.value })}
        />
        {KEYS.map((k) => (
          <TextField
            key={k}
            label={RISK_CATEGORY_META[k].label}
            type="number"
            min={1}
            max={60}
            disabled={!admin}
            value={draft[k] ?? ''}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
          />
        ))}
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
        <p className="mt-3 text-sm text-grey-500">Seul un super administrateur peut modifier ces valeurs.</p>
      )}
    </Card>
  );
}
