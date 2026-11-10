import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PRIORITIES, PRIORITY_LABELS } from '@chandelier/shared';
import { errorMessage, post } from '../../lib/api';
import { useActiveUsers } from '../../lib/queries';
import { Alert, Button, Modal, SelectField, TextField } from '../../components/ui';
import type { ActionView } from '../risks/types';

export interface ActionLinkOption {
  id: string;
  label: string;
}

/** Création d'une action rattachée à un SIA (et éventuellement à un risque, une obligation, une mesure). */
export function NewActionModal({
  open,
  onClose,
  aiSystemId,
  preset = {},
  risks = [],
  obligations = [],
  measures = [],
}: {
  open: boolean;
  onClose: () => void;
  aiSystemId: string;
  preset?: { riskId?: string; obligationId?: string; measureId?: string; title?: string };
  risks?: ActionLinkOption[];
  obligations?: ActionLinkOption[];
  measures?: ActionLinkOption[];
}) {
  const qc = useQueryClient();
  const users = useActiveUsers();
  const [f, setF] = useState({
    title: preset.title ?? '',
    description: '',
    priority: 'MEDIUM',
    assigneeId: '',
    dueDate: '',
    riskId: preset.riskId ?? '',
    obligationId: preset.obligationId ?? '',
    measureId: preset.measureId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      post<ActionView>('/api/v1/actions', {
        aiSystemId,
        title: f.title,
        description: f.description,
        priority: f.priority,
        assigneeId: f.assigneeId || null,
        dueDate: f.dueDate || null,
        riskId: f.riskId || null,
        obligationId: f.obligationId || null,
        measureId: f.measureId || null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['actions'] });
      await qc.invalidateQueries({ queryKey: ['risk'] });
      await qc.invalidateQueries({ queryKey: ['risks'] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const linkSelect = (label: string, k: 'riskId' | 'obligationId' | 'measureId', options: ActionLinkOption[]) =>
    options.length > 0 || f[k] ? (
      <SelectField label={label} value={f[k]} onChange={set(k)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </SelectField>
    ) : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle action"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={create.isPending || f.title.trim().length < 3} onClick={() => create.mutate()}>
            Créer l’action
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {error && (
          <div className="md:col-span-2">
            <Alert tone="red">{error}</Alert>
          </div>
        )}
        <TextField className="md:col-span-2" label="Intitulé" required value={f.title} onChange={set('title')} />
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-semibold text-grey-700" htmlFor="action-desc">
            Description
          </label>
          <textarea
            id="action-desc"
            rows={3}
            className="w-full rounded-lg border border-grey-300 px-3 py-2"
            value={f.description}
            onChange={set('description')}
          />
        </div>
        <SelectField label="Priorité" value={f.priority} onChange={set('priority')}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </SelectField>
        <TextField label="Échéance" type="date" value={f.dueDate} onChange={set('dueDate')} />
        <SelectField className="md:col-span-2" label="Responsable" value={f.assigneeId} onChange={set('assigneeId')}>
          <option value="">—</option>
          {users.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </SelectField>
        {linkSelect('Risque lié', 'riskId', risks)}
        {linkSelect('Obligation liée', 'obligationId', obligations)}
        {linkSelect('Mesure liée', 'measureId', measures)}
      </div>
    </Modal>
  );
}
