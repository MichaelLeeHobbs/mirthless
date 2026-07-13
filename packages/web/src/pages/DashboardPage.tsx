// ===========================================
// Dashboard Page
// ===========================================
// Live overview: summary cards, channel status table, quick actions.
// Auto-refreshes via TanStack Query polling (60s interval) with
// WebSocket events for instant cache invalidation.
// Supports tag filtering and grouped view toggle.

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import ViewListIcon from '@mui/icons-material/ViewList';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import AddIcon from '@mui/icons-material/Add';
import UploadIcon from '@mui/icons-material/Upload';
import { PageHeader } from '../components/common/PageHeader.js';
import { NewChannelDialog } from '../components/channels/NewChannelDialog.js';
import { ImportDialog } from '../components/channels/ImportDialog.js';
import { ExportButton } from '../components/channels/ExportButton.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { useQueryClient } from '@tanstack/react-query';
import { useAllChannelStatistics, STATS_KEYS, type ChannelStatisticsSummary } from '../hooks/use-statistics.js';
import { useAllDeploymentStatuses, DEPLOYMENT_KEYS, type ChannelStatus } from '../hooks/use-deployment.js';
import { useTags, useTagAssignments, type TagSummary, type TagAssignment } from '../hooks/use-tags.js';
import { useChannelGroups, useGroupMemberships, type ChannelGroupSummary, type GroupMembership } from '../hooks/use-channel-groups.js';
import { useSocketEvent, useSocketRoom } from '../hooks/use-socket.js';
import { SummaryCards } from '../components/dashboard/SummaryCards.js';
import { ChannelStatusTable } from '../components/dashboard/ChannelStatusTable.js';
import { TagFilter } from '../components/dashboard/TagFilter.js';
import { GroupedChannelTable } from '../components/dashboard/GroupedChannelTable.js';
import { BulkActionsToolbar } from '../components/dashboard/BulkActionsToolbar.js';
import { SendMessageDialog } from '../components/common/SendMessageDialog.js';
import { CreateGroupDialog } from '../components/dashboard/CreateGroupDialog.js';
import { useChannelSelection } from '../hooks/use-channel-selection.js';
import { useChannelCrud } from '../hooks/use-channel-crud.js';

const EMPTY_STATS: readonly ChannelStatisticsSummary[] = [];
const EMPTY_STATUSES: readonly ChannelStatus[] = [];
const EMPTY_TAGS: readonly TagSummary[] = [];
const EMPTY_ASSIGNMENTS: readonly TagAssignment[] = [];
const EMPTY_GROUPS: readonly ChannelGroupSummary[] = [];
const EMPTY_MEMBERSHIPS: readonly GroupMembership[] = [];

type ViewMode = 'flat' | 'grouped';

