import { useId, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../../../lib/api';
import type { AiSystemDetail } from '../../../lib/types';
import { Alert, Badge, Button, Card, SelectField, TextField } from '../../../components/ui';

/** Met à jour le cache après toute écriture sur la fiche (contenu, historique, liste). */
export function useSystemCache(id: string) {
  const qc = useQueryClient();
  return (next: AiSystemDetail) => {
    qc.setQueryData(['ai-system', id], next);
    void qc.invalidateQueries({ queryKey: ['ai-system-history', id] });
    void qc.invalidateQueries({ queryKey: ['ai-systems'] });
    void qc.invalidateQueries({ queryKey: ['catalog'] });
  };
}

/** Appel d'une route de section (liens) : renvoie la fiche à jour. */
export function useSectionMutation<V>(id: string, fn: (v: V) => Promise<AiSystemDetail>) {
  const update = useSystemCache(id);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      setError(null);
      update(d);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return { ...m, error, clearError: () => setError(null) };
}

export const sectionCall = (id: string, method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', path: string, body?: unknown) =>
  api<AiSystemDetail>(method, `/api/v1/ai-systems/${id}/${path}`, body);

type Values = Record<string, unknown>;

/**
 * Formulaire d'une étape : brouillon local, enregistrement de la seule étape (champs modifiés),
 * verrou optimiste, signalement des conflits.
 */
export function useStepForm(s: AiSystemDetail, keys: readonly string[], initial: (s: AiSystemDetail) => Values) {
  const update = useSystemCache(s.id);
  const base = useMemo(() => initial(s), [s, initial]);
  const [draft, setDraft] = useState<Values | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const values = draft ?? base;
  const changed = useMemo(
    () =>
      Object.fromEntries(
        keys.filter((k) => JSON.stringify(values[k]) !== JSON.stringify(base[k])).map((k) => [k, values[k]]),
      ),
    [values, base, keys],
  );
  const dirty = Object.keys(changed).length > 0;
  const save = useMutation({
    mutationFn: () => api<AiSystemDetail>('PATCH', `/api/v1/ai-systems/${s.id}`, { version: s.version, ...changed }),
    onSuccess: (d) => {
      update(d);
      setDraft(null);
      setError(null);
      setSaved(true);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setConflict(true);
      setError(errorMessage(e));
    },
  });
  return {
    values,
    get: (k: string) => values[k],
    set: (k: string, v: unknown) => {
      setSaved(false);
      setDraft({ ...values, [k]: v });
    },
    dirty,
    changedCount: Object.keys(changed).length,
    save: () => save.mutate(),
    saving: save.isPending,
    reset: () => {
      setDraft(null);
      setError(null);
      setConflict(false);
    },
    error,
    conflict,
    saved,
  };
}
export type StepForm = ReturnType<typeof useStepForm>;

export function SaveBar({ form, onReload }: { form: StepForm; onReload: () => void }) {
  if (!form.dirty && !form.error && !form.saved) return null;
  return (
    <div className="no-print sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-grey-200 bg-white px-4 py-3 shadow-pop">
      {form.error && (
        <span className="text-sm text-tone-red-fg" role="alert">
          {form.error}
        </span>
      )}
      {form.saved && !form.dirty && (
        <span className="text-sm text-tone-green-fg" role="status">
          Étape enregistrée.
        </span>
      )}
      {form.dirty && (
        <span className="text-sm text-grey-600">{form.changedCount} champ(s) modifié(s) dans cette étape</span>
      )}
      <div className="ml-auto flex gap-2">
        {form.conflict && (
          <Button
            variant="secondary"
            onClick={() => {
              form.reset();
              onReload();
            }}
          >
            Recharger (abandonner mes saisies)
          </Button>
        )}
        {form.dirty && (
          <Button variant="ghost" onClick={form.reset}>
            Annuler
          </Button>
        )}
        {form.dirty && (
          <Button disabled={form.saving} onClick={form.save}>
            Enregistrer l’étape
          </Button>
        )}
      </div>
    </div>
  );
}

export function StepCard({
  title,
  editable,
  children,
  intro,
}: {
  title: string;
  editable: boolean;
  children: ReactNode;
  intro?: ReactNode;
}) {
  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg">{title}</h2>
        {!editable && <Badge tone="gray">Lecture seule</Badge>}
      </div>
      {intro && <div className="mb-4 text-sm text-grey-600">{intro}</div>}
      {children}
    </Card>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  disabled,
  hint,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-grey-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-grey-300 bg-white px-3 py-2 text-ink disabled:bg-grey-50 disabled:text-grey-600"
      />
      {hint && <p className="mt-1 text-xs text-grey-500">{hint}</p>}
    </div>
  );
}

export const TRI_OPTIONS = [
  ['UNKNOWN', 'Non renseigné'],
  ['YES', 'Oui'],
  ['NO', 'Non'],
] as const;
export const triLabel = (v: string) => TRI_OPTIONS.find(([k]) => k === v)?.[1] ?? v;

export function TriSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <SelectField label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {TRI_OPTIONS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </SelectField>
  );
}

export function DateInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <TextField
      label={label}
      type="date"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div className="mb-3">
      <Alert tone="red">{error}</Alert>
    </div>
  ) : null;
}
