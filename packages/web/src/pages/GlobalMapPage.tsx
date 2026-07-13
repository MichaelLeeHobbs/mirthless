// ===========================================
// Global Map Page
// ===========================================
// Key-value table for the persistent global map store.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import StorageIcon from '@mui/icons-material/Storage';
import {
  useGlobalMap,
  useUpsertGlobalMapEntry,
  useDeleteGlobalMapEntry,
  useClearGlobalMap,
} from '../hooks/use-global-map.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';

export function GlobalMapPage(): ReactNode {
  const { data: entries, isLoading, isFetching, error, refetch } = useGlobalMap();
  const upsertMutation = useUpsertGlobalMapEntry();
  const deleteMutation = useDeleteGlobalMapEntry();
  const clearMutation = useClearGlobalMap();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formKey, setFormKey] = useState('');
  const [formValue, setFormValue] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { has } = usePermissions();
  const canWrite = has(PERMISSION.GLOBAL_MAP_WRITE);

  const handleOpenCreate = (): void => {
    setEditingKey(null);
    setFormKey('');
    setFormValue('');
    setDialogOpen(true);
  };

  const handleOpenEdit = (key: string, value: string | null): void => {
    setEditingKey(key);
    setFormKey(key);
    setFormValue(value ?? '');
    setDialogOpen(true);
  };

  const handleSave = (): void => {
    const key = editingKey ?? formKey;
    if (!key.trim()) return;

    upsertMutation.mutate({ key: key.trim(), value: formValue }, {
      onSuccess: () => setDialogOpen(false),
    });
  };

  const handleConfirmDelete = (): void => {
    if (deleteTarget === null) return;
    deleteMutation.mutate(deleteTarget);
    setDeleteTarget(null);
  };

  const handleClearAll = (): void => {
    clearMutation.mutate(undefined, {
      onSuccess: () => setConfirmClear(false),
    });
  };

  return (
    <Box>
      <PageHeader
        title="Global Map"
        description="Persistent key-value store shared across all channels at runtime."
        isFetching={isFetching && !isLoading}
        actions={
          <>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={() => setConfirmClear(true)}
              disabled={!entries || entries.length === 0 || !canWrite}
            >
              Clear All
            </Button>
            <Tooltip title={canWrite ? '' : 'Requires global_map:write permission'}>
              <span>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate} disabled={!canWrite}>
                  Add Entry
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />

      {error ? (
        <ErrorState
          title="Couldn't load global map"
          error={error}
          onRetry={() => void refetch()}
          sx={{ mb: 2 }}
        />
      ) : null}

      <Paper>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>Value</TableCell>
                <TableCell>Updated At</TableCell>
                <TableCell width={96} />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={4} />
              ) : !entries || entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} sx={{ border: 0 }}>
                    <EmptyState
                      dense
                      icon={<StorageIcon />}
                      title="No global map entries"
                      description={canWrite ? 'Add an entry to share state across your channels at runtime.' : 'No global map entries have been set yet.'}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.key} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500 }}>{entry.key}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.value}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {new Date(entry.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={canWrite ? 'Edit' : 'Requires global_map:write permission'}>
                        <span>
                          <IconButton aria-label="Edit entry" size="small" onClick={() => handleOpenEdit(entry.key, entry.value)} disabled={!canWrite}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={canWrite ? 'Delete' : 'Requires global_map:write permission'}>
                        <span>
                          <IconButton aria-label="Delete entry" size="small" color="error" onClick={() => setDeleteTarget(entry.key)} disabled={!canWrite}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingKey ? 'Edit Entry' : 'Add Entry'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Key"
            fullWidth
            margin="normal"
            value={formKey}
            onChange={(e) => setFormKey(e.target.value)}
            disabled={editingKey !== null}
          />
          <TextField
            label="Value"
            fullWidth
            margin="normal"
            multiline
            minRows={3}
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={upsertMutation.isPending || !(editingKey ?? formKey.trim())}
          >
            {upsertMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Clear Dialog */}
      <ConfirmDialog
        open={confirmClear}
        title="Clear All Entries?"
        message="This will permanently delete all global map entries. This action cannot be undone."
        severity="error"
        confirmLabel="Clear All"
        isPending={clearMutation.isPending}
        onConfirm={handleClearAll}
        onCancel={() => setConfirmClear(false)}
      />

      {/* Confirm Single Delete Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Entry"
        message={`Delete global map entry "${deleteTarget ?? ''}"? This cannot be undone.`}
        severity="error"
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
