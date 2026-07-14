// ===========================================
// Collections Page
// ===========================================
// Manage collections: define name/indexed fields/TTL, browse stored records.
// Collections are the keyed record store channel scripts read/write via
// getCollection(). See docs/design/10-collections.md.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
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
import StorageIcon from '@mui/icons-material/Storage';
import ViewListIcon from '@mui/icons-material/ViewList';
import {
  useCollections,
  useCollectionRecords,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  type CollectionSummary,
} from '../hooks/use-collections.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import { formatTtl, parseFields } from '../lib/collections.js';

export function CollectionsPage(): ReactNode {
  const { data: collections, isLoading, error, isFetching, refetch } = useCollections();
  const createCollection = useCreateCollection();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fieldsInput, setFieldsInput] = useState('');
  const [ttlInput, setTtlInput] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CollectionSummary | null>(null);
  const [recordsTarget, setRecordsTarget] = useState<CollectionSummary | null>(null);

  const { has } = usePermissions();
  const canWrite = has(PERMISSION.COLLECTIONS_WRITE);
  const canDelete = has(PERMISSION.COLLECTIONS_DELETE);

  const handleOpenCreate = (): void => {
    setEditingId(null);
    setName('');
    setDescription('');
    setFieldsInput('');
    setTtlInput('');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (collection: CollectionSummary): void => {
    setEditingId(collection.id);
    setName(collection.name);
    setDescription(collection.description);
    setFieldsInput(collection.indexedFields.join(', '));
    setTtlInput(collection.defaultTtlSeconds === null ? '' : String(collection.defaultTtlSeconds));
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleClose = (): void => {
    setDialogOpen(false);
    setEditingId(null);
    setDialogError(null);
  };

  const handleSave = (): void => {
    const indexedFields = parseFields(fieldsInput);
    const trimmedTtl = ttlInput.trim();
    const defaultTtlSeconds = trimmedTtl === '' ? null : Number(trimmedTtl);
    if (defaultTtlSeconds !== null && (!Number.isInteger(defaultTtlSeconds) || defaultTtlSeconds <= 0)) {
      setDialogError('Default TTL must be a positive whole number of seconds, or blank for never.');
      return;
    }
    const onError = (err: Error): void => { setDialogError(err.message); };
    const onSuccess = (): void => { handleClose(); };

    if (editingId) {
      updateCollection.mutate({ id: editingId, input: { name, description, indexedFields, defaultTtlSeconds } }, { onSuccess, onError });
    } else {
      createCollection.mutate({ name, description, indexedFields, defaultTtlSeconds }, { onSuccess, onError });
    }
  };

  const handleConfirmDelete = (): void => {
    if (!deleteTarget) return;
    deleteCollection.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <Box>
      <PageHeader
        title="Collections"
        description="Durable keyed record stores that channel scripts read and write via getCollection()."
        isFetching={isFetching && !isLoading}
        actions={
          <Tooltip title={canWrite ? '' : 'Requires collections:write permission'}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate} disabled={!canWrite}>
                Create Collection
              </Button>
            </span>
          </Tooltip>
        }
      />

      {error && (
        <ErrorState title="Couldn't load collections" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Indexed Fields</TableCell>
              <TableCell>Default TTL</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={6} columns={5} />
            ) : collections && collections.length > 0 ? (
              collections.map((collection) => (
                <TableRow key={collection.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{collection.name}</Typography>
                  </TableCell>
                  <TableCell>{collection.description || '-'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      {collection.indexedFields.map((f) => (
                        <Chip key={f} label={f} size="small" variant="outlined" />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>{formatTtl(collection.defaultTtlSeconds)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="View records">
                      <IconButton aria-label="View records" size="small" onClick={() => { setRecordsTarget(collection); }}>
                        <ViewListIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={canWrite ? 'Edit' : 'Requires collections:write permission'}>
                      <span>
                        <IconButton aria-label="Edit collection" size="small" onClick={() => { handleOpenEdit(collection); }} disabled={!canWrite}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={canDelete ? 'Delete' : 'Requires collections:delete permission'}>
                      <span>
                        <IconButton aria-label="Delete collection" size="small" onClick={() => { setDeleteTarget(collection); }} disabled={!canDelete}>
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
                    icon={<StorageIcon />}
                    title="No collections yet"
                    description="Create a collection to let channels stash and look up records by key."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit Collection' : 'Create Collection'}</DialogTitle>
        <DialogContent>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <TextField autoFocus margin="dense" label="Name" fullWidth value={name} onChange={(e) => { setName(e.target.value); }} />
          <TextField margin="dense" label="Description" fullWidth value={description} onChange={(e) => { setDescription(e.target.value); }} />
          <TextField
            margin="dense"
            label="Indexed Fields"
            helperText="Comma-separated field names records can be matched/filtered on (e.g. accessionNumber, institutionName, orderControl)."
            fullWidth
            value={fieldsInput}
            onChange={(e) => { setFieldsInput(e.target.value); }}
          />
          <TextField
            margin="dense"
            label="Default TTL (seconds)"
            helperText="How long records live before pruning. Leave blank to keep forever."
            fullWidth
            type="number"
            value={ttlInput}
            onChange={(e) => { setTtlInput(e.target.value); }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || parseFields(fieldsInput).length === 0 || !canWrite || createCollection.isPending || updateCollection.isPending}
          >
            {editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <CollectionRecordsDialog collection={recordsTarget} onClose={() => { setRecordsTarget(null); }} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Collection"
        message={`Delete collection "${deleteTarget?.name ?? ''}" and all its records? This cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteCollection.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => { setDeleteTarget(null); }}
      />
    </Box>
  );
}

/** Read-only browser for the most recent records in a collection. */
function CollectionRecordsDialog({ collection, onClose }: { collection: CollectionSummary | null; onClose: () => void }): ReactNode {
  const { data: records, isLoading, error } = useCollectionRecords(collection?.id ?? '');

  return (
    <Dialog open={collection !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Records — {collection?.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}
        {isLoading ? (
          <Typography variant="body2" color="text.secondary">Loading records…</Typography>
        ) : records && records.length > 0 ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Fields</TableCell>
                  <TableCell>Payload</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Expires</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{JSON.stringify(r.fields)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.payload ?? ''}
                    </TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{r.expireAt ? new Date(r.expireAt).toLocaleString() : 'Never'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Typography variant="body2" color="text.secondary">No records stored yet.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
