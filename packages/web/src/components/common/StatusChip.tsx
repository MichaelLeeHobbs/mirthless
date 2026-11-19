// State is never shown by colour alone: a label carries the meaning (colour-blind and screen-reader safe).

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { alpha, useTheme } from '@mui/material/styles';
import { channelStateLevel, messageStatusLevel, type StatusLevel } from '../../lib/status.js';
import { humanize } from '../../lib/format.js';

interface StatusChipProps {
  /** Sentence case, e.g. "Started". */
  readonly label: string;
  readonly level: StatusLevel;
}

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
        borderRadius: `${Number(theme.shape.borderRadius) * 0.75}px`,
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
  /** Omit only when text beside the dot names the state: the dot is then hidden from screen readers. */
  readonly title?: string;
  readonly size?: number;
}

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

export function ChannelStateChip({ state }: { readonly state: string }): ReactNode {
  return <StatusChip label={humanize(state)} level={channelStateLevel(state)} />;
}

export function MessageStatusChip({ status }: { readonly status: string }): ReactNode {
  return <StatusChip label={humanize(status)} level={messageStatusLevel(status)} />;
}
