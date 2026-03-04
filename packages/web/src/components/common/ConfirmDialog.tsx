// ===========================================
// Confirm Dialog
// ===========================================
// Reusable confirmation dialog to replace window.confirm() across the app.

import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly severity?: 'warning' | 'error' | 'info';
  readonly isPending?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  severity = 'warning',
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactNode {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isPending}>
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          color={severity}
          variant="contained"
          disabled={isPending}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
