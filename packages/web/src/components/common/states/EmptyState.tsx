// ===========================================
// Empty State
// ===========================================
// A shared, inviting empty state: an icon, a short headline, a line of guidance,
// and an optional primary action. An empty screen is an invitation to act, not
// a dead end — so it names the next step instead of just saying "no data".

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface EmptyStateProps {
  /** An MUI icon element (rendered muted and enlarged). */
  readonly icon?: ReactNode;
  readonly title: string;
  readonly description?: string;
  /** Optional call-to-action, e.g. a "New channel" button. */
  readonly action?: ReactNode;
  /** Compact variant for use inside a table cell or small panel. */
  readonly dense?: boolean;
}

export function EmptyState({ icon, title, description, action, dense }: EmptyStateProps): ReactNode {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1,
        py: dense ? 5 : 8,
        px: 3,
      }}
    >
      {icon ? (
        <Box
          sx={{
            color: 'text.disabled',
            fontSize: dense ? 40 : 56,
            display: 'inline-flex',
            '& > svg': { fontSize: 'inherit' },
            mb: 0.5,
          }}
        >
          {icon}
        </Box>
      ) : null}
      <Typography variant={dense ? 'subtitle1' : 'h6'} sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ mt: 1.5 }}>{action}</Box> : null}
    </Box>
  );
}
