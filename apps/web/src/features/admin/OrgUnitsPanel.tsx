import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORG_UNIT_TYPES, ORG_UNIT_TYPE_LABELS, type OrgUnitType } from '@chandelier/shared';
import { errorMessage, get, patch, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { OrgUnit } from '../../lib/types';
import { Alert, Badge, Button, Card, EmptyState, Modal, SelectField, Spinner, TextField } from '../../components/ui';

function UnitForm({ unit, units, onDone }: { unit: OrgUnit | null; units: OrgUnit[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(unit?.code ?? '');
  const [name, setName] = useState(unit?.name ?? '');
  const [type, setType] = useState<OrgUnitType>((unit?.type as OrgUnitType) ?? 'DIRECTION');
  const [parentId, setParentId] = useState(unit?.parentId ?? '');
  const [error, setError] = useState<string | null>(null);
  // Une unité ne peut pas être déplacée sous elle-même ou ses descendants.
  const candidates = units.filter((u) => !unit || !u.path.startsWith(unit.path));
  const save = useMutation({
    mutationFn: () =>
      unit
        ? patch(`/api/v1/org-units/${unit.id}`, { name, type, parentId: parentId || null })
        : post('/api/v1/org-units', { code, name, type, parentId: parentId || null }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['org-units'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="red">{error}</Alert>}
      <TextField
        label="Code"
        required
        disabled={!!unit}
        hint="Identifiant stable : majuscules, chiffres, - et _"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <TextField label="Nom" required value={name} onChange={(e) => setName(e.target.value)} />
      <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as OrgUnitType)}>
        {ORG_UNIT_TYPES.map((t) => (
          <option key={t} value={t}>
            {ORG_UNIT_TYPE_LABELS[t]}
          </option>
        ))}
      </SelectField>
      <SelectField label="Unité parente" value={parentId} onChange={(e) => setParentId(e.target.value)}>
        <option value="">— Racine —</option>
        {candidates.map((u) => (
          <option key={u.id} value={u.id}>
            {'  '.repeat(u.depth)}
            {u.name}
          </option>
        ))}
      </SelectField>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" disabled={save.isPending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function OrgUnitsPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('orgUnit:manage');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<OrgUnit | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const units = useQuery({
    queryKey: ['org-units', includeInactive],
    queryFn: () => get<{ items: OrgUnit[] }>(`/api/v1/org-units${includeInactive ? '?includeInactive=true' : ''}`),
  });
  const toggle = useMutation({
    mutationFn: (u: OrgUnit) => patch(`/api/v1/org-units/${u.id}`, { isActive: !u.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-units'] }),
    onError: (e) => setActionError(errorMessage(e)),
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Inclure les unités désactivées
        </label>
        {manage && <Button onClick={() => setEditing('new')}>Nouvelle unité</Button>}
      </div>
      {actionError && (
        <div className="mb-3">
          <Alert tone="red">{actionError}</Alert>
        </div>
      )}
      {units.isPending ? (
        <Spinner />
      ) : units.isError ? (
        <Alert tone="red">{errorMessage(units.error)}</Alert>
      ) : units.data.items.length === 0 ? (
        <EmptyState>Aucune unité organisationnelle. {manage ? 'Créez la première unité racine.' : ''}</EmptyState>
      ) : (
        <ul className="divide-y divide-grey-100" aria-label="Arborescence des unités">
          {units.data.items.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="flex items-center gap-2" style={{ paddingLeft: `${u.depth * 1.5}rem` }}>
                {u.depth > 0 && (
                  <span aria-hidden="true" className="text-grey-300">
                    └
                  </span>
                )}
                <span className="font-semibold">{u.name}</span>
                <span className="font-mono text-xs text-grey-500">{u.code}</span>
                <Badge tone="blue">{ORG_UNIT_TYPE_LABELS[u.type as OrgUnitType] ?? u.type}</Badge>
                {u.isDemo && <Badge tone="yellow">DEMO</Badge>}
                {!u.isActive && <Badge tone="gray">Désactivée</Badge>}
              </div>
              <div className="flex items-center gap-3 text-xs text-grey-500">
                <span>
                  {u.userCount} utilisateur{u.userCount > 1 ? 's' : ''} · {u.aiSystemCount} SIA
                </span>
                {manage && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Modifier
                    </Button>
                    <Button
                      size="sm"
                      variant={u.isActive ? 'danger' : 'secondary'}
                      onClick={() => {
                        if (
                          !u.isActive ||
                          confirm(
                            `Désactiver « ${u.name} » ? Les habilitations portant sur cette unité seront suspendues.`,
                          )
                        )
                          toggle.mutate(u);
                      }}
                    >
                      {u.isActive ? 'Désactiver' : 'Réactiver'}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Nouvelle unité' : 'Modifier l’unité'}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <UnitForm
            key={editing === 'new' ? 'new' : editing.id}
            unit={editing === 'new' ? null : editing}
            units={units.data?.items ?? []}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </Card>
  );
}
