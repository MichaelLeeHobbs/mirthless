// ===========================================
// Needs Attention strip
// ===========================================
// The dashboard's first answer to "is anything wrong?": the channels that are
// stopped or have errored messages, worst first, each one click from what an
// operator does next. Renders nothing when every channel is fine, so a calm
// engine shows a calm page.

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { StatusChip } from '../common/StatusChip.js';
import type { ChannelStatisticsSummary } from '../../hooks/use-statistics.js';
import type { ChannelStatus } from '../../hooks/use-deployment.js';

/** One channel that needs an operator, with the reason. */
export interface AttentionItem {
  readonly channelId: string;
  readonly channelName: string;
  readonly errored: number;
  readonly stopped: boolean;
}

/**
 * Channels that are stopped or have errored messages, most errors first, then
 * stopped channels with no errors, each group by name.
 */
export function rankAttention(
  statistics: readonly ChannelStatisticsSummary[],
  statuses: readonly ChannelStatus[],
): readonly AttentionItem[] {
  const stateById = new Map(statuses.map((s) => [s.channelId, s.state]));
  return statistics
    .map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      errored: s.errored,
      stopped: stateById.get(s.channelId) === 'STOPPED',
    }))
    .filter((i) => i.errored > 0 || i.stopped)
    .sort((a, b) => b.errored - a.errored || a.channelName.localeCompare(b.channelName));
}

interface NeedsAttentionProps {
  readonly statistics: readonly ChannelStatisticsSummary[];
  readonly statuses: readonly ChannelStatus[];
}

function AttentionRow({ item }: { readonly item: AttentionItem }): ReactNode {
  return (
    <Box
      component="li"
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, flexWrap: 'wrap', borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}
    >
      <Box sx={{ width: 96, flexShrink: 0 }}>
        {item.errored > 0
          ? <StatusChip level="critical" label={`${item.errored.toLocaleString()} errored`} />
          : <StatusChip level="critical" label="Stopped" />}
      </Box>
      <Link component={RouterLink} to={`/channels/${item.channelId}`} variant="body2" underline="hover" sx={{ fontWeight: 600, color: 'text.primary', flex: '1 1 160px', minWidth: 0 }}>
        {item.channelName}
      </Link>
      {item.errored > 0 ? (
        <Link component={RouterLink} to={`/channels/${item.channelId}/messages?status=ERROR`} variant="body2" underline="always">
          View failed messages
        </Link>
      ) : (
        <Link component={RouterLink} to={`/channels/${item.channelId}`} variant="body2" underline="always">
          Open channel
        </Link>
      )}
    </Box>
  );
}

/** The ranked list of channels needing attention, or nothing when all are fine. */
export function NeedsAttention({ statistics, statuses }: NeedsAttentionProps): ReactNode {
  const items = rankAttention(statistics, statuses);
  if (items.length === 0) return null;
  return (
    <Paper component="section" aria-label="Needs attention" sx={{ mb: 2, px: 2, py: 1.25, borderColor: 'status.critical' }}>
      <Typography variant="overline" component="h2" sx={{ color: 'text.secondary' }}>
        Needs attention ({items.length})
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {items.map((item) => <AttentionRow key={item.channelId} item={item} />)}
      </Box>
    </Paper>
  );
}
