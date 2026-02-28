// ===========================================
// Dashboard Summary Cards
// ===========================================
// Top-row metric cards showing aggregate channel status.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { ChannelStatisticsSummary } from '../../hooks/use-statistics.js';

interface SummaryCardsProps {
  readonly statistics: readonly ChannelStatisticsSummary[];
  readonly deployedCount: number;
  readonly stoppedCount: number;
  readonly erroredCount: number;
}

interface MetricCardProps {
  readonly label: string;
  readonly value: number | string;
  readonly color?: string;
}

function MetricCard({ label, value, color }: MetricCardProps): ReactNode {
  return (
    <Card sx={{ flex: 1, minWidth: 120 }}>
      <CardContent sx={{ textAlign: 'center', py: 2, '&:last-child': { pb: 2 } }}>
        <Typography
          variant="h4"
          component="div"
          sx={{ fontWeight: 700, color: color ?? 'text.primary' }}
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ statistics, deployedCount, stoppedCount, erroredCount }: SummaryCardsProps): ReactNode {
  const totalChannels = statistics.length;
  const totalReceived = statistics.reduce((sum, s) => sum + s.received, 0);

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
      <MetricCard label="Total Channels" value={totalChannels} />
      <MetricCard label="Running" value={deployedCount} color="success.main" />
      <MetricCard label="Stopped" value={stoppedCount} color="text.secondary" />
      <MetricCard label="Errored" value={erroredCount} color="error.main" />
      <MetricCard label="Received" value={totalReceived.toLocaleString()} color="info.main" />
    </Box>
  );
}
