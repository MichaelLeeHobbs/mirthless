import { Navigate, Outlet } from 'react-router-dom';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { useAuthStore } from '../../stores/auth.store.js';

/**
 * Auth guard component.
 * Redirects unauthenticated users to /login.
 * Shows a loading spinner while auth state is being resolved.
 */
export function ProtectedRoute(): ReactNode {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
