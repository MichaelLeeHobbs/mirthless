// ===========================================
// Change Password Dialog (self-service)
// ===========================================
// Lets the signed-in user change their own password.

import { useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import { useChangeOwnPassword } from '../../hooks/use-users.js';
import { useNotification } from '../../stores/notification.store.js';

interface ChangePasswordDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const MIN_LENGTH = 8;

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps): ReactNode {
  const changePassword = useChangeOwnPassword();
  const { notify } = useNotification();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const handleClose = (): void => {
    if (changePassword.isPending) return;
    reset();
    onClose();
  };

  const handleSubmit = (): void => {
    setError(null);
    if (newPassword.length < MIN_LENGTH) {
      setError(`New password must be at least ${String(MIN_LENGTH)} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          notify('Password changed', 'success');
          reset();
          onClose();
        },
        onError: (err) => { setError(err.message); },
      },
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Change Password</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); }}
            autoComplete="current-password"
            fullWidth
            autoFocus
          />
          <TextField
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); }}
            autoComplete="new-password"
            helperText={`At least ${String(MIN_LENGTH)} characters`}
            fullWidth
          />
          <TextField
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); }}
            autoComplete="new-password"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={changePassword.isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={changePassword.isPending || currentPassword.length === 0 || newPassword.length === 0}
        >
          {changePassword.isPending ? 'Saving...' : 'Change Password'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
