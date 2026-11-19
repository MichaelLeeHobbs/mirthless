// The `reasonLabel` reason goes to onConfirm: an export or a backup records it in the audit log (D-312).

import { useEffect, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/** The shortest reason the server accepts (exportReasonSchema). */
export const MIN_REASON_LENGTH = 3;

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly severity?: 'warning' | 'error' | 'info';
  readonly isPending?: boolean;
  readonly reasonLabel?: string;
  readonly reasonHelp?: string;
  readonly requireTyped?: string;
  readonly onConfirm: (reason?: string) => void;
  readonly onCancel: () => void;
}

/** Mirrors the server's exportReasonSchema. */
export function isValidReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_REASON_LENGTH && trimmed.length <= 500 && !/[\r\n]/.test(trimmed);
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  severity = 'warning',
  isPending = false,
  reasonLabel,
  reasonHelp,
  requireTyped,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactNode {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) { setReason(''); setTyped(''); }
  }, [open]);

  const reasonOk = reasonLabel === undefined || isValidReason(reason);
  const typedOk = requireTyped === undefined || typed === requireTyped;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
        {reasonLabel !== undefined ? (
          <TextField
            autoFocus fullWidth required margin="normal" size="small"
            label={reasonLabel} value={reason}
            onChange={(e) => { setReason(e.target.value.replace(/[\r\n]+/g, ' ')); }}
            helperText={reasonHelp ?? 'Recorded in the audit log and written into the file.'}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        ) : null}
        {requireTyped !== undefined ? (
          <TextField
            fullWidth margin="normal" size="small"
            label={`Type ${requireTyped} to confirm`} value={typed}
            onChange={(e) => { setTyped(e.target.value); }}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isPending}>
          {cancelLabel}
        </Button>
        <Button
          onClick={() => { onConfirm(reasonLabel === undefined ? undefined : reason.trim()); }}
          color={severity}
          variant="contained"
          disabled={isPending || !reasonOk || !typedOk}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
