// ===========================================
// Create Group Dialog
// ===========================================
// Simple dialog for creating a new channel group from the dashboard.

import { useState, useCallback, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import { useCreateChannelGroup } from '../../hooks/use-channel-groups.js';
import { useNotification } from '../../stores/notification.store.js';

interface CreateGroupDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CreateGroupDialog({ open, onClose }: CreateGroupDialogProps): ReactNode {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createGroup = useCreateChannelGroup();
  const { notify } = useNotification();

  const handleClose = useCallback((): void => {
    setName('');
    setDescription('');
    setError(null);
    onClose();
  }, [onClose]);

  const handleCreate = useCallback((): void => {
    if (!name.trim()) return;
    setError(null);
    createGroup.mutate(
      { name: name.trim(), description: description.trim() },
      {
        onSuccess: () => {
          notify(`Group "${name.trim()}" created`, 'success');
          handleClose();
        },
        onError: (err) => {
          setError(err.message);
        },
      },
    );
  }, [name, description, createGroup, notify, handleClose]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Group</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        ) : null}
        <TextField
          autoFocus
          fullWidth
          label="Name"
          value={name}
          onChange={(e) => { setName(e.target.value); }}
          slotProps={{ htmlInput: { maxLength: 255 } }}
          sx={{ mt: 1 }}
        />
        <TextField
          fullWidth
          label="Description"
          value={description}
          onChange={(e) => { setDescription(e.target.value); }}
          multiline
          minRows={2}
          maxRows={4}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={createGroup.isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={createGroup.isPending || !name.trim()}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
