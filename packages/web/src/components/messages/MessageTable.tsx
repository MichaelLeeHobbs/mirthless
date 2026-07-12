// ===========================================
// Message Table
// ===========================================
// Server-side paginated table of messages with row selection.

import type { ReactNode } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import Paper from '@mui/material/Paper';
import Checkbox from '@mui/material/Checkbox';
import { MessageStatusChip } from '../common/StatusChip.js';
import { EmptyState } from '../common/states/EmptyState.js';
import InboxIcon from '@mui/icons-material/Inbox';
import type { MessageSummary } from '../../hooks/use-messages.js';

interface MessageTableProps {
  readonly items: readonly MessageSummary[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly selectedId: number | null;
  readonly onSelect: (messageId: number) => void;
  readonly onPageChange: (offset: number) => void;
  readonly onLimitChange: (limit: number) => void;
  readonly checkedIds: ReadonlySet<number>;
  readonly onToggleChecked: (messageId: number) => void;
  readonly onToggleCheckedAll: () => void;
}

function getWorstStatus(connectors: readonly { readonly status: string }[]): string {
  if (connectors.some(c => c.status === 'ERROR')) return 'ERROR';
  if (connectors.some(c => c.status === 'QUEUED')) return 'QUEUED';
  if (connectors.some(c => c.status === 'FILTERED')) return 'FILTERED';
  if (connectors.every(c => c.status === 'SENT')) return 'SENT';
  return connectors[0]?.status ?? 'PENDING';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(receivedAt: string, processedAt: string | null): string {
  if (!processedAt) return '-';
  const ms = new Date(processedAt).getTime() - new Date(receivedAt).getTime();
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function MessageTable({
  items,
  total,
  limit,
  offset,
  selectedId,
  onSelect,
  onPageChange,
  onLimitChange,
  checkedIds,
  onToggleChecked,
  onToggleCheckedAll,
}: MessageTableProps): ReactNode {
  const page = Math.floor(offset / limit);
  const allChecked = items.length > 0 && items.every((m) => checkedIds.has(m.messageId));
  const someChecked = items.some((m) => checkedIds.has(m.messageId));

  return (
    <Paper>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allChecked}
                  indeterminate={!allChecked && someChecked}
                  onChange={onToggleCheckedAll}
                  inputProps={{ 'aria-label': 'Select all messages on this page' }}
                />
              </TableCell>
              <TableCell width={80}>Message ID</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Received</TableCell>
              <TableCell align="right">Duration</TableCell>
              <TableCell align="right">Connectors</TableCell>
              <TableCell align="right">Send Attempts</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ border: 0 }}>
                  <EmptyState
                    dense
                    icon={<InboxIcon />}
                    title="No messages"
                    description="No messages match the current filters yet."
                  />
                </TableCell>
              </TableRow>
            ) : (
              items.map((msg) => {
                const worstStatus = getWorstStatus(msg.connectors);
                const totalAttempts = msg.connectors.reduce((sum, c) => sum + c.sendAttempts, 0);

                return (
                  <TableRow
                    key={msg.messageId}
                    hover
                    selected={selectedId === msg.messageId}
                    onClick={() => onSelect(msg.messageId)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={checkedIds.has(msg.messageId)}
                        onClick={(e) => { e.stopPropagation(); }}
                        onChange={() => onToggleChecked(msg.messageId)}
                        inputProps={{ 'aria-label': `Select message ${String(msg.messageId)}` }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontFamily: (t) => t.palette.fontFamilyMono, fontSize: '0.8125rem' }}>{msg.messageId}</TableCell>
                    <TableCell>
                      <MessageStatusChip status={worstStatus} />
                    </TableCell>
                    <TableCell>{formatTime(msg.receivedAt)}</TableCell>
                    <TableCell align="right">{formatDuration(msg.receivedAt, msg.processedAt)}</TableCell>
                    <TableCell align="right">{msg.connectors.length}</TableCell>
                    <TableCell align="right">{totalAttempts}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_e, newPage) => onPageChange(newPage * limit)}
        rowsPerPage={limit}
        onRowsPerPageChange={(e) => onLimitChange(Number(e.target.value))}
        rowsPerPageOptions={[25, 50, 100]}
      />
    </Paper>
  );
}
