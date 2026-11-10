import clsx from 'clsx';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';

interface NavItem {
  to: string;
  label: string;
  /** Permission requise pour afficher l'entrée (l'API contrôle de toute façon). */
  permission?: string;
  live: boolean;
}

export const NAV: NavItem[] = [
  { to: '/tableau-de-bord', label: 'Tableau de bord', live: false },
  { to: '/systemes', label: 'Systèmes d’IA', permission: 'aiSystem:read', live: true },
  { to: '/modeles', label: 'Modèles d’IA', permission: 'aiSystem:read', live: true },
  { to: '/evaluations', label: 'Évaluations', permission: 'aiSystem:read', live: true },
  { to: '/risques', label: 'Risques', permission: 'aiSystem:read', live: true },
  { to: '/actions', label: 'Actions', permission: 'aiSystem:read', live: true },
  { to: '/documentation', label: 'Documentation', permission: 'aiSystem:read', live: false },
  { to: '/referentiels', label: 'Référentiels', live: true },
  { to: '/rapports', label: 'Rapports', permission: 'report:read', live: false },
  { to: '/administration', label: 'Administration', permission: 'user:read', live: true },
];

export function Layout() {
  const { me, can, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_minmax(0,1fr)]">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:p-2"
      >
        Aller au contenu
      </a>
      <aside className="no-print flex flex-col bg-gls-blue text-white md:sticky md:top-0 md:h-screen">
        <div className="px-6 pt-6 pb-5">
          <img src="/brand/gls-logo-white-yellowdot.png" alt="GLS" className="h-8 w-auto" />
          <p className="mt-3 text-lg font-extrabold tracking-tight">
            Chandelier
            <span className="ml-0.5 inline-block size-2 rounded-full bg-gls-yellow" aria-hidden="true" />
          </p>
          <p className="text-xs text-white/70">Gouvernance des systèmes d’IA</p>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-0.5">
            {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center justify-between rounded-full px-4 py-2 text-[0.95rem] font-semibold transition-colors',
                      isActive ? 'bg-white text-gls-blue' : 'text-white/90 hover:bg-white/10',
                    )
                  }
                >
                  {n.label}
                  {!n.live && (
                    <span
                      className="rounded-full bg-white/15 px-2 text-[0.65rem] font-bold uppercase tracking-wide"
                      title="Fonctionnalité non implémentée"
                    >
                      à venir
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-white/15 px-6 py-4 text-sm">
          <p className="font-semibold">{me.user.displayName}</p>
          <p className="truncate text-white/70">{me.user.email}</p>
          <button
            type="button"
            className="mt-2 font-bold text-gls-yellow hover:underline"
            onClick={async () => {
              await logout();
              navigate('/connexion');
            }}
          >
            Se déconnecter
          </button>
        </div>
      </aside>
      <main id="contenu" className="mx-auto w-full min-w-0 max-w-[1200px] px-4 py-8 md:px-10">
        <Outlet />
      </main>
    </div>
  );
}
