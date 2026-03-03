// ===========================================
// Dashboard Page
// ===========================================
// Live overview: summary cards, channel status table, quick actions.
// Auto-refreshes via TanStack Query polling (5s interval) with
// WebSocket events for instant cache invalidation.
// Supports tag filtering and grouped view toggle.

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ViewListIcon from '@mui/icons-material/ViewList';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
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
  const [viewMode, setViewMode] = useState<ViewMode>('flat');

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

  const isLoading = statsQuery.isLoading || deployQuery.isLoading;
  const error = statsQuery.error ?? deployQuery.error;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Dashboard
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {(statsQuery.isFetching || deployQuery.isFetching) && !isLoading && (
            <CircularProgress size={20} />
          )}
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
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load dashboard data: {error.message}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
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
            />
          ) : (
            <ChannelStatusTable
              statistics={filteredStatistics}
              deploymentStatuses={deploymentStatuses}
            />
          )}
        </>
      )}
    </Box>
  );
}
