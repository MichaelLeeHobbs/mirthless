// ===========================================
// Status Chip / Status Dot
// ===========================================
// The signature element of the UI: one consistent way to show state. A filled
// dot carries the colour, a label carries the meaning — so state is never
// communicated by colour alone (colour-blind and screen-reader safe). Used for
// channel deployment states and message statuses alike, driven by the semantic
// level from lib/status.ts.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { alpha, useTheme } from '@mui/material/styles';
import { channelStateLevel, messageStatusLevel, type StatusLevel } from '../../lib/status.js';

interface StatusChipProps {
  /** Display label, e.g. "STARTED" or "SENT". */
  readonly label: string;
  /** Semantic level; drives the colour. */
  readonly level: StatusLevel;
}

/** A dot-plus-label pill. State is encoded by both colour and text. */
export function StatusChip({ label, level }: StatusChipProps): ReactNode {
  const theme = useTheme();
  const color = theme.palette.status[level];
  return (
    <Box
      component="span"
      role="status"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        height: 22,
        pl: 0.875,
        pr: 1.125,
        borderRadius: `${theme.shape.borderRadius * 0.75}px`,
        border: `1px solid ${alpha(color, 0.42)}`,
        backgroundColor: alpha(color, 0.12),
        color,
        fontSize: '0.7rem',
        fontWeight: 700,
        letterSpacing: '0.03em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <StatusDot level={level} />
      {label}
    </Box>
  );
}

interface StatusDotProps {
  readonly level: StatusLevel;
  /** Accessible label. When omitted the dot is decorative (paired with text). */
  readonly title?: string;
  readonly size?: number;
}

/** A bare status dot with a soft halo — for compact leading table cells. */
export function StatusDot({ level, title, size = 8 }: StatusDotProps): ReactNode {
  const theme = useTheme();
  const color = theme.palette.status[level];
  return (
    <Box
      component="span"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      sx={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 0 3px ${alpha(color, 0.18)}`,
      }}
    />
  );
}

/** Convenience: render a channel deployment state as a StatusChip. */
export function ChannelStateChip({ state }: { readonly state: string }): ReactNode {
  return <StatusChip label={state} level={channelStateLevel(state)} />;
}

/** Convenience: render a message/connector status as a StatusChip. */
export function MessageStatusChip({ status }: { readonly status: string }): ReactNode {
  return <StatusChip label={status} level={messageStatusLevel(status)} />;
}
