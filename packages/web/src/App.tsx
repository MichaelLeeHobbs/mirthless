import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryProvider } from './providers/QueryProvider.js';
import { darkTheme, lightTheme } from './styles/theme.js';
import { useUiStore } from './stores/ui.store.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { ProtectedRoute } from './components/layout/ProtectedRoute.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ChannelsPage } from './pages/ChannelsPage.js';
import { ChannelEditorPage } from './pages/ChannelEditorPage.js';

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
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryProvider>
  );
}
