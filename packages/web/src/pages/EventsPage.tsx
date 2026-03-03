// ===========================================
// Events Page
// ===========================================
// Audit log browser with filters, pagination, and detail expansion.

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
import TablePagination from '@mui/material/TablePagination';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { useEvents, usePurgeEvents } from '../hooks/use-events.js';
import { useEventExport } from '../hooks/use-event-export.js';
import { EventFilterBar, type EventFilters } from '../components/events/EventFilterBar.js';
import { EventDetailPanel } from '../components/events/EventDetailPanel.js';
import type { EventSummary } from '../api/client.js';

const LEVEL_COLORS: Record<string, 'info' | 'warning' | 'error'> = {
  INFO: 'info',
  WARN: 'warning',
  ERROR: 'error',
};

const OUTCOME_COLORS: Record<string, 'success' | 'error'> = {
  SUCCESS: 'success',
  FAILURE: 'error',
};

export function EventsPage(): ReactNode {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [filters, setFilters] = useState<EventFilters>({ level: '', name: '', outcome: '' });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [purgeDays, setPurgeDays] = useState('90');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');

  const queryParams = {
    page: page + 1,
    pageSize,
    ...(filters.level !== '' ? { level: filters.level } : {}),
    ...(filters.name !== '' ? { name: filters.name } : {}),
    ...(filters.outcome !== '' ? { outcome: filters.outcome } : {}),
  };

  const { data, isLoading, error, isFetching } = useEvents(queryParams);
  const purgeEvents = usePurgeEvents();
  const { isExporting, error: exportError, exportEvents } = useEventExport();

  const handleToggleExpand = (event: EventSummary): void => {
    setExpandedId(expandedId === event.id ? null : event.id);
  };

  const handleExport = (): void => {
    void exportEvents({
      format: exportFormat,
      ...(filters.level !== '' ? { level: filters.level } : {}),
      ...(filters.name !== '' ? { name: filters.name } : {}),
      ...(filters.outcome !== '' ? { outcome: filters.outcome } : {}),
    });
    setExportDialogOpen(false);
  };

  const handlePurge = (): void => {
    const days = parseInt(purgeDays, 10);
    if (isNaN(days) || days < 1) return;
    purgeEvents.mutate(days, {
      onSuccess: () => { setPurgeDialogOpen(false); },
    });
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Events</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Export events">
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => { setExportDialogOpen(true); }}
              disabled={isExporting}
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </Button>
          </Tooltip>
          <Tooltip title="Purge old events">
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={() => { setPurgeDialogOpen(true); }}
            >
              Purge
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* Filters */}
      <EventFilterBar filters={filters} onFilterChange={setFilters} />

      {/* Errors */}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load events: {error.message}</Alert>}
      {exportError && <Alert severity="error" sx={{ mb: 2 }}>{exportError}</Alert>}

      {/* Loading */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Date/Time</TableCell>
                <TableCell>Level</TableCell>
                <TableCell>Event</TableCell>
                <TableCell>Outcome</TableCell>
                <TableCell>User ID</TableCell>
                <TableCell>IP Address</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data && data.data.length > 0 ? (
                data.data.map((event) => (
                  <TableRow key={event.id} hover sx={{ '& > *': { borderBottom: expandedId === event.id ? 'unset' : undefined } }}>
                    <TableCell padding="checkbox">
                      <IconButton size="small" onClick={() => { handleToggleExpand(event); }}>
                        {expandedId === event.id ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {formatDate(event.createdAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={event.level}
                        color={LEVEL_COLORS[event.level] ?? 'default'}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                        {event.name.replace(/_/g, ' ')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={event.outcome}
                        color={OUTCOME_COLORS[event.outcome] ?? 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                        {event.userId ? `${event.userId.slice(0, 8)}...` : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                        {event.ipAddress ?? '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                      No events recorded
                    </Typography>
                  </TableCell>
                </TableRow>
              )}

              {/* Expanded Detail Row */}
              {data?.data.map((event) => (
                <TableRow key={`detail-${String(event.id)}`}>
                  <TableCell colSpan={7} sx={{ py: 0, borderBottom: expandedId === event.id ? undefined : 'none' }}>
                    <Collapse in={expandedId === event.id} timeout="auto" unmountOnExit>
                      <EventDetailPanel eventId={event.id} />
                    </Collapse>
                  </TableCell>
                </TableRow>
              ))}
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
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          ) : null}
        </TableContainer>
      )}

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onClose={() => { setExportDialogOpen(false); }}>
        <DialogTitle>Export Events</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Export audit events to a file. Current filters will be applied to the export.
          </DialogContentText>
          <FormControl fullWidth size="small">
            <InputLabel>Format</InputLabel>
            <Select
              value={exportFormat}
              label="Format"
              onChange={(e: SelectChangeEvent) => { setExportFormat(e.target.value as 'csv' | 'json'); }}
            >
              <MenuItem value="csv">CSV</MenuItem>
              <MenuItem value="json">JSON</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setExportDialogOpen(false); }}>Cancel</Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Purge Dialog */}
      <Dialog open={purgeDialogOpen} onClose={() => { setPurgeDialogOpen(false); }}>
        <DialogTitle>Purge Old Events</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Delete all events older than the specified number of days. This action cannot be undone.
          </DialogContentText>
          <TextField
            autoFocus
            label="Days"
            type="number"
            fullWidth
            value={purgeDays}
            onChange={(e) => { setPurgeDays(e.target.value); }}
            slotProps={{ htmlInput: { min: 1 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setPurgeDialogOpen(false); }}>Cancel</Button>
          <Button
            color="error"
            onClick={handlePurge}
            disabled={purgeEvents.isPending}
          >
            {purgeEvents.isPending ? 'Purging...' : 'Purge'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
