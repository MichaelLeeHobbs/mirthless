// ===========================================
// Channel Status Table
// ===========================================
// Main dashboard table showing all channels with stats and deployment state.
// Columns (beyond Name + State) are per-user configurable.

import { useState, useMemo, useCallback, type ReactNode } from 'react';
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
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import SearchIcon from '@mui/icons-material/Search';
import BarChartIcon from '@mui/icons-material/BarChart';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Checkbox from '@mui/material/Checkbox';
import type { ChannelStatisticsSummary } from '../../hooks/use-statistics.js';
import type { ChannelStatus } from '../../hooks/use-deployment.js';
import type { TagSummary } from '../../hooks/use-tags.js';
import { TagChips } from '../common/TagChips.js';
import { ChannelActions } from './ChannelActions.js';
import { ChannelContextMenu } from '../common/ChannelContextMenu.js';
import { AssignGroupDialog } from '../common/AssignGroupDialog.js';
import { ChannelStateChip, StatusDot } from '../common/StatusChip.js';
import { channelStateLevel } from '../../lib/status.js';
import { useContextMenu } from '../../hooks/use-context-menu.js';
import { DASHBOARD_COLUMNS, connectorLabel, DEFAULT_VISIBLE_COLUMNS, type DashboardColumnId } from '../../lib/dashboard-columns.js';
import { ChannelBodyCells } from './ChannelColumnCells.js';

interface ChannelStatusTableProps {
  readonly statistics: readonly ChannelStatisticsSummary[];
  readonly deploymentStatuses: readonly ChannelStatus[];
  readonly selectedIds?: ReadonlySet<string> | undefined;
  readonly onToggleSelect?: ((id: string) => void) | undefined;
  readonly onSelectAll?: ((ids: readonly string[]) => void) | undefined;
  readonly isAllSelected?: boolean | undefined;
  readonly onSendMessage?: ((channelId: string, channelName: string) => void) | undefined;
  readonly onClone?: ((channelId: string, channelName: string) => void) | undefined;
  readonly onDelete?: ((channelId: string, channelName: string) => void) | undefined;
  readonly onExport?: ((channelId: string) => void) | undefined;
  readonly tagsByChannel?: ReadonlyMap<string, readonly TagSummary[]> | undefined;
  readonly visibleColumns?: ReadonlySet<DashboardColumnId> | undefined;
}

type SortField = 'channelName' | 'state' | DashboardColumnId;
type SortDir = 'asc' | 'desc';

