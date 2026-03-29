// ===========================================
// Channel Statistics Page
// ===========================================
// Per-channel statistics detail page with connector breakdown.

import { useState, useCallback, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useChannelStatistics, useResetStatistics, STATS_KEYS } from '../hooks/use-statistics.js';
import { StatsSummaryCards } from '../components/statistics/StatsSummaryCards.js';
import { ConnectorStatsTable } from '../components/statistics/ConnectorStatsTable.js';
import { PageBreadcrumbs } from '../components/common/PageBreadcrumbs.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useSocketEvent, useSocketRoom } from '../hooks/use-socket.js';

export function ChannelStatisticsPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const channelId = id ?? '';
  const { data: stats, isLoading, error } = useChannelStatistics(channelId.length > 0 ? channelId : null);
  const resetMutation = useResetStatistics();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // WebSocket: join dashboard room for stats events, invalidate on update
  useSocketRoom('join:dashboard', 'leave:dashboard');
  const handleStatsUpdate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: STATS_KEYS.all });
  }, [queryClient]);
  useSocketEvent('stats:update', handleStatsUpdate);

  const handleReset = (): void => {
    setConfirmOpen(true);
  };

  const handleConfirmReset = (): void => {
    setConfirmOpen(false);
    resetMutation.mutate(channelId);
  };

  return (
    <Box sx={{ p: 3 }}>
      <PageBreadcrumbs items={[
        { label: 'Dashboard', href: '/' },
        { label: 'Channel Statistics' },
      ]} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          size="small"
        >
          Dashboard
        </Button>
        <Typography variant="h5" sx={{ fontWeight: 600, flex: 1 }}>
          Channel Statistics
        </Typography>
        <Button
          startIcon={<RefreshIcon />}
          variant="outlined"
          color="error"
          size="small"
          onClick={handleReset}
          disabled={resetMutation.isPending}
        >
          Reset Statistics
        </Button>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Typography color="error">Failed to load statistics: {error.message}</Typography>
      )}

      {stats && (
        <Box>
          <StatsSummaryCards connectors={stats.connectors} />
          <Typography variant="h6" sx={{ mb: 2 }}>Connector Breakdown</Typography>
          <ConnectorStatsTable connectors={stats.connectors} />
        </Box>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Reset Statistics"
        message="Reset all statistics for this channel? This cannot be undone."
        confirmLabel="Reset"
        severity="error"
        isPending={resetMutation.isPending}
        onConfirm={handleConfirmReset}
        onCancel={() => { setConfirmOpen(false); }}
      />
    </Box>
  );
}
