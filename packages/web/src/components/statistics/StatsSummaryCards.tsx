// ===========================================
// Statistics Summary Cards
// ===========================================
// Summary cards showing total received, sent, errored, and error rate.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { ConnectorStats } from '../../hooks/use-statistics.js';

interface StatsSummaryCardsProps {
  readonly connectors: readonly ConnectorStats[];
}

function sumField(connectors: readonly ConnectorStats[], field: 'received' | 'filtered' | 'sent' | 'errored'): number {
  let total = 0;
  for (const c of connectors) {
    total += c[field];
  }
  return total;
}

export function StatsSummaryCards({ connectors }: StatsSummaryCardsProps): ReactNode {
  const received = sumField(connectors, 'received');
  const sent = sumField(connectors, 'sent');
  const errored = sumField(connectors, 'errored');
  const filtered = sumField(connectors, 'filtered');
  const errorRate = received > 0 ? (errored / received) * 100 : 0;

  const cards = [
    { label: 'Received', value: received, color: 'info.main' },
    { label: 'Filtered', value: filtered, color: 'text.secondary' },
    { label: 'Sent', value: sent, color: 'success.main' },
    { label: 'Errored', value: errored, color: 'error.main' },
    { label: 'Error Rate', value: `${errorRate.toFixed(1)}%`, color: errored > 0 ? 'error.main' : 'text.secondary' },
  ];

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
      {cards.map((card) => (
        <Card key={card.label} sx={{ minWidth: 140, flex: 1 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="body2" color="text.secondary">
              {card.label}
            </Typography>
            <Typography variant="h5" sx={{ color: card.color, fontWeight: 600 }}>
              {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