interface ChannelRow {
  readonly channelId: string;
  readonly channelName: string;
  readonly enabled: boolean;
  readonly state: string;
  readonly sourceConnectorType: string;
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

const DEFAULT_VISIBLE = new Set<DashboardColumnId>(DEFAULT_VISIBLE_COLUMNS);

/** Comparable value for a sort field. */
function sortValue(row: ChannelRow, field: SortField): string | number {
  switch (field) {
    case 'channelName': return row.channelName;
    case 'state': return row.state;
    case 'source': return connectorLabel(row.sourceConnectorType);
    case 'dataTypes': return `${row.inboundDataType} ${row.outboundDataType}`;
    case 'rev': return row.revision;
    case 'updated': return new Date(row.updatedAt).getTime();
    default: return row[field];
  }
}

export function ChannelStatusTable({ statistics, deploymentStatuses, selectedIds, onToggleSelect, onSelectAll, isAllSelected, onSendMessage, onClone, onDelete, onExport, tagsByChannel, visibleColumns }: ChannelStatusTableProps): ReactNode {
  const showCheckboxes = Boolean(onToggleSelect);
  const visible = visibleColumns ?? DEFAULT_VISIBLE;
  const shownColumns = DASHBOARD_COLUMNS.filter((c) => visible.has(c.id));
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('channelName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const { menuState, menuTarget, handleContextMenu, handleClose } = useContextMenu<ChannelRow>();
  const [assignGroupTarget, setAssignGroupTarget] = useState<string | null>(null);

  const handleChangeGroup = useCallback((channelId: string): void => {
    setAssignGroupTarget(channelId);
  }, []);

  const deploymentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const status of deploymentStatuses) map.set(status.channelId, status.state);
    return map;
  }, [deploymentStatuses]);

  const rows: readonly ChannelRow[] = useMemo(() => {
    return statistics.map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      enabled: s.enabled,
      state: deploymentMap.get(s.channelId) ?? 'UNDEPLOYED',
      sourceConnectorType: s.sourceConnectorType,
      inboundDataType: s.inboundDataType,
      outboundDataType: s.outboundDataType,
      revision: s.revision,
      updatedAt: s.updatedAt,
      received: s.received,
      filtered: s.filtered,
      sent: s.sent,
      errored: s.errored,
      queued: s.queued,
    }));
  }, [statistics, deploymentMap]);

  const filteredRows = useMemo(() => {
    const searchLower = search.toLowerCase();
    const filtered = search.length > 0
      ? rows.filter((r) => r.channelName.toLowerCase().includes(searchLower))
      : rows;

    return [...filtered].sort((a, b) => {
      const aVal = sortValue(a, sortField);
      const bVal = sortValue(b, sortField);
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, search, sortField, sortDir]);

  const handleSort = (field: SortField): void => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const totalCols = (showCheckboxes ? 1 : 0) + 3 + shownColumns.length + 1;

  return (
    <Paper>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <TextField
          size="small"
          placeholder="Search channels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) } }}
          sx={{ width: 280 }}
        />
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {showCheckboxes ? (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={isAllSelected ?? false}
                    indeterminate={!isAllSelected && (selectedIds?.size ?? 0) > 0}
                    onChange={() => { if (isAllSelected) onSelectAll?.([]); else onSelectAll?.(filteredRows.map((r) => r.channelId)); }}
                  />
                </TableCell>
              ) : null}
              <TableCell width={40} />
              <TableCell>
                <TableSortLabel active={sortField === 'channelName'} direction={sortField === 'channelName' ? sortDir : 'asc'} onClick={() => handleSort('channelName')}>
                  Channel Name
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel active={sortField === 'state'} direction={sortField === 'state' ? sortDir : 'asc'} onClick={() => handleSort('state')}>
                  State
                </TableSortLabel>
              </TableCell>
              {shownColumns.map((c) => (
                <TableCell key={c.id} align={c.align}>
                  <TableSortLabel active={sortField === c.id} direction={sortField === c.id ? sortDir : 'asc'} onClick={() => handleSort(c.id)}>
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell width={48} />
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalCols} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {search.length > 0 ? 'No channels match your search.' : 'No channels configured.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow key={row.channelId} hover onContextMenu={(e) => handleContextMenu(e, row)}>
                  {showCheckboxes ? (
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={selectedIds?.has(row.channelId) ?? false} onChange={() => onToggleSelect?.(row.channelId)} />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <StatusDot level={channelStateLevel(row.state)} title={row.state} />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Link component="button" variant="body2" underline="hover" onClick={() => navigate(`/channels/${row.channelId}/messages`)} sx={{ fontWeight: 500 }}>
                        {row.channelName}
                      </Link>
                      <TagChips tags={tagsByChannel?.get(row.channelId) ?? []} />
                    </Box>
                  </TableCell>
                  <TableCell>
                    <ChannelStateChip state={row.state} />
                  </TableCell>
                  <ChannelBodyCells row={row} visible={visible} />
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Tooltip title="Statistics">
                        <IconButton size="small" aria-label={`View statistics for ${row.channelName}`} onClick={() => navigate(`/channels/${row.channelId}/statistics`)}>
                          <BarChartIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <ChannelActions channelId={row.channelId} channelName={row.channelName} state={row.state === 'UNDEPLOYED' ? undefined : row.state} onSendMessage={onSendMessage} />
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <ChannelContextMenu
        menuState={menuState}
        channelId={menuTarget?.channelId ?? null}
        channelName={menuTarget?.channelName ?? null}
        state={menuTarget === null ? null : (menuTarget.state === 'UNDEPLOYED' ? null : menuTarget.state)}
        enabled={menuTarget?.enabled}
        onClose={handleClose}
        onSendMessage={onSendMessage}
        onChangeGroup={handleChangeGroup}
        onClone={onClone}
        onDelete={onDelete}
        onExport={onExport}
      />
      {assignGroupTarget ? (
        <AssignGroupDialog open onClose={() => { setAssignGroupTarget(null); }} channelId={assignGroupTarget} />
      ) : null}
    </Paper>
  );
}
