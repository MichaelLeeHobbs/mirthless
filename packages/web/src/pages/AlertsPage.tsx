// ===========================================
// Alerts Page
// ===========================================
// Alert management: list, enable/disable, delete.

import { useState, type ReactNode } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
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
import Link from '@mui/material/Link';
import Switch from '@mui/material/Switch';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useAlerts, useDeleteAlert, useToggleAlertEnabled } from '../hooks/use-alerts.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { humanize } from '../lib/format.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import type { AlertSummary } from '../api/client.js';

const PAGE_SIZES = [10, 25, 50] as const;

export function AlertsPage(): ReactNode {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const { data, isLoading, error, isFetching, refetch } = useAlerts(page + 1, pageSize);
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
      <PageHeader
        title="Alerts"
        description="Configure notifications for channel errors and events."
        isFetching={isFetching && !isLoading}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { navigate('/alerts/new'); }}
          >
            Create Alert
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <ErrorState title="Couldn't load alerts" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Trigger</TableCell>
              <TableCell align="center">Channels</TableCell>
              <TableCell align="center">Notifies</TableCell>
              <TableCell align="center">Enabled</TableCell>
              <TableCell align="right" aria-label="Row actions" />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={6} columns={6} />
            ) : data && data.data.length > 0 ? (
              data.data.map((alert) => (
                  <TableRow key={alert.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/alerts/${alert.id}`} underline="hover" color="text.primary" variant="body2" sx={{ fontWeight: 500, display: 'block' }}>
                        {alert.name}
                      </Link>
                      {alert.description ? (
                        <Typography variant="caption" color="text.secondary">{alert.description}</Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {humanize(alert.triggerType)}
                    </TableCell>
                    <TableCell align="center">{alert.channelCount}</TableCell>
                    <TableCell align="center">{alert.actionCount}</TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={alert.enabled}
                        onChange={() => { handleToggleEnabled(alert); }}
                        disabled={toggleEnabled.isPending}
                        inputProps={{ 'aria-label': `${alert.enabled ? 'Disable' : 'Enable'} ${alert.name}` }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton aria-label="Edit alert" size="small" onClick={() => { navigate(`/alerts/${alert.id}`); }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton aria-label="Delete alert" size="small" onClick={() => { setDeleteTarget(alert); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
            ) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    dense
                    icon={<NotificationsIcon />}
                    title="No alerts configured"
                    description="Create an alert to get notified when channel errors or events occur."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {/* A short list needs no pager; show it once there is more than one page at the smallest size. */}
        {data && data.pagination.total > PAGE_SIZES[0] ? (
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
            rowsPerPageOptions={[...PAGE_SIZES]}
          />
        ) : null}
      </TableContainer>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete alert"
        message={`Delete the alert "${deleteTarget?.name ?? ''}"? This can't be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteAlert.isPending}
        onConfirm={handleDelete}
        onCancel={() => { setDeleteTarget(null); }}
      />
    </Box>
  );
}
