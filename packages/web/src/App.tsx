import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryProvider } from './providers/QueryProvider.js';
import { darkTheme, lightTheme } from './styles/theme.js';
import { useUiStore } from './stores/ui.store.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { NotificationSnackbar } from './components/common/NotificationSnackbar.js';
import { RouteFallback } from './components/layout/RouteFallback.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { ProtectedRoute } from './components/layout/ProtectedRoute.js';
import { RequirePermission } from './components/layout/RequirePermission.js';
import { PERMISSION } from './lib/permissions.js';

// Route-level code splitting: each page ships in its own chunk so the initial
// bundle stays small and heavy editors (Monaco) load only when their route is
// visited. Pages use named exports, so map each to a default for React.lazy.
function page<T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  name: keyof T,
): ReturnType<typeof lazy> {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[name] };
  });
}

const LoginPage = page(() => import('./pages/LoginPage.js'), 'LoginPage');
const DashboardPage = page(() => import('./pages/DashboardPage.js'), 'DashboardPage');
const ChannelsPage = page(() => import('./pages/ChannelsPage.js'), 'ChannelsPage');
const ChannelEditorPage = page(() => import('./pages/ChannelEditorPage.js'), 'ChannelEditorPage');
const MessageBrowserPage = page(() => import('./pages/MessageBrowserPage.js'), 'MessageBrowserPage');
const CodeTemplatePage = page(() => import('./pages/CodeTemplatePage.js'), 'CodeTemplatePage');
const GlobalScriptsPage = page(() => import('./pages/GlobalScriptsPage.js'), 'GlobalScriptsPage');
const AlertsPage = page(() => import('./pages/AlertsPage.js'), 'AlertsPage');
const AlertEditorPage = page(() => import('./pages/AlertEditorPage.js'), 'AlertEditorPage');
const EventsPage = page(() => import('./pages/EventsPage.js'), 'EventsPage');
const SettingsPage = page(() => import('./pages/SettingsPage.js'), 'SettingsPage');
const UsersPage = page(() => import('./pages/UsersPage.js'), 'UsersPage');
const TagsPage = page(() => import('./pages/TagsPage.js'), 'TagsPage');
const ResourcesPage = page(() => import('./pages/ResourcesPage.js'), 'ResourcesPage');
const GlobalMapPage = page(() => import('./pages/GlobalMapPage.js'), 'GlobalMapPage');
const ConfigMapPage = page(() => import('./pages/ConfigMapPage.js'), 'ConfigMapPage');
const SystemInfoPage = page(() => import('./pages/SystemInfoPage.js'), 'SystemInfoPage');
const MessageGeneratorPage = page(() => import('./pages/MessageGeneratorPage.js'), 'MessageGeneratorPage');
const ExtensionsPage = page(() => import('./pages/ExtensionsPage.js'), 'ExtensionsPage');
const CrossChannelSearchPage = page(() => import('./pages/CrossChannelSearchPage.js'), 'CrossChannelSearchPage');
const ChannelStatisticsPage = page(() => import('./pages/ChannelStatisticsPage.js'), 'ChannelStatisticsPage');
const CertificatesPage = page(() => import('./pages/CertificatesPage.js'), 'CertificatesPage');

/** Wrap a lazily-loaded page in Suspense with a consistent loading fallback. */
function lazyRoute(element: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: lazyRoute(<LoginPage />),
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: lazyRoute(<DashboardPage />) },
          { path: 'channels', element: lazyRoute(<ChannelsPage />) },
          { path: 'channels/new', element: lazyRoute(<ChannelEditorPage />) },
          { path: 'channels/:id', element: lazyRoute(<ChannelEditorPage />) },
          { path: 'channels/:id/messages', element: lazyRoute(<MessageBrowserPage />) },
          { path: 'channels/:id/statistics', element: lazyRoute(<ChannelStatisticsPage />) },
          { path: 'messages', element: lazyRoute(<CrossChannelSearchPage />) },
          { path: 'alerts', element: lazyRoute(<AlertsPage />) },
          { path: 'alerts/new', element: lazyRoute(<AlertEditorPage />) },
          { path: 'alerts/:id', element: lazyRoute(<AlertEditorPage />) },
          { path: 'code-templates', element: lazyRoute(<CodeTemplatePage />) },
          { path: 'global-scripts', element: lazyRoute(<GlobalScriptsPage />) },
          { path: 'resources', element: lazyRoute(<ResourcesPage />) },
          { path: 'certificates', element: lazyRoute(<CertificatesPage />) },
          { path: 'tags', element: lazyRoute(<TagsPage />) },
          { path: 'global-map', element: lazyRoute(<GlobalMapPage />) },
          { path: 'config-map', element: lazyRoute(<ConfigMapPage />) },
          { path: 'tools/message-generator', element: lazyRoute(<MessageGeneratorPage />) },
          { path: 'extensions', element: lazyRoute(<ExtensionsPage />) },
          // Privileged routes — gated so a viewer cannot reach them by URL.
          {
            element: <RequirePermission anyOf={[PERMISSION.EVENTS_READ]} />,
            children: [{ path: 'events', element: lazyRoute(<EventsPage />) }],
          },
          {
            element: <RequirePermission anyOf={[PERMISSION.SETTINGS_READ, PERMISSION.SETTINGS_WRITE]} />,
            children: [{ path: 'settings', element: lazyRoute(<SettingsPage />) }],
          },
          {
            element: <RequirePermission anyOf={[PERMISSION.SYSTEM_INFO]} />,
            children: [{ path: 'system', element: lazyRoute(<SystemInfoPage />) }],
          },
          {
            element: <RequirePermission anyOf={[PERMISSION.USERS_READ]} />,
            children: [{ path: 'users', element: lazyRoute(<UsersPage />) }],
          },
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
