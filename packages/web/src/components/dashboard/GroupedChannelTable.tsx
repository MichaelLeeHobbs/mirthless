// ===========================================
// Grouped Channel Table
// ===========================================
// Collapsible group sections with group headers and aggregate stats.

import { Fragment, useState, useMemo, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import BarChartIcon from '@mui/icons-material/BarChart';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import Tooltip from '@mui/material/Tooltip';
import { DEFAULT_GROUP_NAME } from '@mirthless/core-models';
import type { ChannelStatisticsSummary } from '../../hooks/use-statistics.js';
import type { ChannelStatus } from '../../hooks/use-deployment.js';
import type { TagSummary } from '../../hooks/use-tags.js';
import { TagChips } from '../common/TagChips.js';
import type { ChannelGroupSummary } from '../../hooks/use-channel-groups.js';
import type { GroupMembership } from '../../hooks/use-channel-groups.js';
import { useUpdateChannelGroup, useDeleteChannelGroup } from '../../hooks/use-channel-groups.js';
import { useDeploymentAction } from '../../hooks/use-deployment.js';
import { ChannelActions } from './ChannelActions.js';
import { ChannelContextMenu } from '../common/ChannelContextMenu.js';
import { AssignGroupDialog } from '../common/AssignGroupDialog.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { useContextMenu } from '../../hooks/use-context-menu.js';
import { useNotification } from '../../stores/notification.store.js';
import { ChannelStateChip, StatusDot } from '../common/StatusChip.js';
import { channelStateLevel } from '../../lib/status.js';
import { DASHBOARD_COLUMNS, DEFAULT_VISIBLE_COLUMNS, type DashboardColumnId } from '../../lib/dashboard-columns.js';
import { ChannelBodyCells, GroupTotalCells } from './ChannelColumnCells.js';

interface GroupedChannelTableProps {
  readonly statistics: readonly ChannelStatisticsSummary[];
  readonly deploymentStatuses: readonly ChannelStatus[];
  readonly groups: readonly ChannelGroupSummary[];
  readonly memberships: readonly GroupMembership[];
  readonly onSendMessage?: ((channelId: string, channelName: string) => void) | undefined;
  readonly onClone?: ((channelId: string, channelName: string) => void) | undefined;
  readonly onDelete?: ((channelId: string, channelName: string) => void) | undefined;
  readonly onExport?: ((channelId: string) => void) | undefined;
  readonly tagsByChannel?: ReadonlyMap<string, readonly TagSummary[]> | undefined;
  readonly visibleColumns?: ReadonlySet<DashboardColumnId> | undefined;
}

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

export function GroupedChannelTable({ statistics, deploymentStatuses, groups, memberships, onSendMessage, onClone, onDelete, onExport, tagsByChannel, visibleColumns }: GroupedChannelTableProps): ReactNode {
  const visible = visibleColumns ?? DEFAULT_VISIBLE;
  const shownColumns = DASHBOARD_COLUMNS.filter((c) => visible.has(c.id));
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const { menuState, menuTarget, handleContextMenu, handleClose } = useContextMenu<ChannelRow>();
  const { notify } = useNotification();

  // --- Group menu state (opens on right-click or the kebab, anchored at the pointer) ---
  const [groupMenuPos, setGroupMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [groupMenuTarget, setGroupMenuTarget] = useState<GroupSection | null>(null);
  const deployAction = useDeploymentAction();

  // --- Rename dialog state ---
  const [renameTarget, setRenameTarget] = useState<GroupSection | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const updateGroup = useUpdateChannelGroup();

  // --- Delete dialog state ---
  const [deleteTarget, setDeleteTarget] = useState<GroupSection | null>(null);
  const deleteGroup = useDeleteChannelGroup();

  // --- Assign group dialog state ---
  const [assignGroupTarget, setAssignGroupTarget] = useState<string | null>(null);

  const handleGroupMenuOpen = useCallback((e: React.MouseEvent<HTMLElement>, section: GroupSection): void => {
    e.preventDefault();
    e.stopPropagation();
    setGroupMenuPos({ top: e.clientY, left: e.clientX });
    setGroupMenuTarget(section);
  }, []);

  // Fire a deployment action for every channel in the group that is in an
  // applicable state (avoids error toasts for channels already in the target state).
  const handleGroupBulk = useCallback((action: 'deploy' | 'start' | 'stop' | 'undeploy'): void => {
    const section = groupMenuTarget;
    setGroupMenuPos(null);
    setGroupMenuTarget(null);
    if (!section) return;
    const applies = (state: string): boolean => {
      switch (action) {
        case 'deploy': return state === 'UNDEPLOYED';
        case 'start': return state === 'STOPPED';
        case 'stop': return state === 'STARTED' || state === 'PAUSED';
        case 'undeploy': return state === 'STOPPED';
        default: return false;
      }
    };
    const targets = section.channels.filter((c) => applies(c.state));
    if (targets.length === 0) {
      notify(`No channels in "${section.groupName}" to ${action}`, 'info');
      return;
    }
    for (const c of targets) {
      deployAction.mutate({ channelId: c.channelId, action });
    }
    notify(`${action.charAt(0).toUpperCase() + action.slice(1)} sent to ${String(targets.length)} channel(s)`, 'success');
  }, [groupMenuTarget, deployAction, notify]);

  const handleGroupMenuClose = useCallback((): void => {
    setGroupMenuPos(null);
    setGroupMenuTarget(null);
  }, []);

  const handleRenameOpen = useCallback((): void => {
    if (!groupMenuTarget) return;
    setRenameTarget(groupMenuTarget);
    setRenameName(groupMenuTarget.groupName);
    setRenameError(null);
    handleGroupMenuClose();
  }, [groupMenuTarget, handleGroupMenuClose]);

  const handleRenameConfirm = useCallback((): void => {
    if (!renameTarget || !renameName.trim()) return;
    setRenameError(null);
    const group = groups.find((g) => g.id === renameTarget.groupId);
    if (!group) return;
    updateGroup.mutate(
      { id: renameTarget.groupId, input: { name: renameName.trim(), revision: group.revision } },
      {
        onSuccess: () => {
          notify(`Group renamed to "${renameName.trim()}"`, 'success');
          setRenameTarget(null);
        },
        onError: (err) => {
          setRenameError(err.message);
        },
      },
    );
  }, [renameTarget, renameName, groups, updateGroup, notify]);

  const handleDeleteOpen = useCallback((): void => {
    if (!groupMenuTarget) return;
    setDeleteTarget(groupMenuTarget);
    handleGroupMenuClose();
  }, [groupMenuTarget, handleGroupMenuClose]);

  const handleDeleteConfirm = useCallback((): void => {
    if (!deleteTarget) return;
    deleteGroup.mutate(deleteTarget.groupId, {
      onSuccess: () => {
        notify(`Group "${deleteTarget.groupName}" deleted`, 'success');
        setDeleteTarget(null);
      },
      onError: (err) => {
        notify(`Failed to delete group: ${err.message}`, 'error');
        setDeleteTarget(null);
      },
    });
  }, [deleteTarget, deleteGroup, notify]);

  const handleChangeGroup = useCallback((channelId: string): void => {
    setAssignGroupTarget(channelId);
  }, []);

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

    for (const row of allRows) {
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
      result.push({
        groupId: group.id,
        groupName: group.name,
        channels,
        totals: sumTotals(channels),
      });
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
  }, [allRows, channelGroupMap, groups]);

  return (
    <Paper>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={40} />
              <TableCell width={40} />
              <TableCell>Channel Name</TableCell>
              <TableCell>State</TableCell>
              {shownColumns.map((c) => (
                <TableCell key={c.id} align={c.align}>{c.label}</TableCell>
              ))}
              <TableCell width={48} />
            </TableRow>
          </TableHead>
          <TableBody>
            {sections.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5 + shownColumns.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No channels configured.
                </TableCell>
              </TableRow>
            ) : (
              sections.map((section) => {
                const isOpen = !collapsed.has(section.groupId);
                return (
                  <Fragment key={section.groupId}>
                    {/* Group header row */}
                    <TableRow
                      sx={{
                        backgroundColor: 'action.hover',
                        cursor: 'pointer',
                        '&:hover .group-menu-btn': { opacity: 1 },
                      }}
                      onClick={() => toggleGroup(section.groupId)}
                      onContextMenu={section.groupId !== '__ungrouped__' ? (e) => handleGroupMenuOpen(e, section) : undefined}
                    >
                      <TableCell>
                        <IconButton size="small" aria-label={isOpen ? `Collapse ${section.groupName}` : `Expand ${section.groupName}`}>
                          {isOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                      </TableCell>
                      <TableCell />
                      <TableCell colSpan={2}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {section.groupName} ({section.channels.length})
                          </Typography>
                          {section.groupId !== '__ungrouped__' ? (
                            <IconButton
                              className="group-menu-btn"
                              size="small"
                              aria-label={`Group actions for ${section.groupName}`}
                              sx={{ opacity: 0, transition: 'opacity 0.15s' }}
                              onClick={(e) => { handleGroupMenuOpen(e, section); }}
                            >
                              <MoreVertIcon fontSize="small" />
                            </IconButton>
                          ) : null}
                        </Box>
                      </TableCell>
                      <GroupTotalCells totals={section.totals} visible={visible} />
                      <TableCell />
                    </TableRow>
                    {/* Channel rows — flat in same table body for aligned columns */}
                    {isOpen && section.channels.map((row) => (
                      <TableRow key={row.channelId} hover onContextMenu={(e) => handleContextMenu(e, row)}>
                        <TableCell width={40} />
                        <TableCell width={40}>
                          <StatusDot level={channelStateLevel(row.state)} title={row.state} />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Link
                              component="button"
                              variant="body2"
                              underline="hover"
                              onClick={() => navigate(`/channels/${row.channelId}`)}
                              sx={{ fontWeight: 500 }}
                            >
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
                    ))}
                  </Fragment>
                );
              })
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
      {/* Group menu (right-click header or kebab) */}
      <Menu
        open={groupMenuPos !== null}
        onClose={handleGroupMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={groupMenuPos ?? { top: 0, left: 0 }}
        slotProps={{ root: { onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); handleGroupMenuClose(); } } }}
      >
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <ListItemText primaryTypographyProps={{ variant: 'subtitle2', fontWeight: 600 }}>
            {groupMenuTarget?.groupName}
          </ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => handleGroupBulk('deploy')}>
          <ListItemIcon><CloudUploadIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Deploy all</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleGroupBulk('start')}>
          <ListItemIcon><PlayArrowIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Start all</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleGroupBulk('stop')}>
          <ListItemIcon><StopIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Stop all</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleGroupBulk('undeploy')}>
          <ListItemIcon><CloudOffIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Undeploy all</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleRenameOpen}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={handleDeleteOpen}
          disabled={
            (groupMenuTarget?.channels.length ?? 0) > 0 ||
            groupMenuTarget?.groupName === DEFAULT_GROUP_NAME
          }
        >
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ color: 'error' }}>Delete</ListItemText>
        </MenuItem>
      </Menu>
      {/* Rename group dialog */}
      <Dialog open={renameTarget !== null} onClose={() => { setRenameTarget(null); }} maxWidth="xs" fullWidth>
        <DialogTitle>Rename Group</DialogTitle>
        <DialogContent>
          {renameError ? (
            <Alert severity="error" sx={{ mb: 2 }}>{renameError}</Alert>
          ) : null}
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={renameName}
            onChange={(e) => { setRenameName(e.target.value); }}
            slotProps={{ htmlInput: { maxLength: 255 } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRenameTarget(null); }} disabled={updateGroup.isPending}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleRenameConfirm}
            disabled={updateGroup.isPending || !renameName.trim()}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>
      {/* Delete group confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Group"
        message={`Are you sure you want to delete the group "${deleteTarget?.groupName ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteGroup.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeleteTarget(null); }}
      />
      {/* Assign group dialog */}
      {assignGroupTarget ? (
        <AssignGroupDialog
          open
          onClose={() => { setAssignGroupTarget(null); }}
          channelId={assignGroupTarget}
        />
      ) : null}
    </Paper>
  );
}
