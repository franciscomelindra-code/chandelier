import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RISK_TYPE_LABELS, type RiskType } from '@chandelier/shared';
import { api, errorMessage, get, post } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { AiSystemDetail } from '../../lib/types';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';

interface Suggestion {
  id: string;
  field: string;
  fieldLabel: string;
  proposedValue: unknown;
  sources: { excerpt?: string; field?: string }[];
  uncertainty: string;
  status: 'TO_VERIFY' | 'ACCEPTED' | 'REJECTED';
  provider: string;
  model: string;
  createdAt: string;
  decidedBy: string | null;
}

const STATUS = {
  TO_VERIFY: { label: 'À vérifier', tone: 'yellow' },
  ACCEPTED: { label: 'Acceptée', tone: 'green' },
  REJECTED: { label: 'Rejetée', tone: 'gray' },
} as const;

/**
 * Assistant IA : propositions toujours « À vérifier », jamais appliquées sans action humaine.
 * mode « extract » (étape 1 : champs depuis un texte fourni) ou « risks » (onglet Risques).
 */
export function AssistantPanel({ s, mode }: { s: AiSystemDetail; mode: 'extract' | 'risks' }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => get<{ enabled: boolean; provider: string; model: string }>('/api/v1/assistant/status'),
    staleTime: 300_000,
  });
  const list = useQuery({
    queryKey: ['assistant', s.id],
    queryFn: () => get<{ items: Suggestion[] }>(`/api/v1/ai-systems/${s.id}/assistant/suggestions`),
    enabled: !!status.data?.enabled,
  });
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    setError(null);
    await qc.invalidateQueries({ queryKey: ['assistant', s.id] });
  };
  const run = useMutation({
    mutationFn: () =>
      mode === 'extract'
        ? post(`/api/v1/ai-systems/${s.id}/assistant/extract`, { text })
        : post(`/api/v1/ai-systems/${s.id}/assistant/risks`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const decide = useMutation({
    mutationFn: async ({ sug, decision }: { sug: Suggestion; decision: 'ACCEPTED' | 'REJECTED' }) => {
      // Valeur de champ : appliquée par l'utilisateur via la mise à jour normale de la fiche (droits, version, journal).
      if (decision === 'ACCEPTED' && sug.field !== 'risk') {
        const fresh = await get<AiSystemDetail>(`/api/v1/ai-systems/${s.id}`);
        await api('PATCH', `/api/v1/ai-systems/${s.id}`, { version: fresh.version, [sug.field]: sug.proposedValue });
      }
      return post(`/api/v1/assistant/suggestions/${sug.id}/decide`, { decision });
    },
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ['ai-system', s.id] });
      await qc.invalidateQueries({ queryKey: ['risks'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (status.isPending) return null;
  if (!status.data?.enabled)
    return (
      <Card>
        <h3 className="text-base">Assistant IA</h3>
        <p className="text-sm text-grey-600">
          Assistant IA désactivé sur cette instance (aucune donnée n’est transmise à un fournisseur d’IA).
        </p>
      </Card>
    );
  const items = (list.data?.items ?? []).filter((i) => (mode === 'risks' ? i.field === 'risk' : i.field !== 'risk'));
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base">
          Assistant IA — {mode === 'extract' ? 'préremplissage depuis un document' : 'propositions de risques'}
        </h3>
        <span className="text-xs text-grey-500">
          {status.data.provider} · {status.data.model}
        </span>
      </div>
      <Alert tone="yellow" title="À relire avant toute utilisation">
        {mode === 'extract'
          ? 'Le texte collé ci-dessous est transmis au fournisseur d’IA configuré. N’y mettez ni données personnelles, ni secrets, ni données sensibles.'
          : 'Seuls les champs descriptifs de la fiche (sans noms de personnes) sont transmis au fournisseur d’IA configuré.'}{' '}
        Chaque proposition reste « À vérifier » ; rien n’est appliqué sans votre décision.
      </Alert>
      {error && <Alert tone="red">{error}</Alert>}
      {mode === 'extract' && (
        <div className="mt-3">
          <label htmlFor={`assistant-text-${s.id}`} className="mb-1 block text-sm font-semibold text-grey-700">
            Texte source (documentation, présentation fournisseur — 50 à 20 000 caractères)
          </label>
          <textarea
            id={`assistant-text-${s.id}`}
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-grey-300 px-3 py-2 text-sm"
          />
        </div>
      )}
      <Button
        className="mt-2"
        size="sm"
        variant="secondary"
        disabled={run.isPending || (mode === 'extract' && text.trim().length < 50)}
        onClick={() => run.mutate()}
      >
        {run.isPending ? 'Analyse…' : mode === 'extract' ? 'Proposer des valeurs' : 'Proposer des risques'}
      </Button>
      {list.isPending ? (
        <Spinner />
      ) : (
        items.length > 0 && (
          <ul className="mt-3 divide-y divide-grey-100">
            {items.map((sug) => {
              const v = sug.proposedValue as
                { category?: RiskType; title?: string; scenario?: string; consequence?: string } | string;
              return (
                <li key={sug.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {sug.field === 'risk' && typeof v === 'object'
                        ? `${RISK_TYPE_LABELS[v.category!]} — ${v.title}`
                        : sug.fieldLabel}{' '}
                      <Badge tone={STATUS[sug.status].tone}>{STATUS[sug.status].label}</Badge>
                    </span>
                    {sug.status === 'TO_VERIFY' && (
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ sug, decision: 'ACCEPTED' })}
                        >
                          {sug.field === 'risk' ? 'Créer le risque' : 'Appliquer à la fiche'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ sug, decision: 'REJECTED' })}
                        >
                          Rejeter
                        </Button>
                      </span>
                    )}
                  </div>
                  {typeof v === 'string' ? (
                    <p className="mt-1 whitespace-pre-line">{v}</p>
                  ) : (
                    <p className="mt-1">
                      {v.scenario}{' '}
                      {v.consequence && <span className="text-grey-600">Conséquence : {v.consequence}</span>}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-grey-500">
                    Sources : {sug.sources.map((x) => (x.excerpt ? `« ${x.excerpt} »` : x.field)).join(' ; ') || '—'} ·
                    Incertitude : {sug.uncertainty || '—'} · {formatDateTime(sug.createdAt)}
                    {sug.decidedBy && ` · décidé par ${sug.decidedBy}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )
      )}
    </Card>
  );
}
