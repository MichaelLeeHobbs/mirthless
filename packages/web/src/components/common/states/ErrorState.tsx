// Failures must never be swallowed or shown as an innocent "no data": this healthcare tooling fails loud.

import type { ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { SxProps, Theme } from '@mui/material/styles';
import { errorMessage } from '../../../lib/error-message.js';

interface ErrorStateProps {
  readonly title?: string;
  readonly error: unknown;
  readonly onRetry?: () => void;
  readonly sx?: SxProps<Theme>;
}

const ERROR_STATE_FALLBACK = 'An unexpected error occurred.';

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
      {errorMessage(error, ERROR_STATE_FALLBACK)}
    </Alert>
  );
}
