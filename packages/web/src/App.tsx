import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryProvider } from './providers/QueryProvider.js';
import { darkTheme, lightTheme } from './styles/theme.js';
import { useUiStore } from './stores/ui.store.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { NotificationSnackbar } from './components/common/NotificationSnackbar.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { ProtectedRoute } from './components/layout/ProtectedRoute.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ChannelsPage } from './pages/ChannelsPage.js';
import { ChannelEditorPage } from './pages/ChannelEditorPage.js';
import { MessageBrowserPage } from './pages/MessageBrowserPage.js';
import { CodeTemplatePage } from './pages/CodeTemplatePage.js';
import { GlobalScriptsPage } from './pages/GlobalScriptsPage.js';
import { AlertsPage } from './pages/AlertsPage.js';
import { AlertEditorPage } from './pages/AlertEditorPage.js';
import { EventsPage } from './pages/EventsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { ChannelGroupsPage } from './pages/ChannelGroupsPage.js';
import { TagsPage } from './pages/TagsPage.js';
import { ResourcesPage } from './pages/ResourcesPage.js';
import { GlobalMapPage } from './pages/GlobalMapPage.js';
import { ConfigMapPage } from './pages/ConfigMapPage.js';
import { SystemInfoPage } from './pages/SystemInfoPage.js';
import { MessageGeneratorPage } from './pages/MessageGeneratorPage.js';
import { ExtensionsPage } from './pages/ExtensionsPage.js';
import { CrossChannelSearchPage } from './pages/CrossChannelSearchPage.js';
import { ChannelStatisticsPage } from './pages/ChannelStatisticsPage.js';
import { CertificatesPage } from './pages/CertificatesPage.js';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'channels', element: <ChannelsPage /> },
          { path: 'channels/new', element: <ChannelEditorPage /> },
          { path: 'channels/:id', element: <ChannelEditorPage /> },
          { path: 'channels/:id/messages', element: <MessageBrowserPage /> },
          { path: 'channels/:id/statistics', element: <ChannelStatisticsPage /> },
          { path: 'messages', element: <CrossChannelSearchPage /> },
          { path: 'channel-groups', element: <ChannelGroupsPage /> },
          { path: 'alerts', element: <AlertsPage /> },
          { path: 'alerts/new', element: <AlertEditorPage /> },
          { path: 'alerts/:id', element: <AlertEditorPage /> },
          { path: 'code-templates', element: <CodeTemplatePage /> },
          { path: 'events', element: <EventsPage /> },
          { path: 'global-scripts', element: <GlobalScriptsPage /> },
          { path: 'resources', element: <ResourcesPage /> },
          { path: 'certificates', element: <CertificatesPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'tags', element: <TagsPage /> },
          { path: 'global-map', element: <GlobalMapPage /> },
          { path: 'config-map', element: <ConfigMapPage /> },
          { path: 'system', element: <SystemInfoPage /> },
          { path: 'tools/message-generator', element: <MessageGeneratorPage /> },
          { path: 'extensions', element: <ExtensionsPage /> },
          { path: 'users', element: <UsersPage /> },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);

export function App(): ReactNode {
  const themeMode = useUiStore((state) => state.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  return (
    <QueryProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ErrorBoundary>
          <RouterProvider router={router} />
        </ErrorBoundary>
        <NotificationSnackbar />
      </ThemeProvider>
    </QueryProvider>
  );
}
