// ===========================================
// Channel Health (editor header)
// ===========================================
// The running state of the channel being edited, and the way to its messages,
// so an operator fixing a failing channel sees the failure while editing it.
// Reads the same cached queries as the dashboard.

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import Link from '@mui/material/Link';
import { ChannelStateChip } from '../common/StatusChip.js';
import { useAllChannelStatistics } from '../../hooks/use-statistics.js';
import { useAllDeploymentStatuses } from '../../hooks/use-deployment.js';

/** State chip plus a link to the channel's messages (its failed ones when it has errors). */
export function ChannelHealth({ channelId }: { readonly channelId: string }): ReactNode {
  const stats = useAllChannelStatistics().data?.find((s) => s.channelId === channelId);
  const state = useAllDeploymentStatuses().data?.find((s) => s.channelId === channelId)?.state;
  const errored = stats?.errored ?? 0;
  return (
    <>
      {state ? <ChannelStateChip state={state} /> : null}
      {errored > 0 ? (
        <Link component={RouterLink} to={`/channels/${channelId}/messages?status=ERROR`} variant="body2" underline="always" sx={{ color: 'status.critical', fontWeight: 600 }}>
          {`View ${errored.toLocaleString()} failed messages`}
        </Link>
      ) : (
        <Link component={RouterLink} to={`/channels/${channelId}/messages`} variant="body2" underline="always">
          Messages
        </Link>
      )}
    </>
  );
}
