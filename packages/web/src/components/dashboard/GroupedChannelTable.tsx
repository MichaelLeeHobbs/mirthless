// ===========================================
// Grouped Channel Table
// ===========================================
// Collapsible group sections with group headers, aggregate stats,
// search/filter toolbar, and inline action buttons.

import { useState, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CircleIcon from '@mui/icons-material/Circle';
import BarChartIcon from '@mui/icons-material/BarChart';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import Tooltip from '@mui/material/Tooltip';
import type { ChannelStatisticsSummary } from '../../hooks/use-statistics.js';
import type { ChannelStatus } from '../../hooks/use-deployment.js';
import { useDeploymentAction } from '../../hooks/use-deployment.js';
import type { ChannelGroupSummary } from '../../hooks/use-channel-groups.js';
import type { GroupMembership } from '../../hooks/use-channel-groups.js';
import { ChannelActions } from './ChannelActions.js';
import { getStateColor, getStatusDotColor } from './ChannelStatusTable.js';

interface GroupedChannelTableProps {
  readonly statistics: readonly ChannelStatisticsSummary[];
  readonly deploymentStatuses: readonly ChannelStatus[];
  readonly groups: readonly ChannelGroupSummary[];
  readonly memberships: readonly GroupMembership[];
}

interface ChannelRow {
  readonly channelId: string;
  readonly channelName: string;
  readonly state: string;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

interface GroupSection {
  readonly groupId: string;
  readonly groupName: string;
  readonly channels: readonly ChannelRow[];
  readonly totals: { received: number; filtered: number; sent: number; errored: number; queued: number };
}

function sumTotals(channels: readonly ChannelRow[]): { received: number; filtered: number; sent: number; errored: number; queued: number } {
  let received = 0, filtered = 0, sent = 0, errored = 0, queued = 0;
  for (const ch of channels) {
    received += ch.received;
    filtered += ch.filtered;
    sent += ch.sent;
    errored += ch.errored;
    queued += ch.queued;
  }
  return { received, filtered, sent, errored, queued };
}

/** Inline action buttons for a channel row based on its deployment state. */
function InlineActions({ channelId, state }: { readonly channelId: string; readonly state: string }): ReactNode {
  const deployAction = useDeploymentAction();
  const isPending = deployAction.isPending;

  const handleAction = (action: 'deploy' | 'undeploy' | 'start' | 'stop' | 'pause' | 'resume'): void => {
    deployAction.mutate({ channelId, action });
  };

  if (state === 'UNDEPLOYED') {
    return (
      <Tooltip title="Deploy">
        <IconButton size="small" onClick={() => handleAction('deploy')} disabled={isPending}>
          <CloudUploadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }
  if (state === 'STOPPED') {
    return (
      <>
        <Tooltip title="Start">
          <IconButton size="small" color="success" onClick={() => handleAction('start')} disabled={isPending}>
            <PlayArrowIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Undeploy">
          <IconButton size="small" onClick={() => handleAction('undeploy')} disabled={isPending}>
            <CloudOffIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </>
    );
  }
  if (state === 'STARTED') {
    return (
      <>
        <Tooltip title="Pause">
          <IconButton size="small" color="warning" onClick={() => handleAction('pause')} disabled={isPending}>
            <PauseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Stop">
          <IconButton size="small" color="error" onClick={() => handleAction('stop')} disabled={isPending}>
            <StopIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </>
    );
  }
  if (state === 'PAUSED') {
    return (
      <>
        <Tooltip title="Resume">
          <IconButton size="small" color="success" onClick={() => handleAction('resume')} disabled={isPending}>
            <PlayArrowIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Stop">
          <IconButton size="small" color="error" onClick={() => handleAction('stop')} disabled={isPending}>
            <StopIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </>
    );
  }
  return null;
}

export function GroupedChannelTable({ statistics, deploymentStatuses, groups, memberships }: GroupedChannelTableProps): ReactNode {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');

  const toggleGroup = (groupId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // Build deployment map
  const deploymentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const status of deploymentStatuses) {
      map.set(status.channelId, status.state);
    }
    return map;
  }, [deploymentStatuses]);

  // Build channel rows from statistics
  const allRows = useMemo((): readonly ChannelRow[] => {
    return statistics.map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      state: deploymentMap.get(s.channelId) ?? 'UNDEPLOYED',
      received: s.received,
      filtered: s.filtered,
      sent: s.sent,
      errored: s.errored,
      queued: s.queued,
    }));
  }, [statistics, deploymentMap]);

  // Apply search filter
  const filteredRows = useMemo(() => {
    if (search.length === 0) return allRows;
    const lower = search.toLowerCase();
    return allRows.filter((r) => r.channelName.toLowerCase().includes(lower));
  }, [allRows, search]);

  // Build membership map: channelId -> groupId
  const channelGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of memberships) {
      map.set(m.channelId, m.channelGroupId);
    }
    return map;
  }, [memberships]);

  // Build group sections
  const sections = useMemo((): readonly GroupSection[] => {
    const groupMap = new Map<string, ChannelRow[]>();
    const ungrouped: ChannelRow[] = [];

    for (const row of filteredRows) {
      const gid = channelGroupMap.get(row.channelId);
      if (gid) {
        const list = groupMap.get(gid);
        if (list) list.push(row);
        else groupMap.set(gid, [row]);
      } else {
        ungrouped.push(row);
      }
    }

    const result: GroupSection[] = [];
    for (const group of groups) {
      const channels = groupMap.get(group.id) ?? [];
      if (channels.length > 0) {
        result.push({
          groupId: group.id,
          groupName: group.name,
          channels,
          totals: sumTotals(channels),
        });
      }
    }

    if (ungrouped.length > 0) {
      result.push({
        groupId: '__ungrouped__',
        groupName: 'Ungrouped',
        channels: ungrouped,
        totals: sumTotals(ungrouped),
      });
    }

    return result;
  }, [filteredRows, channelGroupMap, groups]);

  return (
    <Paper>
      <Box sx={{ p: 2 }}>
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
              <TableCell width={40} />
              <TableCell>Channel Name</TableCell>
              <TableCell>State</TableCell>
              <TableCell align="right">Received</TableCell>
              <TableCell align="right">Filtered</TableCell>
              <TableCell align="right">Sent</TableCell>
              <TableCell align="right">Errored</TableCell>
              <TableCell align="right">Queued</TableCell>
              <TableCell width={120} />
            </TableRow>
          </TableHead>
          <TableBody>
            {sections.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {search.length > 0 ? 'No channels match your search.' : 'No channels configured.'}
                </TableCell>
              </TableRow>
            ) : (
              sections.map((section) => {
                const isOpen = !collapsed.has(section.groupId);
                return (
                  <Box component="tbody" key={section.groupId}>
                    {/* Group header row */}
                    <TableRow
                      sx={{ backgroundColor: 'action.hover', cursor: 'pointer' }}
                      onClick={() => toggleGroup(section.groupId)}
                    >
                      <TableCell>
                        <IconButton size="small">
                          {isOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                      </TableCell>
                      <TableCell />
                      <TableCell colSpan={2}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {section.groupName} ({section.channels.length})
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{section.totals.received.toLocaleString()}</TableCell>
                      <TableCell align="right">{section.totals.filtered.toLocaleString()}</TableCell>
                      <TableCell align="right">{section.totals.sent.toLocaleString()}</TableCell>
                      <TableCell align="right" sx={{ color: section.totals.errored > 0 ? 'error.main' : undefined }}>
                        {section.totals.errored.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ color: section.totals.queued > 0 ? 'warning.main' : undefined }}>
                        {section.totals.queued.toLocaleString()}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                    {/* Channel rows (collapsible) */}
                    <TableRow>
                      <TableCell colSpan={10} sx={{ p: 0, border: 0 }}>
                        <Collapse in={isOpen} timeout="auto" unmountOnExit>
                          <Table size="small">
                            <TableBody>
                              {section.channels.map((row) => (
                                <TableRow key={row.channelId} hover>
                                  <TableCell width={40} />
                                  <TableCell width={40}>
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
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <InlineActions channelId={row.channelId} state={row.state} />
                                      <Tooltip title="Statistics">
                                        <IconButton size="small" onClick={() => navigate(`/channels/${row.channelId}/statistics`)}>
                                          <BarChartIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <ChannelActions channelId={row.channelId} state={row.state === 'UNDEPLOYED' ? undefined : row.state} />
                                    </Box>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Box>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
