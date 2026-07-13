// ===========================================
// Dashboard Summary Cards
// ===========================================
// Top-row stat tiles: a labelled headline number per aggregate, colour-keyed to
// the semantic status level it represents. Numbers are tabular so the row stays
// aligned as counts change. Restrained by design — the colour and the number do
// the talking, no chart chrome.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import type { StatusLevel } from '../../lib/status.js';
import type { ChannelStatisticsSummary } from '../../hooks/use-statistics.js';

interface SummaryCardsProps {
  readonly statistics: readonly ChannelStatisticsSummary[];
  readonly deployedCount: number;
  readonly stoppedCount: number;
  readonly erroredCount: number;
}

interface StatTileProps {
  readonly label: string;
  readonly value: number;
  /** Semantic level; drives the accent + number colour. Omit for neutral ink. */
  readonly level?: StatusLevel;
}

function StatTile({ label, value, level }: StatTileProps): ReactNode {
  const theme = useTheme();
  const accent = level ? theme.palette.status[level] : theme.palette.text.secondary;
  const valueColor = level && level !== 'neutral' ? accent : theme.palette.text.primary;
  return (
    <Card
      sx={{
        flex: '1 1 140px',
        minWidth: 132,
        px: 2.25,
        py: 1.75,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          insetInlineStart: 0,
          insetBlock: 0,
          width: 3,
          backgroundColor: accent,
        },
        // Faint wash of the accent so the tile reads as "this colour" at a glance.
        backgroundImage: `linear-gradient(90deg, ${alpha(accent, 0.06)}, transparent 60%)`,
      }}
    >
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography
        component="div"
        sx={{
          fontSize: '1.875rem',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value.toLocaleString()}
      </Typography>
    </Card>
  );
}

export function SummaryCards({ statistics, deployedCount, stoppedCount, erroredCount }: SummaryCardsProps): ReactNode {
  const totalChannels = statistics.length;
  const totalReceived = statistics.reduce((sum, s) => sum + s.received, 0);
  const totalQueued = statistics.reduce((sum, s) => sum + s.queued, 0);

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
      <StatTile label="Total Channels" value={totalChannels} />
      <StatTile label="Running" value={deployedCount} level="healthy" />
      <StatTile label="Stopped" value={stoppedCount} level="neutral" />
      <StatTile label="Errored" value={erroredCount} level="critical" />
      <StatTile label="Queued" value={totalQueued} level="warning" />
      <StatTile label="Received" value={totalReceived} level="info" />
    </Box>
  );
}