export function DashboardPage(): ReactNode {
  const queryClient = useQueryClient();
  const statsQuery = useAllChannelStatistics();
  const deployQuery = useAllDeploymentStatuses();
  const tagsQuery = useTags();
  const assignmentsQuery = useTagAssignments();
  const groupsQuery = useChannelGroups();
  const membershipsQuery = useGroupMemberships();

  const [selectedTagIds, setSelectedTagIds] = useState<readonly string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [sendMessageTarget, setSendMessageTarget] = useState<{ id: string; name: string } | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const selection = useChannelSelection();
  const crud = useChannelCrud();
  const { has } = usePermissions();
  const canWrite = has(PERMISSION.CHANNELS_WRITE);

  const statistics = statsQuery.data ?? EMPTY_STATS;
  const deploymentStatuses = deployQuery.data ?? EMPTY_STATUSES;
  const tags = tagsQuery.data ?? EMPTY_TAGS;
  const assignments = assignmentsQuery.data ?? EMPTY_ASSIGNMENTS;
  const groups = groupsQuery.data ?? EMPTY_GROUPS;
  const memberships = membershipsQuery.data ?? EMPTY_MEMBERSHIPS;

  // --- WebSocket: join/leave dashboard room (re-joins on reconnect) ---
  useSocketRoom('join:dashboard', 'leave:dashboard');

  // --- WebSocket: invalidate deployment cache on channel state changes ---
  const handleChannelState = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: DEPLOYMENT_KEYS.all });
  }, [queryClient]);

  useSocketEvent('channel:state', handleChannelState);

  // --- WebSocket: invalidate stats cache on stats updates ---
  const handleStatsUpdate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: STATS_KEYS.all });
  }, [queryClient]);

  useSocketEvent('stats:update', handleStatsUpdate);

  // --- Client-side tag filtering ---
  const filteredStatistics = useMemo(() => {
    if (selectedTagIds.length === 0) return statistics;

    const selectedSet = new Set(selectedTagIds);
    const channelIdsWithSelectedTags = new Set<string>();
    for (const a of assignments) {
      if (selectedSet.has(a.tagId)) {
        channelIdsWithSelectedTags.add(a.channelId);
      }
    }

    return statistics.filter((s) => channelIdsWithSelectedTags.has(s.channelId));
  }, [statistics, assignments, selectedTagIds]);

  // --- Derived counts ---
  const { deployedCount, stoppedCount, erroredCount } = useMemo(() => {
    const deployMap = new Map<string, string>();
    for (const s of deploymentStatuses) {
      deployMap.set(s.channelId, s.state);
    }

    let deployed = 0;
    let stopped = 0;
    let errored = 0;

    for (const stat of filteredStatistics) {
      const state = deployMap.get(stat.channelId);
      if (state === 'STARTED' || state === 'PAUSED') deployed++;
      if (state === 'STOPPED') stopped++;
      if (stat.errored > 0) errored++;
    }

    return { deployedCount: deployed, stoppedCount: stopped, erroredCount: errored };
  }, [filteredStatistics, deploymentStatuses]);

  const handleSendMessage = useCallback((channelId: string, channelName: string): void => {
    setSendMessageTarget({ id: channelId, name: channelName });
  }, []);

  const isLoading = statsQuery.isLoading || deployQuery.isLoading;
  const error = statsQuery.error ?? deployQuery.error;

  return (
    <Box>
      <PageHeader
        title="Dashboard"
        description="Live channel health across the engine."
        isFetching={(statsQuery.isFetching || deployQuery.isFetching) && !isLoading}
        actions={
          <>
            <ExportButton />
            <Button
              variant="outlined"
              size="small"
              startIcon={<UploadIcon />}
              onClick={() => { setImportOpen(true); }}
            >
              Import
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CreateNewFolderIcon />}
              onClick={() => { setCreateGroupOpen(true); }}
            >
              New Group
            </Button>
            <Tooltip title={canWrite ? '' : 'Requires channels:write permission'}>
              <span>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => { setNewChannelOpen(true); }}
                  disabled={!canWrite}
                >
                  New Channel
                </Button>
              </span>
            </Tooltip>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, v: ViewMode | null) => { if (v) setViewMode(v); }}
              size="small"
            >
              <ToggleButton value="flat" aria-label="flat view">
                <ViewListIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton value="grouped" aria-label="grouped view">
                <AccountTreeIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </>
        }
      />

      {error && (
        <ErrorState
          title="Couldn't load dashboard data"
          error={error}
          onRetry={() => { void statsQuery.refetch(); void deployQuery.refetch(); }}
          sx={{ mb: 2 }}
        />
      )}

      {isLoading ? (
        <Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={92} sx={{ flex: '1 1 140px', minWidth: 132, borderRadius: 3 }} />
            ))}
          </Box>
          <Skeleton variant="rounded" height={320} sx={{ borderRadius: 3 }} />
        </Box>
      ) : (
        <>
          <SummaryCards
            statistics={filteredStatistics}
            deployedCount={deployedCount}
            stoppedCount={stoppedCount}
            erroredCount={erroredCount}
          />
          <Box sx={{ mb: 2 }}>
            <TagFilter
              tags={tags}
              selectedTagIds={selectedTagIds}
              onChangeTagIds={setSelectedTagIds}
            />
          </Box>
          {viewMode === 'grouped' ? (
            <GroupedChannelTable
              statistics={filteredStatistics}
              deploymentStatuses={deploymentStatuses}
              groups={groups}
              memberships={memberships}
              onSendMessage={handleSendMessage}
              onClone={crud.onClone}
              onDelete={crud.onDelete}
              onExport={crud.onExport}
            />
          ) : (
            <ChannelStatusTable
              statistics={filteredStatistics}
              deploymentStatuses={deploymentStatuses}
              selectedIds={selection.selectedIds}
              onToggleSelect={selection.toggle}
              onSelectAll={(ids) => {
                if (selection.isAllSelected(ids)) selection.clearAll();
                else selection.selectAll(ids);
              }}
              isAllSelected={selection.isAllSelected(filteredStatistics.map((s) => s.channelId))}
              onSendMessage={handleSendMessage}
              onClone={crud.onClone}
              onDelete={crud.onDelete}
              onExport={crud.onExport}
            />
          )}
        </>
      )}
      <BulkActionsToolbar selectedIds={selection.selectedIds} onClear={selection.clearAll} />
      {sendMessageTarget ? (
        <SendMessageDialog
          open
          onClose={() => { setSendMessageTarget(null); }}
          channelId={sendMessageTarget.id}
          channelName={sendMessageTarget.name}
        />
      ) : null}
      <CreateGroupDialog
        open={createGroupOpen}
        onClose={() => { setCreateGroupOpen(false); }}
      />
      <NewChannelDialog open={newChannelOpen} onClose={() => { setNewChannelOpen(false); }} />
      <ImportDialog open={importOpen} onClose={() => { setImportOpen(false); }} onSuccess={() => { /* TanStack Query auto-refetches */ }} />
      {crud.dialogs}
    </Box>
  );
}
