// ===========================================
// Channel CRUD Actions
// ===========================================
// Shared clone / delete / export handlers + their dialogs, so any view (the
// dashboard tables, the context menu) can offer full channel actions without
// duplicating dialog state. Render `dialogs` once and pass the handlers down.

import { useState, useCallback, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { useDeleteChannel, useCloneChannel } from './use-channels.js';
import { downloadChannelExport } from '../lib/channel-export.js';
import { useNotification } from '../stores/notification.store.js';

interface ChannelRef {
  readonly id: string;
  readonly name: string;
}

export interface ChannelCrud {
  readonly onClone: (id: string, name: string) => void;
  readonly onDelete: (id: string, name: string) => void;
  readonly onExport: (id: string) => void;
  readonly dialogs: ReactNode;
}

/** Manage channel clone/delete dialogs + export, shared across views. */
export function useChannelCrud(): ChannelCrud {
  const { notify } = useNotification();
  const deleteChannel = useDeleteChannel();
  const cloneChannel = useCloneChannel();

  const [deleteTarget, setDeleteTarget] = useState<ChannelRef | null>(null);
  const [cloneTarget, setCloneTarget] = useState<ChannelRef | null>(null);
  const [cloneName, setCloneName] = useState('');

  const onClone = useCallback((id: string, name: string): void => {
    setCloneTarget({ id, name });
    setCloneName(`Copy of ${name}`);
  }, []);

  const onDelete = useCallback((id: string, name: string): void => {
    setDeleteTarget({ id, name });
  }, []);

  const onExport = useCallback((id: string): void => {
    void downloadChannelExport(id).catch((e: unknown) => {
      notify(e instanceof Error ? e.message : 'Export failed', 'error');
    });
  }, [notify]);

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await deleteChannel.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // Global mutation handler surfaces the error toast; keep the dialog open.
    }
  };

  const handleCloneConfirm = async (): Promise<void> => {
    if (!cloneTarget || !cloneName.trim()) return;
    try {
      await cloneChannel.mutateAsync({ id: cloneTarget.id, name: cloneName.trim() });
      setCloneTarget(null);
      setCloneName('');
    } catch {
      // Global mutation handler surfaces the error toast; keep the dialog open.
    }
  };

  const dialogs = (
    <>
      <Dialog open={deleteTarget !== null} onClose={() => { setDeleteTarget(null); }}>
        <DialogTitle>Delete Channel</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action can be undone by an administrator.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteTarget(null); }}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm} disabled={deleteChannel.isPending}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cloneTarget !== null} onClose={() => { setCloneTarget(null); }}>
        <DialogTitle>Clone Channel</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Create a copy of <strong>{cloneTarget?.name}</strong> with a new name. The cloned channel will be disabled by default.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="New Channel Name"
            value={cloneName}
            onChange={(e) => { setCloneName(e.target.value); }}
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCloneTarget(null); }}>Cancel</Button>
          <Button variant="contained" onClick={handleCloneConfirm} disabled={cloneChannel.isPending || !cloneName.trim()}>
            Clone
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  return { onClone, onDelete, onExport, dialogs };
}
