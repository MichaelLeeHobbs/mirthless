// ===========================================
// Group Management Dialog
// ===========================================
// Dialog for managing channel groups (CRUD) from the Channels page.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  useChannelGroups,
  useCreateChannelGroup,
  useUpdateChannelGroup,
  useDeleteChannelGroup,
  type ChannelGroupSummary,
} from '../../hooks/use-channel-groups.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { useNotificationStore } from '../../stores/notification.store.js';

interface GroupManagementDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Renders the group table and inline create/edit form. */
function GroupTable({ onClose: _onClose }: { readonly onClose: () => void }): ReactNode {
  const { data: groups, isLoading, error, isFetching } = useChannelGroups();
  const createGroup = useCreateChannelGroup();
  const updateGroup = useUpdateChannelGroup();
  const deleteGroup = useDeleteChannelGroup();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelGroupSummary | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelGroupSummary | null>(null);

  const handleOpenCreate = (): void => {
    setEditing(null);
    setName('');
    setDescription('');
    setFormError(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (group: ChannelGroupSummary): void => {
    setEditing(group);
    setName(group.name);
    setDescription(group.description ?? '');
    setFormError(null);
    setFormOpen(true);
  };

  const handleFormClose = (): void => {
    setFormOpen(false);
    setEditing(null);
    setFormError(null);
  };

  const handleSave = (): void => {
    if (editing) {
      updateGroup.mutate(
        { id: editing.id, input: { name, description, revision: editing.revision } },
        {
          onSuccess: () => {
            handleFormClose();
            useNotificationStore.getState().notify('Group updated', 'success');
          },
          onError: (err) => { setFormError(err.message); },
        },
      );
    } else {
      createGroup.mutate(
        { name, description },
        {
          onSuccess: () => {
            handleFormClose();
            useNotificationStore.getState().notify('Group created', 'success');
          },
          onError: (err) => { setFormError(err.message); },
        },
      );
    }
  };

  const handleDeleteConfirm = (): void => {
    if (!deleteTarget) return;
    deleteGroup.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        useNotificationStore.getState().notify('Group deleted', 'success');
      },
      onError: (err) => {
        setDeleteTarget(null);
        useNotificationStore.getState().notify(err.message, 'error');
      },
    });
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>Failed to load groups: {error.message}</Alert> : null}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {groups?.length ?? 0} group{(groups?.length ?? 0) !== 1 ? 's' : ''}
          </Typography>
          {isFetching && !isLoading ? <CircularProgress size={16} /> : null}
        </Box>
        <Button size="small" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Create Group
        </Button>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="center">Members</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups && groups.length > 0 ? (
              groups.map((group) => (
                <TableRow key={group.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{group.name}</Typography>
                  </TableCell>
                  <TableCell>{group.description || '-'}</TableCell>
                  <TableCell align="center">{group.memberCount}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => { handleOpenEdit(group); }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => { setDeleteTarget(group); }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No channel groups found
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create / Edit form dialog */}
      <Dialog open={formOpen} onClose={handleFormClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Group' : 'Create Group'}</DialogTitle>
        <DialogContent>
          {formError ? <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert> : null}
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            value={name}
            onChange={(e) => { setName(e.target.value); }}
          />
          <TextField
            margin="dense"
            label="Description"
            fullWidth
            multiline
            rows={3}
            value={description}
            onChange={(e) => { setDescription(e.target.value); }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleFormClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || createGroup.isPending || updateGroup.isPending}
          >
            {editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Group"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ''}"? Channels in this group will be moved to the Default group.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteGroup.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeleteTarget(null); }}
      />
    </>
  );
}

export function GroupManagementDialog({ open, onClose }: GroupManagementDialogProps): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Manage Channel Groups</DialogTitle>
      <DialogContent dividers>
        <GroupTable onClose={onClose} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
