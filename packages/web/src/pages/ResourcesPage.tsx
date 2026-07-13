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
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderIcon from '@mui/icons-material/Folder';
import {
  useResources,
  useResource,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
  type ResourceSummary,
} from '../hooks/use-resources.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResourcesPage(): ReactNode {
  const { data: resources, isLoading, error, isFetching, refetch } = useResources();
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
  const [dirty, setDirty] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResourceSummary | null>(null);
  const { has } = usePermissions();
  const canWrite = has(PERMISSION.RESOURCES_WRITE);
  const canDelete = has(PERMISSION.RESOURCES_DELETE);

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
    setDirty(false);
    setDialogOpen(true);
  };

  const handleOpenEdit = (resource: ResourceSummary): void => {
    setEditingId(resource.id);
    setName(resource.name);
    setDescription(resource.description ?? '');
    setMimeType(resource.mimeType ?? 'text/plain');
    setContent('');
    setDialogError(null);
    setDirty(false);
    setDialogOpen(true);
  };

  const handleClose = (): void => {
    setDialogOpen(false);
    setEditingId(null);
    setDialogError(null);
    setDirty(false);
  };

  // Guard against losing unsaved edits when closing/cancelling the dialog.
  const handleRequestClose = (): void => {
    if (dirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    handleClose();
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

  const handleConfirmDelete = (): void => {
    if (!deleteTarget) return;
    deleteResource.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <Box>
      <PageHeader
        title="Resources"
        description="Shared files and libraries available to channel scripts."
        isFetching={isFetching && !isLoading}
        actions={
          <Tooltip title={canWrite ? '' : 'Requires resources:write permission'}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate} disabled={!canWrite}>
                Create Resource
              </Button>
            </span>
          </Tooltip>
        }
      />

      {error && (
        <ErrorState title="Couldn't load resources" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      )}

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
            {isLoading ? (
              <TableSkeleton rows={6} columns={5} />
            ) : resources && resources.length > 0 ? (
              resources.map((resource) => (
                  <TableRow key={resource.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{resource.name}</Typography>
                    </TableCell>
                    <TableCell>{resource.description || '-'}</TableCell>
                    <TableCell>{resource.mimeType || '-'}</TableCell>
                    <TableCell align="right">{formatBytes(resource.sizeBytes)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={canWrite ? 'Edit' : 'Requires resources:write permission'}>
                        <span>
                          <IconButton aria-label="Edit resource" size="small" onClick={() => { handleOpenEdit(resource); }} disabled={!canWrite}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={canDelete ? 'Delete' : 'Requires resources:delete permission'}>
                        <span>
                          <IconButton aria-label="Delete resource" size="small" onClick={() => { setDeleteTarget(resource); }} disabled={!canDelete}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
            ) : (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    dense
                    icon={<FolderIcon />}
                    title="No resources yet"
                    description="Create a resource to share files or libraries with your channel scripts."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={handleRequestClose} maxWidth="md" fullWidth>
        <DialogTitle>{editingId ? 'Edit Resource' : 'Create Resource'}</DialogTitle>
        <DialogContent>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
          />
          <TextField
            margin="dense"
            label="Description"
            fullWidth
            value={description}
            onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
          />
          <TextField
            margin="dense"
            label="MIME Type"
            fullWidth
            value={mimeType}
            onChange={(e) => { setMimeType(e.target.value); setDirty(true); }}
          />
          <TextField
            margin="dense"
            label="Content"
            fullWidth
            multiline
            rows={12}
            value={content}
            onChange={(e) => { setContent(e.target.value); setDirty(true); }}
            disabled={editingId != null && isDetailLoading}
            placeholder={editingId != null && isDetailLoading ? 'Loading content...' : ''}
            sx={{ fontFamily: 'monospace' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRequestClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || !canWrite || createResource.isPending || updateResource.isPending}
          >
            {editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscardOpen}
        title="Unsaved Changes"
        message="You have unsaved changes to this resource. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        severity="warning"
        onConfirm={() => { setConfirmDiscardOpen(false); handleClose(); }}
        onCancel={() => { setConfirmDiscardOpen(false); }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Resource"
        message={`Delete resource "${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteResource.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => { setDeleteTarget(null); }}
      />
    </Box>
  );
}
