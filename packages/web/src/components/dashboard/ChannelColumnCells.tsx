// ===========================================
// Dashboard Channel Column Cells
// ===========================================
// Renders the configurable (config + stat) columns for a channel row and for a
// group-total row, shared by the flat and grouped dashboard tables so column
// visibility behaves identically in both.

import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import { DASHBOARD_COLUMNS, connectorLabel, type DashboardColumnId } from '../../lib/dashboard-columns.js';

export interface ChannelCellRow {
  readonly channelId: string;
  readonly channelName: string;
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

export interface GroupTotals {
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

/** Compact relative-time label, e.g. "just now", "3m", "2h", "5d", or a date. */
function formatUpdated(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function visibleCols(visible: ReadonlySet<DashboardColumnId>): readonly typeof DASHBOARD_COLUMNS[number][] {
  return DASHBOARD_COLUMNS.filter((c) => visible.has(c.id));
}

/** Body cells for a single channel row (config + stat columns). */
export function ChannelBodyCells({ row, visible }: { row: ChannelCellRow; visible: ReadonlySet<DashboardColumnId> }): ReactNode {
  const navigate = useNavigate();

  const render = (id: DashboardColumnId): ReactNode => {
    switch (id) {
      case 'source':
        return <Chip label={connectorLabel(row.sourceConnectorType)} size="small" variant="outlined" />;
      case 'dataTypes':
        return <Typography variant="caption">{row.inboundDataType} &rarr; {row.outboundDataType}</Typography>;
      case 'rev':
        return row.revision;
      case 'updated':
        return <Tooltip title={new Date(row.updatedAt).toLocaleString()}><Typography variant="caption">{formatUpdated(row.updatedAt)}</Typography></Tooltip>;
      case 'received': return row.received.toLocaleString();
      case 'filtered': return row.filtered.toLocaleString();
      case 'sent': return row.sent.toLocaleString();
      case 'errored':
        return row.errored > 0 ? (
          <Tooltip title="View errored messages">
            <Link
              component="button"
              variant="body2"
              underline="hover"
              onClick={(e) => { e.stopPropagation(); navigate(`/channels/${row.channelId}/messages?status=ERROR`); }}
              aria-label={`View ${String(row.errored)} errored messages for ${row.channelName}`}
              sx={{ color: 'error.main', fontWeight: 600 }}
            >
              {row.errored.toLocaleString()}
            </Link>
          </Tooltip>
        ) : row.errored.toLocaleString();
      case 'queued': return row.queued.toLocaleString();
      default: return null;
    }
  };

  return (
    <>
      {visibleCols(visible).map((c) => (
        <TableCell
          key={c.id}
          align={c.align}
          sx={c.id === 'errored' && row.errored > 0 ? { color: 'error.main' } : c.id === 'queued' && row.queued > 0 ? { color: 'warning.main' } : {}}
        >
          {render(c.id)}
        </TableCell>
      ))}
    </>
  );
}

/** Aggregate cells for a group header row — numeric totals, blanks for config columns. */
export function GroupTotalCells({ totals, visible }: { totals: GroupTotals; visible: ReadonlySet<DashboardColumnId> }): ReactNode {
  return (
    <>
      {visibleCols(visible).map((c) => {
        if (!c.numeric) return <TableCell key={c.id} align={c.align} />;
        const value = totals[c.id as keyof GroupTotals];
        return (
          <TableCell
            key={c.id}
            align={c.align}
            sx={c.id === 'errored' && value > 0 ? { color: 'error.main' } : c.id === 'queued' && value > 0 ? { color: 'warning.main' } : {}}
          >
            {value.toLocaleString()}
          </TableCell>
        );
      })}
    </>
  );
}

/** Header count for how many configurable columns are visible (for colSpan math). */
export function visibleColumnCount(visible: ReadonlySet<DashboardColumnId>): number {
  return visibleCols(visible).length;
}
