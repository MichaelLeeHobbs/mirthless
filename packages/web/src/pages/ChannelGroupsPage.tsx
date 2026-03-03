// ===========================================
// Channel Groups Page
// ===========================================
// Group management: list groups, create/edit, manage members.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
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
} from '../hooks/use-channel-groups.js';

export function ChannelGroupsPage(): ReactNode {
  const { data: groups, isLoading, error, isFetching } = useChannelGroups();
  const createGroup = useCreateChannelGroup();
  const updateGroup = useUpdateChannelGroup();
  const deleteGroup = useDeleteChannelGroup();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelGroupSummary | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const handleOpenCreate = (): void => {
    setEditing(null);
    setName('');
    setDescription('');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (group: ChannelGroupSummary): void => {
    setEditing(group);
    setName(group.name);
    setDescription(group.description ?? '');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleClose = (): void => {
    setDialogOpen(false);
    setEditing(null);
    setDialogError(null);
  };

  const handleSave = (): void => {
    if (editing) {
      updateGroup.mutate(
        { id: editing.id, input: { name, description, revision: editing.revision } },
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    } else {
      createGroup.mutate(
        { name, description },
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    }
  };

  const handleDelete = (group: ChannelGroupSummary): void => {
    deleteGroup.mutate(group.id);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Channel Groups</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Create Group
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load groups: {error.message}</Alert>}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
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
                        <IconButton size="small" onClick={() => { handleDelete(group); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                      No channel groups found
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Group' : 'Create Group'}</DialogTitle>
        <DialogContent>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
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
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || createGroup.isPending || updateGroup.isPending}
          >
            {editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
