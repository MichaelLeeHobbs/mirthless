// ===========================================
// User Create/Edit Dialog
// ===========================================

import { useState, useEffect, type ReactNode, type ChangeEvent } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import type { UserSummary } from '../../api/client.js';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'deployer', label: 'Deployer' },
  { value: 'developer', label: 'Developer' },
  { value: 'viewer', label: 'Viewer' },
] as const;

interface UserDialogProps {
  readonly open: boolean;
  readonly user: UserSummary | null;
  readonly onClose: () => void;
  readonly onSave: (data: UserFormData) => void;
  readonly error: string | null;
  readonly saving: boolean;
}

export interface UserFormData {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: string;
}

export function UserDialog({ open, user, onClose, onSave, error, saving }: UserDialogProps): ReactNode {
  const isEdit = user !== null;
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('viewer');

  useEffect(() => {
    if (open) {
      if (user) {
        setUsername(user.username);
        setEmail(user.email);
        setPassword('');
        setFirstName(user.firstName ?? '');
        setLastName(user.lastName ?? '');
        setRole(user.role);
      } else {
        setUsername('');
        setEmail('');
        setPassword('');
        setFirstName('');
        setLastName('');
        setRole('viewer');
      }
    }
  }, [open, user]);

  const handleSave = (): void => {
    onSave({ username, email, password, firstName, lastName, role });
  };

  const isValid = username.length > 0 && email.length > 0 && (isEdit || password.length >= 8);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit User' : 'Create User'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12}>
            <TextField
              label="Username"
              value={username}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setUsername(e.target.value); }}
              fullWidth
              required
              disabled={isEdit}
              autoFocus={!isEdit}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setEmail(e.target.value); }}
              fullWidth
              required
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label={isEdit ? 'New Password (leave blank to keep)' : 'Password'}
              type="password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); }}
              fullWidth
              required={!isEdit}
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="First Name"
              value={firstName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setFirstName(e.target.value); }}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Last Name"
              value={lastName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setLastName(e.target.value); }}
              fullWidth
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Role"
              select
              value={role}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setRole(e.target.value); }}
              fullWidth
            >
              {ROLES.map((r) => (
                <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!isValid || saving}
        >
          {saving ? 'Saving...' : (isEdit ? 'Save' : 'Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
