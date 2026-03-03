// ===========================================
// Resources Page
// ===========================================
// Resource management: list, create/edit with content editor.

import { useState, useEffect, type ReactNode } from 'react';
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
  useResources,
  useResource,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
  type ResourceSummary,
} from '../hooks/use-resources.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResourcesPage(): ReactNode {
  const { data: resources, isLoading, error, isFetching } = useResources();
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mimeType, setMimeType] = useState('text/plain');
  const [content, setContent] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const { data: editingDetail, isLoading: isDetailLoading } = useResource(editingId ?? '');

  // Sync content when resource detail finishes loading
  useEffect(() => {
    if (editingDetail?.content != null) {
      setContent(editingDetail.content);
    }
  }, [editingDetail]);

  const handleOpenCreate = (): void => {
    setEditingId(null);
    setName('');
    setDescription('');
    setMimeType('text/plain');
    setContent('');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (resource: ResourceSummary): void => {
    setEditingId(resource.id);
    setName(resource.name);
    setDescription(resource.description ?? '');
    setMimeType(resource.mimeType ?? 'text/plain');
    setContent('');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleClose = (): void => {
    setDialogOpen(false);
    setEditingId(null);
    setDialogError(null);
  };

  const handleSave = (): void => {
    if (editingId) {
      updateResource.mutate(
        { id: editingId, input: { name, description, mimeType, content } },
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    } else {
      createResource.mutate(
        { name, description, mimeType, content },
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    }
  };

  const handleDelete = (resource: ResourceSummary): void => {
    deleteResource.mutate(resource.id);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Resources</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Create Resource
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load resources: {error.message}</Alert>}

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
                <TableCell>MIME Type</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {resources && resources.length > 0 ? (
                resources.map((resource) => (
                  <TableRow key={resource.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{resource.name}</Typography>
                    </TableCell>
                    <TableCell>{resource.description || '-'}</TableCell>
                    <TableCell>{resource.mimeType || '-'}</TableCell>
                    <TableCell align="right">{formatBytes(resource.sizeBytes)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => { handleOpenEdit(resource); }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => { handleDelete(resource); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                      No resources found
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editingId ? 'Edit Resource' : 'Create Resource'}</DialogTitle>
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
            value={description}
            onChange={(e) => { setDescription(e.target.value); }}
          />
          <TextField
            margin="dense"
            label="MIME Type"
            fullWidth
            value={mimeType}
            onChange={(e) => { setMimeType(e.target.value); }}
          />
          <TextField
            margin="dense"
            label="Content"
            fullWidth
            multiline
            rows={12}
            value={content}
            onChange={(e) => { setContent(e.target.value); }}
            disabled={editingId != null && isDetailLoading}
            placeholder={editingId != null && isDetailLoading ? 'Loading content...' : ''}
            sx={{ fontFamily: 'monospace' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || createResource.isPending || updateResource.isPending}
          >
            {editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
