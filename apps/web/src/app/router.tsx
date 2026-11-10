import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';
import { NotImplemented } from '../components/NotImplemented';
import { Layout } from './Layout';
import { LoginPage } from '../features/auth/LoginPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { AdminPage } from '../features/admin/AdminPage';
import { UsersPanel } from '../features/admin/UsersPanel';
import { OrgUnitsPanel } from '../features/admin/OrgUnitsPanel';
import { RolesPanel } from '../features/admin/RolesPanel';
import { AuditPanel } from '../features/admin/AuditPanel';
import { RegistryPage } from '../features/ai-systems/RegistryPage';
import { SystemPage } from '../features/ai-systems/SystemPage';
import { ReferentialsPage } from '../features/referentials/ReferentialsPage';
import { ModelPage, ModelsPage } from '../features/models/ModelsPage';
import { EvaluationsPage } from '../features/assessments/EvaluationsPage';
import { RisksPage } from '../features/risks/RisksPage';
import { RiskPage } from '../features/risks/RiskPage';
import { ActionsPage } from '../features/actions/ActionsPage';
import { MethodologyPanel } from '../features/admin/MethodologyPanel';
import { ReviewSettingsPanel } from '../features/admin/ReviewSettingsPanel';
import { NoticeSettingsPanel } from '../features/admin/NoticeSettingsPanel';
import { DocumentationPage } from '../features/documents/DocumentationPage';
import { NotificationsPage } from '../features/workflow/NotificationsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';

function RequireAuth() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (me.user.mustChangePassword && location.pathname !== '/mot-de-passe') {
    return <Navigate to="/mot-de-passe" replace />;
  }
  return <Outlet />;
}

const planned = (title: string, slice: string, scope: string[]) => (
  <NotImplemented title={title} slice={slice} scope={scope} />
);

export const router = createBrowserRouter([
  { path: '/connexion', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/mot-de-passe', element: <ChangePasswordPage /> },
      {
        element: <Layout />,
        children: [
          { index: true, element: <Navigate to="/tableau-de-bord" replace /> },
          { path: '/tableau-de-bord', element: <DashboardPage /> },
          { path: '/systemes', element: <RegistryPage /> },
          { path: '/systemes/:id', element: <SystemPage /> },
          { path: '/modeles', element: <ModelsPage /> },
          { path: '/modeles/:id', element: <ModelPage /> },
          { path: '/evaluations', element: <EvaluationsPage /> },
          { path: '/risques', element: <RisksPage /> },
          { path: '/risques/:id', element: <RiskPage /> },
          { path: '/actions', element: <ActionsPage /> },
          { path: '/documentation/*', element: <DocumentationPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          {
            path: '/referentiels/*',
            element: <ReferentialsPage />,
          },
          {
            path: '/rapports',
            element: planned('Rapports', 'S10', ['11 rapports standards', 'Exports CSV, XLSX, PDF, DOCX']),
          },
          {
            path: '/administration',
            element: <AdminPage />,
            children: [
              { index: true, element: <Navigate to="utilisateurs" replace /> },
              { path: 'utilisateurs', element: <UsersPanel /> },
              { path: 'unites', element: <OrgUnitsPanel /> },
              { path: 'roles', element: <RolesPanel /> },
              { path: 'journal', element: <AuditPanel /> },
              { path: 'methodologie', element: <MethodologyPanel /> },
              { path: 'revues', element: <ReviewSettingsPanel /> },
              { path: 'notices', element: <NoticeSettingsPanel /> },
            ],
          },
          {
            path: '*',
            element: planned('Page introuvable', '—', ['Cette adresse ne correspond à aucun écran.']),
          },
        ],
      },
    ],
  },
]);
