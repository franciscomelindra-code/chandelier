import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_DEFINITIONS, ROLE_KEYS, type RoleKey } from '@chandelier/shared';
import { errorMessage, get, patch, post, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import type { OrgUnit, Page, User } from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Pagination,
  SelectField,
  Spinner,
  TextField,
} from '../../components/ui';

interface RoleRow {
  roleKey: RoleKey;
  orgUnitId: string | null;
  includeDescendants: boolean;
}

function useOrgUnits() {
  return useQuery({
    queryKey: ['org-units', false],
    queryFn: () => get<{ items: OrgUnit[] }>('/api/v1/org-units'),
  });
}

function RolesEditor({
  value,
  onChange,
  units,
}: {
  value: RoleRow[];
  onChange: (v: RoleRow[]) => void;
  units: OrgUnit[];
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-semibold text-grey-700">Rôles et périmètres</legend>
      {value.length === 0 && (
        <p className="text-sm text-grey-500">Aucun rôle : l’utilisateur ne pourra rien consulter.</p>
      )}
      {value.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 rounded-xl bg-grey-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <SelectField
            label="Rôle"
            value={r.roleKey}
            onChange={(e) =>
              onChange(value.map((v, j) => (j === i ? { ...v, roleKey: e.target.value as RoleKey } : v)))
            }
          >
            {ROLE_KEYS.map((k) => (
              <option key={k} value={k}>
                {ROLE_DEFINITIONS[k].label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Périmètre"
            value={r.orgUnitId ?? ''}
            onChange={(e) => onChange(value.map((v, j) => (j === i ? { ...v, orgUnitId: e.target.value || null } : v)))}
          >
            <option value="">Global (toute l’organisation)</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {'  '.repeat(u.depth)}
                {u.name}
              </option>
            ))}
          </SelectField>
          <div className="flex items-end gap-2">
            {r.orgUnitId && (
              <label className="flex items-center gap-1 pb-2 text-xs">
                <input
                  type="checkbox"
                  checked={r.includeDescendants}
                  onChange={(e) =>
                    onChange(value.map((v, j) => (j === i ? { ...v, includeDescendants: e.target.checked } : v)))
                  }
                />
                sous-unités
              </label>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Retirer le rôle ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              Retirer
            </Button>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onChange([...value, { roleKey: 'READER', orgUnitId: null, includeDescendants: true }])}
      >
        Ajouter un rôle
      </Button>
    </fieldset>
  );
}

function TemporaryPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <Modal
      open
      title="Mot de passe temporaire"
      onClose={onClose}
      footer={<Button onClick={onClose}>J’ai transmis le mot de passe</Button>}
    >
      <Alert tone="yellow" title="Affiché une seule fois">
        Transmettez-le à {email} par un canal sûr. Il devra être changé à la première connexion.
      </Alert>
      <p className="mt-4 rounded-lg bg-grey-100 p-3 font-mono text-lg break-all select-all">{password}</p>
    </Modal>
  );
}

function UserForm({
  user,
  units,
  onDone,
}: {
  user: User | null;
  units: OrgUnit[];
  onDone: (pw?: { email: string; password: string }) => void;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [orgUnitId, setOrgUnitId] = useState(user?.orgUnitId ?? '');
  const [authProvider, setAuthProvider] = useState<'LOCAL' | 'OIDC'>('LOCAL');
  const [roles, setRoles] = useState<RoleRow[]>(
    user?.roles?.map((r) => ({
      roleKey: r.roleKey as RoleKey,
      orgUnitId: r.orgUnitId,
      includeDescendants: r.includeDescendants,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (user) {
        await patch(`/api/v1/users/${user.id}`, { displayName, orgUnitId: orgUnitId || null, roles });
        return undefined;
      }
      const res = await post<{ user: User; temporaryPassword: string | null }>('/api/v1/users', {
        email,
        displayName,
        authProvider,
        orgUnitId: orgUnitId || null,
        roles,
      });
      return res.temporaryPassword ? { email: res.user.email, password: res.temporaryPassword } : undefined;
    },
    onSuccess: async (pw) => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      onDone(pw);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };
  return (
    <form id="user-form" onSubmit={submit} className="space-y-4">
      {error && <Alert tone="red">{error}</Alert>}
      <TextField
        label="Adresse e-mail"
        type="email"
        required
        disabled={!!user}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField label="Nom affiché" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      {!user && (
        <SelectField
          label="Mode de connexion"
          value={authProvider}
          onChange={(e) => setAuthProvider(e.target.value as 'LOCAL' | 'OIDC')}
          hint={
            authProvider === 'OIDC'
              ? 'Connexion par Microsoft Entra ID uniquement (adresse identique à celle du compte Entra), sans mot de passe.'
              : 'Mot de passe temporaire affiché une seule fois, à changer à la première connexion.'
          }
        >
          <option value="LOCAL">Compte local</option>
          <option value="OIDC">Microsoft Entra ID (SSO)</option>
        </SelectField>
      )}
      <SelectField label="Unité de rattachement" value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
        <option value="">— Aucune —</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {'  '.repeat(u.depth)}
            {u.name}
          </option>
        ))}
      </SelectField>
      <RolesEditor value={roles} onChange={setRoles} units={units} />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={() => onDone()}>
          Annuler
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {user ? 'Enregistrer' : 'Créer l’utilisateur'}
        </Button>
      </div>
    </form>
  );
}

export function UsersPanel() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const manage = can('user:manage');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [tempPw, setTempPw] = useState<{ email: string; password: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const units = useOrgUnits();
  const users = useQuery({
    queryKey: ['users', q, page, includeInactive],
    queryFn: () => get<Page<User>>(`/api/v1/users${qs({ q, page, pageSize: 20, includeInactive })}`),
    placeholderData: keepPreviousData,
  });

  const toggleActive = useMutation({
    mutationFn: (u: User) => patch(`/api/v1/users/${u.id}`, { isActive: !u.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => setActionError(errorMessage(e)),
  });
  const resetPw = useMutation({
    mutationFn: (u: User) =>
      post<{ temporaryPassword: string }>(`/api/v1/users/${u.id}/reset-password`).then((r) => ({
        email: u.email,
        password: r.temporaryPassword,
      })),
    onSuccess: (r) => setTempPw(r),
    onError: (e) => setActionError(errorMessage(e)),
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Rechercher"
            placeholder="Nom ou e-mail"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Inclure les comptes désactivés
          </label>
        </div>
        {manage && <Button onClick={() => setEditing('new')}>Nouvel utilisateur</Button>}
      </div>
      {actionError && (
        <div className="mb-3">
          <Alert tone="red">{actionError}</Alert>
        </div>
      )}
      {users.isPending ? (
        <Spinner />
      ) : users.isError ? (
        <Alert tone="red">{errorMessage(users.error)}</Alert>
      ) : users.data.items.length === 0 ? (
        <EmptyState>Aucun utilisateur ne correspond.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Utilisateurs</caption>
            <thead className="border-b border-grey-200 text-xs uppercase tracking-wide text-grey-500">
              <tr>
                <th scope="col" className="py-2 pr-3">
                  Utilisateur
                </th>
                <th scope="col" className="py-2 pr-3">
                  Unité
                </th>
                {manage && (
                  <th scope="col" className="py-2 pr-3">
                    Rôles
                  </th>
                )}
                <th scope="col" className="py-2 pr-3">
                  État
                </th>
                <th scope="col" className="py-2 pr-3">
                  Dernière connexion
                </th>
                {manage && (
                  <th scope="col" className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((u) => (
                <tr key={u.id} className="border-b border-grey-100 align-top">
                  <td className="py-3 pr-3">
                    <p className="font-semibold">{u.displayName}</p>
                    <p className="text-grey-500">{u.email}</p>
                  </td>
                  <td className="py-3 pr-3">{u.orgUnitName ?? <span className="text-grey-400">—</span>}</td>
                  {manage && (
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles?.length ? (
                          u.roles.map((r, i) => (
                            <Badge key={i} tone="blue">
                              {r.roleLabel}
                              {r.orgUnitName ? ` · ${r.orgUnitName}` : ''}
                            </Badge>
                          ))
                        ) : (
                          <Badge tone="gray">Aucun rôle</Badge>
                        )}
                      </div>
                    </td>
                  )}
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {u.isActive ? <Badge tone="green">Actif</Badge> : <Badge tone="gray">Désactivé</Badge>}
                      {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="orange">Verrouillé</Badge>}
                      {u.mustChangePassword && <Badge tone="yellow">Mot de passe temporaire</Badge>}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-grey-600">{formatDateTime(u.lastLoginAt)}</td>
                  {manage && (
                    <td className="py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                          Modifier
                        </Button>
                        {u.authProvider === 'LOCAL' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Réinitialiser le mot de passe de ${u.email} ? Ses sessions seront fermées.`))
                                resetPw.mutate(u);
                            }}
                          >
                            Réinitialiser
                          </Button>
                        )}
                        {u.id !== me?.user.id && (
                          <Button
                            size="sm"
                            variant={u.isActive ? 'danger' : 'secondary'}
                            onClick={() => {
                              if (!u.isActive || confirm(`Désactiver ${u.email} ? Ses sessions seront fermées.`))
                                toggleActive.mutate(u);
                            }}
                          >
                            {u.isActive ? 'Désactiver' : 'Réactiver'}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={users.data.pageSize} total={users.data.total} onPage={setPage} />
        </div>
      )}
      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Nouvel utilisateur' : 'Modifier l’utilisateur'}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <UserForm
            key={editing === 'new' ? 'new' : editing.id}
            user={editing === 'new' ? null : editing}
            units={units.data?.items ?? []}
            onDone={(pw) => {
              setEditing(null);
              if (pw) setTempPw(pw);
            }}
          />
        )}
      </Modal>
      {tempPw && <TemporaryPassword email={tempPw.email} password={tempPw.password} onClose={() => setTempPw(null)} />}
    </Card>
  );
}
