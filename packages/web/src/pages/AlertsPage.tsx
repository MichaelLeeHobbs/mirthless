// ===========================================
// Alerts Page
// ===========================================
// Alert management: list, enable/disable, delete.

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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
import TablePagination from '@mui/material/TablePagination';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useAlerts, useDeleteAlert, useToggleAlertEnabled } from '../hooks/use-alerts.js';
import type { AlertSummary } from '../api/client.js';

export function AlertsPage(): ReactNode {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const { data, isLoading, error, isFetching } = useAlerts(page + 1, pageSize);
  const deleteAlert = useDeleteAlert();
  const toggleEnabled = useToggleAlertEnabled();

  const [deleteTarget, setDeleteTarget] = useState<AlertSummary | null>(null);

  const handleDelete = (): void => {
    if (!deleteTarget) return;
    deleteAlert.mutate(deleteTarget.id, {
      onSuccess: () => { setDeleteTarget(null); },
    });
  };

  const handleToggleEnabled = (alert: AlertSummary): void => {
    toggleEnabled.mutate({ id: alert.id, enabled: !alert.enabled });
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Alerts</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => { navigate('/alerts/new'); }}
        >
          Create Alert
        </Button>
      </Box>

      {/* Error */}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load alerts: {error.message}</Alert>}

      {/* Loading */}
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
                <TableCell>Trigger Type</TableCell>
                <TableCell align="center">Channels</TableCell>
                <TableCell align="center">Actions</TableCell>
                <TableCell align="center">Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data && data.data.length > 0 ? (
                data.data.map((alert) => (
                  <TableRow key={alert.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{alert.name}</Typography>
                      {alert.description ? (
                        <Typography variant="caption" color="text.secondary">{alert.description}</Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip label={alert.triggerType} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="center">{alert.channelCount}</TableCell>
                    <TableCell align="center">{alert.actionCount}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={alert.enabled ? 'Enabled' : 'Disabled'}
                        color={alert.enabled ? 'success' : 'default'}
                        size="small"
                        onClick={() => { handleToggleEnabled(alert); }}
                        sx={{ cursor: 'pointer' }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => { navigate(`/alerts/${alert.id}`); }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => { setDeleteTarget(alert); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                      No alerts configured
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {data && data.pagination.total > 0 ? (
            <TablePagination
              component="div"
              count={data.pagination.total}
              page={page}
              onPageChange={(_e, newPage) => { setPage(newPage); }}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50]}
            />
          ) : null}
        </TableContainer>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteTarget !== null} onClose={() => { setDeleteTarget(null); }}>
        <DialogTitle>Delete Alert</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete alert &quot;{deleteTarget?.name}&quot;? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteTarget(null); }}>Cancel</Button>
          <Button color="error" onClick={handleDelete} disabled={deleteAlert.isPending}>
            {deleteAlert.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
