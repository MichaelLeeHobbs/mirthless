// ===========================================
// Channel Status Table
// ===========================================
// Main dashboard table showing all channels with stats and deployment state.

import { useState, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import SearchIcon from '@mui/icons-material/Search';
import CircleIcon from '@mui/icons-material/Circle';
import type { ChannelStatisticsSummary } from '../../hooks/use-statistics.js';
import type { ChannelStatus } from '../../hooks/use-deployment.js';
import { ChannelActions } from './ChannelActions.js';

interface ChannelStatusTableProps {
  readonly statistics: readonly ChannelStatisticsSummary[];
  readonly deploymentStatuses: readonly ChannelStatus[];
}

type SortField = 'channelName' | 'state' | 'received' | 'filtered' | 'sent' | 'errored' | 'queued';
type SortDir = 'asc' | 'desc';

interface ChannelRow {
  readonly channelId: string;
  readonly channelName: string;
  readonly enabled: boolean;
  readonly state: string;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

export function getStateColor(state: string): 'success' | 'warning' | 'error' | 'default' {
  switch (state) {
    case 'STARTED': return 'success';
    case 'PAUSED': return 'warning';
    case 'STOPPED': return 'error';
    default: return 'default';
  }
}

export function getStatusDotColor(state: string): string {
  switch (state) {
    case 'STARTED': return 'success.main';
    case 'PAUSED': return 'warning.main';
    case 'STOPPED': return 'error.main';
    default: return 'text.disabled';
  }
}

export function ChannelStatusTable({ statistics, deploymentStatuses }: ChannelStatusTableProps): ReactNode {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('channelName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Merge statistics and deployment statuses
  const deploymentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const status of deploymentStatuses) {
      map.set(status.channelId, status.state);
    }
    return map;
  }, [deploymentStatuses]);

  const rows: readonly ChannelRow[] = useMemo(() => {
    return statistics.map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      enabled: s.enabled,
      state: deploymentMap.get(s.channelId) ?? 'UNDEPLOYED',
      received: s.received,
      filtered: s.filtered,
      sent: s.sent,
      errored: s.errored,
      queued: s.queued,
    }));
  }, [statistics, deploymentMap]);

  // Client-side filter + sort
  const filteredRows = useMemo(() => {
    const searchLower = search.toLowerCase();
    const filtered = search.length > 0
      ? rows.filter((r) => r.channelName.toLowerCase().includes(searchLower))
      : rows;

    return [...filtered].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, search, sortField, sortDir]);

  const handleSort = (field: SortField): void => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  return (
    <Paper>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <TextField
          size="small"
          placeholder="Search channels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 280 }}
        />
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={40} />
              <TableCell>
                <TableSortLabel
                  active={sortField === 'channelName'}
                  direction={sortField === 'channelName' ? sortDir : 'asc'}
                  onClick={() => handleSort('channelName')}
                >
                  Channel Name
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'state'}
                  direction={sortField === 'state' ? sortDir : 'asc'}
                  onClick={() => handleSort('state')}
                >
                  State
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'received'}
                  direction={sortField === 'received' ? sortDir : 'asc'}
                  onClick={() => handleSort('received')}
                >
                  Received
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'filtered'}
                  direction={sortField === 'filtered' ? sortDir : 'asc'}
                  onClick={() => handleSort('filtered')}
                >
                  Filtered
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'sent'}
                  direction={sortField === 'sent' ? sortDir : 'asc'}
                  onClick={() => handleSort('sent')}
                >
                  Sent
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'errored'}
                  direction={sortField === 'errored' ? sortDir : 'asc'}
                  onClick={() => handleSort('errored')}
                >
                  Errored
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'queued'}
                  direction={sortField === 'queued' ? sortDir : 'asc'}
                  onClick={() => handleSort('queued')}
                >
                  Queued
                </TableSortLabel>
              </TableCell>
              <TableCell width={48} />
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {search.length > 0 ? 'No channels match your search.' : 'No channels configured.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow key={row.channelId} hover>
                  <TableCell>
                    <CircleIcon sx={{ fontSize: 12, color: getStatusDotColor(row.state) }} />
                  </TableCell>
                  <TableCell>
                    <Link
                      component="button"
                      variant="body2"
                      underline="hover"
                      onClick={() => navigate(`/channels/${row.channelId}`)}
                      sx={{ fontWeight: 500 }}
                    >
                      {row.channelName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.state}
                      size="small"
                      color={getStateColor(row.state)}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">{row.received.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.filtered.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.sent.toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ color: row.errored > 0 ? 'error.main' : undefined }}>
                    {row.errored.toLocaleString()}
                  </TableCell>
                  <TableCell align="right" sx={{ color: row.queued > 0 ? 'warning.main' : undefined }}>
                    {row.queued.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <ChannelActions channelId={row.channelId} state={row.state === 'UNDEPLOYED' ? undefined : row.state} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
