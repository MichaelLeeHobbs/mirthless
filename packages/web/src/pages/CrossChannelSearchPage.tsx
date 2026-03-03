// ===========================================
// Cross-Channel Search Page
// ===========================================
// Search messages across all channels.

import { useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { MESSAGE_STATUS } from '@mirthless/core-models';
import { useCrossChannelSearch, type CrossChannelFilters } from '../hooks/use-cross-channel-search.js';
import { getStatusColor } from '../components/messages/MessageTable.js';

const STATUS_OPTIONS = Object.values(MESSAGE_STATUS);

export function CrossChannelSearchPage(): ReactNode {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  const filters: CrossChannelFilters = {
    limit,
    offset,
    ...(status ? { status } : {}),
    ...(dateFrom ? { dateFrom: new Date(dateFrom).toISOString() } : {}),
    ...(dateTo ? { dateTo: new Date(dateTo).toISOString() } : {}),
  };

  const { data: searchResult, isLoading, error } = useCrossChannelSearch(filters);

  const handlePageChange = useCallback((_event: unknown, page: number) => {
    setOffset(page * limit);
  }, [limit]);

  const handleRowsPerPageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setLimit(Number(event.target.value));
    setOffset(0);
  }, []);

  return (
    <Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 600, mb: 3 }}>
        Messages
      </Typography>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={status}
              label="Status"
              onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
              size="small"
            >
              <MenuItem value="">All</MenuItem>
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="From"
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <TextField
            label="To"
            type="datetime-local"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
      </Paper>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to search messages: {error.message}
        </Alert>
      ) : null}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Channel</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Received</TableCell>
                  <TableCell>Processed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {searchResult?.items.map((item) => (
                  <TableRow key={`${item.channelId}-${String(item.messageId)}`} hover>
                    <TableCell>{item.messageId}</TableCell>
                    <TableCell>
                      <Link
                        component="button"
                        variant="body2"
                        onClick={() => { navigate(`/channels/${item.channelId}/messages`); }}
                        sx={{ textDecoration: 'none' }}
                      >
                        {item.channelName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {item.status ? (
                        <Chip label={item.status} color={getStatusColor(item.status ?? '')} size="small" variant="outlined" />
                      ) : '-'}
                    </TableCell>
                    <TableCell>{new Date(item.receivedAt).toLocaleString()}</TableCell>
                    <TableCell>{item.processed ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                ))}
                {(!searchResult?.items || searchResult.items.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No messages found
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={searchResult?.total ?? 0}
            page={Math.floor(offset / limit)}
            onPageChange={handlePageChange}
            rowsPerPage={limit}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Paper>
      )}
    </Box>
  );
}
