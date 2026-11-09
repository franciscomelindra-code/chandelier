import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@chandelier/shared';
import { errorMessage, get } from '../../lib/api';
import type { Role } from '../../lib/types';
import { Alert, Card, Spinner } from '../../components/ui';

function cell(role: Role, permission: string): string {
  if (role.permissions.includes(permission)) return '✓';
  if (role.permissions.includes(`${permission}:own`)) return 'propres';
  if (role.permissions.includes(`${permission}:assigned`)) return 'affectées';
  return '';
}

export function RolesPanel() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<{ items: Role[] }>('/api/v1/roles') });
  if (roles.isPending) return <Spinner />;
  if (roles.isError) return <Alert tone="red">{errorMessage(roles.error)}</Alert>;
  const items = roles.data.items;
  return (
    <Card>
      <p className="mb-4 text-sm text-grey-600">
        Matrice lue depuis la base. « propres » : uniquement les SIA dont l’utilisateur est propriétaire ; « affectées »
        : uniquement les sections qui lui sont affectées. Chaque droit s’exerce dans le périmètre (global ou unité) de
        l’affectation.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-center text-xs">
          <caption className="sr-only">Permissions par rôle</caption>
          <thead>
            <tr className="border-b border-grey-200">
              <th scope="col" className="sticky left-0 bg-white py-2 pr-3 text-left">
                Permission
              </th>
              {items.map((r) => (
                <th
                  key={r.key}
                  scope="col"
                  className="px-1.5 py-2 align-bottom font-bold text-gls-blue"
                  title={r.description}
                >
                  {r.label}
                  <span className="block font-normal text-grey-500">{r.assignmentCount} aff.</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p} className="border-b border-grey-100">
                <th scope="row" className="sticky left-0 bg-white py-1.5 pr-3 text-left font-mono font-normal">
                  {p}
                </th>
                {items.map((r) => {
                  const v = cell(r, p);
                  return (
                    <td key={r.key} className={v === '✓' ? 'font-bold text-tone-green-fg' : 'text-tone-yellow-fg'}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
