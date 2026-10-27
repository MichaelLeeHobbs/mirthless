// ===========================================
// Page Header
// ===========================================
// One consistent page title treatment across the app: an h1 title, an optional
// one-line description, an inline "refreshing" indicator, and a right-aligned
// slot for primary actions. Replaces the ad-hoc `Typography variant="h4"` +
// flex-between blocks that were copy-pasted onto every page.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

interface PageHeaderProps {
  readonly title: string;
  /** Optional supporting line beneath the title. */
  readonly description?: string;
  /** Right-aligned action controls (buttons, toggles). */
  readonly actions?: ReactNode;
  /** Shows a small spinner beside the title during a background refetch. */
  readonly isFetching?: boolean;
}

export function PageHeader({ title, description, actions, isFetching }: PageHeaderProps): ReactNode {
  return (
    <Box sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h4" component="h1">
              {title}
            </Typography>
            {isFetching ? <CircularProgress size={16} thickness={5} aria-label="Refreshing" /> : null}
          </Box>
          {description ? (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                mt: 0.5,
                maxWidth: 640
              }}>
              {description}
            </Typography>
          ) : null}
        </Box>
        {actions ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>
        ) : null}
      </Box>
    </Box>
  );
}
