// ===========================================
// Traffic Summary
// ===========================================
// Engine-wide message totals across all channels, for the Traffic view.

import { useMemo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useAllChannelStatistics } from '../../hooks/use-statistics.js';

interface Tile {
  readonly label: string;
  readonly value: number;
  readonly color?: 'error.main' | 'warning.main';
}

export function TrafficSummary(): ReactNode {
  const { data } = useAllChannelStatistics();

  const tiles = useMemo((): readonly Tile[] => {
    let received = 0, sent = 0, errored = 0, queued = 0;
    for (const s of data ?? []) {
      received += s.received; sent += s.sent; errored += s.errored; queued += s.queued;
    }
    return [
      { label: 'Received', value: received },
      { label: 'Sent', value: sent },
      { label: 'Errored', value: errored, color: 'error.main' },
      { label: 'Queued', value: queued, color: 'warning.main' },
    ];
  }, [data]);

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
      {tiles.map((t) => (
        <Paper key={t.label} sx={{ px: 2.5, py: 1.5, flex: '1 1 140px', minWidth: 130 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t.label}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, color: t.value > 0 && t.color ? t.color : undefined }}>
            {t.value.toLocaleString()}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}
