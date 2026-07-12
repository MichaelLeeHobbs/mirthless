// ===========================================
// Error State
// ===========================================
// A shared, honest error surface. Failures must never be swallowed or shown as
// an innocent "no data" — this healthcare tooling fails loud. The message says
// what went wrong; the button offers the fix (retry).

import type { ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { SxProps, Theme } from '@mui/material/styles';

interface ErrorStateProps {
  /** Short headline, e.g. "Couldn't load channels". */
  readonly title?: string;
  /** The error, or a message string. Rendered as detail text. */
  readonly error: unknown;
  /** When provided, shows a Retry button that calls this. */
  readonly onRetry?: () => void;
  readonly sx?: SxProps<Theme>;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}

export function ErrorState({ title = 'Something went wrong', error, onRetry, sx }: ErrorStateProps): ReactNode {
  return (
    <Alert
      severity="error"
      {...(sx ? { sx } : {})}
      action={
        onRetry ? (
          <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      <AlertTitle sx={{ fontWeight: 600 }}>{title}</AlertTitle>
      {toMessage(error)}
    </Alert>
  );
}
