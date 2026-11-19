import { useState, useEffect, type ReactNode, type ChangeEvent } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import type { UserSummary } from '../../api/client.js';
import { useAssignments } from '../../hooks/use-assignments.js';
import { sameAssignments, toDraft, type AssignmentDraft } from '../../lib/assignments.js';
import { LoadingBlock } from '../common/states/LoadingState.js';
import { RoleAccessSection } from './RoleAccessSection.js';
import { AssignmentsEditor } from './AssignmentsEditor.js';

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
  /** Applies only to a new user. */
  readonly role: string;
  /** null when the access list did not change. */
  readonly assignments: readonly AssignmentDraft[] | null;
}

export function UserDialog({ open, user, onClose, onSave, error, saving }: UserDialogProps): ReactNode {
  const isEdit = user !== null;
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('viewer');
  const held = useAssignments(open && user ? user.id : null);
  const [access, setAccess] = useState<readonly AssignmentDraft[] | null>(null);
  const [baseline, setBaseline] = useState<readonly AssignmentDraft[] | null>(null);
  const [openedAt, setOpenedAt] = useState(0);

  // Reset when the dialog opens or moves to another user, never when the page
  // replaces the user object after a partial save: that would throw away edits
  // the server has not taken yet.
  const formFor = open ? (user?.id ?? 'new') : null;
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<UserSummary | null>(user);
  if (user !== savedUser) {
    // The page replaced the user after saving the details: a retry should not
    // send the refused password again, but the other edits stay.
    setSavedUser(user);
    setPassword('');
  }
  if (formFor !== resetFor) {
    setResetFor(formFor);
    if (formFor !== null) {
      setUsername(user?.username ?? '');
      setEmail(user?.email ?? '');
      setPassword('');
      setFirstName(user?.firstName ?? '');
      setLastName(user?.lastName ?? '');
      setRole(user?.role ?? 'viewer');
      setAccess(null);
      setBaseline(null);
      setOpenedAt(Date.now());
    }
  }

  // Seed the list from data fetched after the dialog opened, never from a cached
  // copy that a save or another admin has since changed.
  const fresh = held.data !== undefined && held.dataUpdatedAt >= openedAt ? held.data : undefined;
  useEffect(() => {
    if (fresh && access === null) {
      const drafts = fresh.map(toDraft);
      setAccess(drafts);
      setBaseline(drafts);
    }
  }, [fresh, access]);

  const accessChanged = isEdit && access !== null && baseline !== null && !sameAssignments(access, baseline);
  const accessComplete = access === null || access.every((d) => d.roleId !== '' && (d.expired || d.groupIds === null || d.groupIds.length > 0));

  const handleSave = (): void => {
    onSave({ username, email, password, firstName, lastName, role, assignments: accessChanged ? access : null });
  };

  // The other fields can be saved while the access list is loading or failed to load.
  const isValid = username.length > 0 && email.length > 0 && (isEdit || password.length >= 8) && accessComplete;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? 'Edit User' : 'Create User'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={12}>
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
          <Grid size={12}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setEmail(e.target.value); }}
              fullWidth
              required
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label={isEdit ? 'New Password (leave blank to keep)' : 'Password'}
              type="password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); }}
              fullWidth
              required={!isEdit}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="First Name"
              value={firstName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setFirstName(e.target.value); }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Last Name"
              value={lastName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setLastName(e.target.value); }}
              fullWidth
            />
          </Grid>
          <Grid size={12}>
            {!isEdit && <RoleAccessSection value={role} current={[]} onChange={setRole} />}
            {isEdit && held.isError && <Alert severity="error">This user's access could not load, so it cannot be changed here. The other fields can still be saved.</Alert>}
            {isEdit && !held.isError && access === null && <LoadingBlock label="Loading access" py={2} />}
            {isEdit && access !== null && <AssignmentsEditor value={access} onChange={setAccess} />}
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
