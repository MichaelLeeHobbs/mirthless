// ===========================================
// Route Fallback
// ===========================================
// Suspense fallback shown while a route-level page chunk loads. Kept minimal and
// centered so the transition between routes reads as calm, not janky.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

export function RouteFallback(): ReactNode {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '40vh',
        width: '100%',
      }}
    >
      <CircularProgress aria-label="Loading page" />
    </Box>
  );
}
