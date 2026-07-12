// ===========================================
// Configuration Map Page
// ===========================================
// Table with category/name/value, category filter tabs, create/edit dialog.

import { useState, useMemo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
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
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  useConfigMap,
  useUpsertConfigMapEntry,
  useDeleteConfigMapEntry,
} from '../hooks/use-config-map.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';

export function ConfigMapPage(): ReactNode {
  const { data: entries, isLoading, error } = useConfigMap();
  const upsertMutation = useUpsertConfigMapEntry();
  const deleteMutation = useDeleteConfigMapEntry();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ category: string; name: string } | null>(null);
  const [formCategory, setFormCategory] = useState('');
  const [formName, setFormName] = useState('');
  const [formValue, setFormValue] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<{ category: string; name: string } | null>(null);
  const { has } = usePermissions();
  const canWrite = has(PERMISSION.CONFIG_MAP_WRITE);

  const categories = useMemo(() => {
    if (!entries) return [];
    const unique = new Set<string>();
    for (const e of entries) unique.add(e.category);
    return [...unique].sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    if (selectedCategory === 'all') return entries;
    return entries.filter((e) => e.category === selectedCategory);
  }, [entries, selectedCategory]);

  const handleOpenCreate = (): void => {
    setEditing(null);
    setFormCategory('');
    setFormName('');
    setFormValue('');
    setDialogOpen(true);
  };

  const handleOpenEdit = (category: string, name: string, value: string | null): void => {
    setEditing({ category, name });
    setFormCategory(category);
    setFormName(name);
    setFormValue(value ?? '');
    setDialogOpen(true);
  };

  const handleSave = (): void => {
    const category = editing?.category ?? formCategory;
    const name = editing?.name ?? formName;
    if (!category.trim() || !name.trim()) return;

    upsertMutation.mutate({ category: category.trim(), name: name.trim(), value: formValue }, {
      onSuccess: () => setDialogOpen(false),
    });
  };

  const handleConfirmDelete = (): void => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget);
    setDeleteTarget(null);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Configuration Map
        </Typography>
        <Tooltip title={canWrite ? '' : 'Requires config_map:write permission'}>
          <span>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate} disabled={!canWrite}>
              Add Entry
            </Button>
          </span>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load configuration map: {error.message}
        </Alert>
      )}

      {/* Category filter tabs */}
      {categories.length > 0 && (
        <Tabs
          value={selectedCategory}
          onChange={(_, v: string) => setSelectedCategory(v)}
          sx={{ mb: 2 }}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="All" value="all" />
          {categories.map((cat) => (
            <Tab key={cat} label={cat} value={cat} />
          ))}
        </Tabs>
      )}

      <Paper>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Value</TableCell>
                <TableCell width={96} />
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No configuration entries.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) => (
                  <TableRow key={`${entry.category}/${entry.name}`} hover>
                    <TableCell>
                      <Chip label={entry.category} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500 }}>{entry.name}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.value}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={canWrite ? 'Edit' : 'Requires config_map:write permission'}>
                        <span>
                          <IconButton size="small" onClick={() => handleOpenEdit(entry.category, entry.name, entry.value)} disabled={!canWrite}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={canWrite ? 'Delete' : 'Requires config_map:write permission'}>
                        <span>
                          <IconButton size="small" color="error" onClick={() => setDeleteTarget({ category: entry.category, name: entry.name })} disabled={!canWrite}>
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
        <DialogTitle>{editing ? 'Edit Entry' : 'Add Entry'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Category"
            fullWidth
            margin="normal"
            value={formCategory}
            onChange={(e) => setFormCategory(e.target.value)}
            disabled={editing !== null}
          />
          <TextField
            label="Name"
            fullWidth
            margin="normal"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            disabled={editing !== null}
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
            disabled={upsertMutation.isPending || !(editing?.category ?? formCategory.trim()) || !(editing?.name ?? formName.trim())}
          >
            {upsertMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Entry"
        message={`Delete "${deleteTarget?.category ?? ''}/${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        severity="error"
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
