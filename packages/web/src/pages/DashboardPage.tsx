// ===========================================
// Dashboard Page
// ===========================================
// Live overview: summary cards, channel status table, quick actions.
// Auto-refreshes via TanStack Query polling (5s interval) with
// WebSocket events for instant cache invalidation.

import { useMemo, useEffect, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useQueryClient } from '@tanstack/react-query';
import { useAllChannelStatistics, STATS_KEYS, type ChannelStatisticsSummary } from '../hooks/use-statistics.js';
import { useAllDeploymentStatuses, DEPLOYMENT_KEYS, type ChannelStatus } from '../hooks/use-deployment.js';
import { useSocketEvent } from '../hooks/use-socket.js';
import { getSocket } from '../lib/socket.js';
import { SummaryCards } from '../components/dashboard/SummaryCards.js';
import { ChannelStatusTable } from '../components/dashboard/ChannelStatusTable.js';

const EMPTY_STATS: readonly ChannelStatisticsSummary[] = [];
const EMPTY_STATUSES: readonly ChannelStatus[] = [];

export function DashboardPage(): ReactNode {
  const queryClient = useQueryClient();
  const statsQuery = useAllChannelStatistics();
  const deployQuery = useAllDeploymentStatuses();

  const statistics = statsQuery.data ?? EMPTY_STATS;
  const deploymentStatuses = deployQuery.data ?? EMPTY_STATUSES;

  // --- WebSocket: join/leave dashboard room (re-joins on reconnect) ---
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.emit('join:dashboard');
    const handleReconnect = (): void => { s.emit('join:dashboard'); };
    s.on('connect', handleReconnect);
    return () => {
      s.off('connect', handleReconnect);
      s.emit('leave:dashboard');
    };
  }, []);

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

  // --- Derived counts ---
  const { deployedCount, stoppedCount, erroredCount } = useMemo(() => {
    const deployMap = new Map<string, string>();
    for (const s of deploymentStatuses) {
      deployMap.set(s.channelId, s.state);
    }

    let deployed = 0;
    let stopped = 0;
    let errored = 0;

    for (const stat of statistics) {
      const state = deployMap.get(stat.channelId);
      if (state === 'STARTED' || state === 'PAUSED') deployed++;
      if (state === 'STOPPED') stopped++;
      if (stat.errored > 0) errored++;
    }

    return { deployedCount: deployed, stoppedCount: stopped, erroredCount: errored };
  }, [statistics, deploymentStatuses]);

  const isLoading = statsQuery.isLoading || deployQuery.isLoading;
  const error = statsQuery.error ?? deployQuery.error;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Dashboard
        </Typography>
        {(statsQuery.isFetching || deployQuery.isFetching) && !isLoading && (
          <CircularProgress size={20} />
        )}
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
            statistics={statistics}
            deployedCount={deployedCount}
            stoppedCount={stoppedCount}
            erroredCount={erroredCount}
          />
          <ChannelStatusTable
            statistics={statistics}
            deploymentStatuses={deploymentStatuses}
          />
        </>
      )}
    </Box>
  );
}
