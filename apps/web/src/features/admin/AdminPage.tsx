import clsx from 'clsx';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../../lib/auth';
import { PageHeader } from '../../components/ui';

export function AdminPage() {
  const { can } = useAuth();
  const tabs = [
    { to: 'utilisateurs', label: 'Utilisateurs', show: can('user:read') },
    { to: 'unites', label: 'Unités organisationnelles', show: true },
    { to: 'roles', label: 'Rôles et permissions', show: can('user:read') },
    { to: 'journal', label: 'Journal d’audit', show: can('audit:read') },
    { to: 'methodologie', label: 'Méthodologie de risque', show: true },
    { to: 'revues', label: 'Périodicité des revues', show: true },
    { to: 'notices', label: 'Mentions des notices', show: true },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Organisation et habilitations"
        description="Utilisateurs, unités organisationnelles, rôles et traçabilité. Les droits sont vérifiés côté serveur à chaque requête."
        actions={
          <a
            className="font-bold text-gls-blue hover:underline"
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation de l’API ↗
          </a>
        }
      />
      <nav
        aria-label="Sections d’administration"
        className="no-print mb-6 flex flex-wrap gap-2 border-b border-grey-200 pb-3"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              clsx(
                'rounded-full px-4 py-1.5 text-sm font-bold',
                isActive ? 'bg-gls-blue text-white' : 'text-gls-blue hover:bg-gls-blue-050',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
