// ===========================================
// Data Sources Page
// ===========================================
// Manage database connection profiles that channel scripts query via
// dbQuery(dataSourceName, sql, params). Passwords are write-only (never read
// back). See docs/design/11-datasources.md.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import StorageIcon from '@mui/icons-material/Storage';
import {
  useDataSources,
  useCreateDataSource,
  useUpdateDataSource,
  useDeleteDataSource,
  useTestDataSource,
  type DataSourceSummary,
} from '../hooks/use-datasources.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';

interface FormState {
  name: string;
  description: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  readOnly: boolean;
  maxConnections: string;
  statementTimeoutMs: string;
  maxRows: string;
}

const EMPTY_FORM: FormState = {
  name: '', description: '', host: '', port: '5432', database: '', user: '', password: '',
  readOnly: true, maxConnections: '5', statementTimeoutMs: '30000', maxRows: '10000',
};

export function DataSourcesPage(): ReactNode {
  const { data: sources, isLoading, error, isFetching, refetch } = useDataSources();
  const createSource = useCreateDataSource();
  const updateSource = useUpdateDataSource();
  const deleteSource = useDeleteDataSource();
  const testSource = useTestDataSource();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataSourceSummary | null>(null);

  const { has } = usePermissions();
  const canWrite = has(PERMISSION.DATASOURCES_WRITE);
  const canDelete = has(PERMISSION.DATASOURCES_DELETE);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const handleOpenCreate = (): void => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogError(null);
    setTestResult(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (s: DataSourceSummary): void => {
    setEditingId(s.id);
    setForm({
      name: s.name, description: s.description, host: s.host, port: String(s.port),
      database: s.database, user: s.user, password: '', readOnly: s.readOnly,
      maxConnections: String(s.maxConnections), statementTimeoutMs: String(s.statementTimeoutMs), maxRows: String(s.maxRows),
    });
    setDialogError(null);
    setTestResult(null);
    setDialogOpen(true);
  };

  const handleClose = (): void => {
    setDialogOpen(false);
    setEditingId(null);
    setDialogError(null);
  };

  const handleTest = (): void => {
    setTestResult(null);
    testSource.mutate(
      { host: form.host, port: Number(form.port), database: form.database, user: form.user, password: form.password },
      {
        onSuccess: (r) => { setTestResult({ ok: r.connected, message: r.connected ? 'Connected successfully.' : (r.error ?? 'Connection failed.') }); },
        onError: (e) => { setTestResult({ ok: false, message: e.message }); },
      },
    );
  };

  const handleSave = (): void => {
    setDialogError(null);
    const onError = (err: Error): void => { setDialogError(err.message); };
    const onSuccess = (): void => { handleClose(); };

    if (editingId) {
      // Omit password when left blank so the stored credential is kept.
      const input = {
        name: form.name, description: form.description, host: form.host, port: Number(form.port),
        database: form.database, user: form.user, readOnly: form.readOnly,
        maxConnections: Number(form.maxConnections), statementTimeoutMs: Number(form.statementTimeoutMs), maxRows: Number(form.maxRows),
        ...(form.password ? { password: form.password } : {}),
      };
      updateSource.mutate({ id: editingId, input }, { onSuccess, onError });
    } else {
      createSource.mutate({
        name: form.name, description: form.description, driver: 'postgres', host: form.host, port: Number(form.port),
        database: form.database, user: form.user, password: form.password, readOnly: form.readOnly,
        maxConnections: Number(form.maxConnections), statementTimeoutMs: Number(form.statementTimeoutMs), maxRows: Number(form.maxRows),
      }, { onSuccess, onError });
    }
  };

  const handleConfirmDelete = (): void => {
    if (!deleteTarget) return;
    deleteSource.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  const saveDisabled = !form.name.trim() || !form.host.trim() || !form.database.trim() || !form.user.trim()
    || (!editingId && !form.password) || !canWrite || createSource.isPending || updateSource.isPending;

  return (
    <Box>
      <PageHeader
        title="Data Sources"
        description="Database connection profiles that channel scripts query via getResource-style dbQuery(). Credentials are encrypted at rest."
        isFetching={isFetching && !isLoading}
        actions={
          <Tooltip title={canWrite ? '' : 'Requires datasources:write permission'}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate} disabled={!canWrite}>
                Create Data Source
              </Button>
            </span>
          </Tooltip>
        }
      />

      {error && <ErrorState title="Couldn't load data sources" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Connection</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} columns={5} />
            ) : sources && sources.length > 0 ? (
              sources.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell><Typography variant="body2" sx={{ fontWeight: 500 }}>{s.name}</Typography></TableCell>
                  <TableCell><Typography variant="caption">{s.host}:{s.port}/{s.database}</Typography></TableCell>
                  <TableCell>{s.user}</TableCell>
                  <TableCell>
                    <Chip
                      label={s.readOnly ? 'Read-only' : 'Read-write'}
                      size="small"
                      color={s.readOnly ? 'default' : 'warning'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={canWrite ? 'Edit' : 'Requires datasources:write permission'}>
                      <span>
                        <IconButton aria-label="Edit data source" size="small" onClick={() => { handleOpenEdit(s); }} disabled={!canWrite}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={canDelete ? 'Delete' : 'Requires datasources:delete permission'}>
                      <span>
                        <IconButton aria-label="Delete data source" size="small" onClick={() => { setDeleteTarget(s); }} disabled={!canDelete}>
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
                    title="No data sources yet"
                    description="Create a data source so channel scripts can query an external database."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit Data Source' : 'Create Data Source'}</DialogTitle>
        <DialogContent>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          {testResult && <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mb: 2 }}>{testResult.message}</Alert>}
          <TextField autoFocus margin="dense" label="Name" fullWidth value={form.name} onChange={(e) => { setField('name', e.target.value); }} />
          <TextField margin="dense" label="Description" fullWidth value={form.description} onChange={(e) => { setField('description', e.target.value); }} />
          <Stack direction="row" spacing={1}>
            <TextField margin="dense" label="Host" fullWidth value={form.host} onChange={(e) => { setField('host', e.target.value); }} />
            <TextField margin="dense" label="Port" type="number" sx={{ width: 120 }} value={form.port} onChange={(e) => { setField('port', e.target.value); }} />
          </Stack>
          <TextField margin="dense" label="Database" fullWidth value={form.database} onChange={(e) => { setField('database', e.target.value); }} />
          <TextField margin="dense" label="User" fullWidth value={form.user} onChange={(e) => { setField('user', e.target.value); }} />
          <TextField
            margin="dense"
            label={editingId ? 'Password (leave blank to keep)' : 'Password'}
            type="password"
            fullWidth
            value={form.password}
            onChange={(e) => { setField('password', e.target.value); }}
          />
          <FormControlLabel
            control={<Switch checked={form.readOnly} onChange={(e) => { setField('readOnly', e.target.checked); }} />}
            label="Read-only (recommended)"
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1}>
            <TextField margin="dense" label="Max connections" type="number" fullWidth value={form.maxConnections} onChange={(e) => { setField('maxConnections', e.target.value); }} />
            <TextField margin="dense" label="Statement timeout (ms)" type="number" fullWidth value={form.statementTimeoutMs} onChange={(e) => { setField('statementTimeoutMs', e.target.value); }} />
            <TextField margin="dense" label="Max rows" type="number" fullWidth value={form.maxRows} onChange={(e) => { setField('maxRows', e.target.value); }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleTest}
            disabled={!form.host.trim() || !form.database.trim() || !form.user.trim() || !form.password || testSource.isPending}
          >
            {testSource.isPending ? 'Testing…' : 'Test Connection'}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={saveDisabled}>
            {editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Data Source"
        message={`Delete data source "${deleteTarget?.name ?? ''}"? Channels querying it will start failing. This cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteSource.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => { setDeleteTarget(null); }}
      />
    </Box>
  );
}
