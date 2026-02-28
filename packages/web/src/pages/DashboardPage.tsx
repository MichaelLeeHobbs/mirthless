// ===========================================
// Dashboard Page
// ===========================================
// Live overview: summary cards, channel status table, quick actions.
// Auto-refreshes via TanStack Query polling (5s interval).

import { useMemo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useAllChannelStatistics, type ChannelStatisticsSummary } from '../hooks/use-statistics.js';
import { useAllDeploymentStatuses, type ChannelStatus } from '../hooks/use-deployment.js';
import { SummaryCards } from '../components/dashboard/SummaryCards.js';
import { ChannelStatusTable } from '../components/dashboard/ChannelStatusTable.js';

const EMPTY_STATS: readonly ChannelStatisticsSummary[] = [];
const EMPTY_STATUSES: readonly ChannelStatus[] = [];

export function DashboardPage(): ReactNode {
  const statsQuery = useAllChannelStatistics();
  const deployQuery = useAllDeploymentStatuses();

  const statistics = statsQuery.data ?? EMPTY_STATS;
  const deploymentStatuses = deployQuery.data ?? EMPTY_STATUSES;

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
