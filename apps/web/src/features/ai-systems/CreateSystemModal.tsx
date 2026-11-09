import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { indent, useActiveUsers, useOrgUnits } from '../../lib/queries';
import type { AiSystemDetail } from '../../lib/types';
import { Alert, Button, Modal, SelectField, TextField } from '../../components/ui';

/** Création d'une fiche vierge (statut Brouillon). Les autres modes de création arrivent en S3 / S10. */
export function CreateSystemModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const units = useOrgUnits();
  const users = useActiveUsers();
  const [name, setName] = useState('');
  const [orgUnitId, setOrgUnitId] = useState(me?.user.orgUnitId ?? '');
  const [purpose, setPurpose] = useState('');
  const [ownerId, setOwnerId] = useState(me?.user.id ?? '');
  const [businessOwnerId, setBusinessOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      post<AiSystemDetail>('/api/v1/ai-systems', {
        name,
        orgUnitId,
        purpose,
        ownerId: ownerId || null,
        businessOwnerId: businessOwnerId || null,
      }),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: ['ai-systems'] });
      onCreated(s.id);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };
  return (
    <Modal open title="Nouveau système d’IA" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="red">{error}</Alert>}
        <p className="text-sm text-grey-600">
          Fiche vierge au statut « Brouillon ». La référence (SIA-0001…) est attribuée automatiquement. Le reste de la
          fiche se complète ensuite, section par section.
        </p>
        <TextField
          label="Nom du système"
          required
          minLength={3}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <SelectField
          label="Unité organisationnelle"
          required
          value={orgUnitId}
          onChange={(e) => setOrgUnitId(e.target.value)}
        >
          <option value="">— Choisir —</option>
          {units.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {indent(u.depth)}
              {u.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Finalité" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <SelectField label="Propriétaire" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">— Aucun —</option>
          {users.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Responsable métier"
          value={businessOwnerId}
          onChange={(e) => setBusinessOwnerId(e.target.value)}
        >
          <option value="">— Aucun —</option>
          {users.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </SelectField>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={create.isPending || name.trim().length < 3 || !orgUnitId}>
            Créer la fiche
          </Button>
        </div>
      </form>
    </Modal>
  );
}
