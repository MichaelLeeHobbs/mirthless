// ===========================================
// Cross-Channel Message Results Table
// ===========================================
// Shared table for the Traffic view's triage feed and search results.

import { type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { HIDE_ON_PHONE } from '../../lib/responsive.js';
import ReplayIcon from '@mui/icons-material/Replay';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import { MessageStatusChip } from '../common/StatusChip.js';
import { EmptyState } from '../common/states/EmptyState.js';
import { TableSkeleton } from '../common/states/LoadingState.js';
import type { CrossChannelSearchItem } from '../../hooks/use-cross-channel-search.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';

interface MessageResultsTableProps {
  readonly items: readonly CrossChannelSearchItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly isLoading: boolean;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly onPageChange: (page: number) => void;
  readonly onRowsPerPageChange: (rows: number) => void;
  /** When set, each row gets a Reprocess action calling this. */
  readonly onReprocess?: ((channelId: string, messageId: number) => void) | undefined;
  readonly reprocessingKey?: string | null | undefined;
}

export function MessageResultsTable({
  items, total, limit, offset, isLoading, emptyTitle, emptyDescription,
  onPageChange, onRowsPerPageChange, onReprocess, reprocessingKey,
}: MessageResultsTableProps): ReactNode {
  const navigate = useNavigate();
  const isPhone = useMediaQuery(useTheme().breakpoints.down('sm'));
  const showActions = Boolean(onReprocess);
  const colCount = showActions ? 7 : 6;

  return (
    <Paper>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Channel</TableCell>
              <TableCell sx={HIDE_ON_PHONE}>Connector</TableCell>
              <TableCell>Status</TableCell>
              <TableCell sx={HIDE_ON_PHONE}>Received</TableCell>
              <TableCell sx={HIDE_ON_PHONE}>Processed</TableCell>
              {showActions ? <TableCell align="right">Actions</TableCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={6} columns={colCount} />
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} sx={{ border: 0 }}>
                  <EmptyState dense icon={<SearchOffIcon />} title={emptyTitle} description={emptyDescription} />
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const key = `${item.channelId}-${String(item.messageId)}`;
                return (
                  <TableRow key={key} hover>
                    <TableCell sx={{ fontFamily: FONT_FAMILY_MONO, fontSize: '0.8125rem' }}>{item.messageId}</TableCell>
                    <TableCell>
                      <Link component="button" variant="body2" onClick={() => { navigate(`/channels/${item.channelId}/messages`); }} sx={{ textDecoration: 'none' }}>
                        {item.channelName}
                      </Link>
                    </TableCell>
                    <TableCell sx={HIDE_ON_PHONE}>{item.connectorName ?? '-'}</TableCell>
                    <TableCell>{item.status ? <MessageStatusChip status={item.status} /> : '-'}</TableCell>
                    <TableCell sx={HIDE_ON_PHONE}>{new Date(item.receivedAt).toLocaleString()}</TableCell>
                    <TableCell sx={HIDE_ON_PHONE}>{item.processed ? 'Yes' : 'No'}</TableCell>
                    {showActions ? (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {isPhone ? (
                          <>
                            <Tooltip title="Open in the channel message browser">
                              <IconButton size="small" aria-label="Open" onClick={() => { navigate(`/channels/${item.channelId}/messages?status=ERROR`); }}>
                                <OpenInNewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Reprocess this message">
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label="Reprocess"
                                  disabled={reprocessingKey === key}
                                  onClick={() => { onReprocess?.(item.channelId, item.messageId); }}
                                >
                                  <ReplayIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </>
                        ) : (
                          <>
                            <Tooltip title="Open in the channel message browser">
                              <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => { navigate(`/channels/${item.channelId}/messages?status=ERROR`); }}>
                                Open
                              </Button>
                            </Tooltip>
                            <Tooltip title="Reprocess this message">
                              <span>
                                <Button
                                  size="small"
                                  startIcon={<ReplayIcon />}
                                  disabled={reprocessingKey === key}
                                  onClick={() => { onReprocess?.(item.channelId, item.messageId); }}
                                >
                                  Reprocess
                                </Button>
                              </span>
                            </Tooltip>
                          </>
                        )}
                      </TableCell>
                    ) : null}
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
        page={limit > 0 ? Math.floor(offset / limit) : 0}
        onPageChange={(_e, page) => { onPageChange(page); }}
        rowsPerPage={limit}
        onRowsPerPageChange={(e) => { onRowsPerPageChange(Number(e.target.value)); }}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </Paper>
  );
}
