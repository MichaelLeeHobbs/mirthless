// ===========================================
// Tags Page
// ===========================================
// Tag management: list tags, create/edit with color picker.

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
import Chip from '@mui/material/Chip';
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
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  type TagSummary,
} from '../hooks/use-tags.js';

export function TagsPage(): ReactNode {
  const { data: tags, isLoading, error, isFetching } = useTags();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TagSummary | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2196F3');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const handleOpenCreate = (): void => {
    setEditing(null);
    setName('');
    setColor('#2196F3');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (tag: TagSummary): void => {
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color ?? '#2196F3');
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
      updateTag.mutate(
        { id: editing.id, input: { name, color } },
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    } else {
      createTag.mutate(
        { name, color },
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    }
  };

  const handleDelete = (tag: TagSummary): void => {
    deleteTag.mutate(tag.id);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Tags</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Create Tag
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load tags: {error.message}</Alert>}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Tag</TableCell>
                <TableCell>Color</TableCell>
                <TableCell align="center">Channels</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tags && tags.length > 0 ? (
                tags.map((tag) => (
                  <TableRow key={tag.id} hover>
                    <TableCell>
                      <Chip
                        label={tag.name}
                        size="small"
                        sx={{ backgroundColor: tag.color ?? '#ccc', color: '#fff', fontWeight: 500 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            backgroundColor: tag.color ?? '#ccc',
                            border: '1px solid',
                            borderColor: 'divider',
                          }}
                        />
                        <Typography variant="body2">{tag.color}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="center">{tag.assignmentCount}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => { handleOpenEdit(tag); }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => { handleDelete(tag); }}>
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
                      No tags found
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Tag' : 'Create Tag'}</DialogTitle>
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
            <TextField
              label="Color"
              value={color}
              onChange={(e) => { setColor(e.target.value); }}
              sx={{ flex: 1 }}
            />
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value); }}
              style={{ width: 48, height: 48, border: 'none', cursor: 'pointer' }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || createTag.isPending || updateTag.isPending}
          >
            {editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
