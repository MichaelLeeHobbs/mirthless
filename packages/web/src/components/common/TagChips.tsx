// ===========================================
// Tag Chips
// ===========================================
// Compact colored chips for a channel's tags, with luminance-aware text color so
// labels stay readable on both light and dark tag colors.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import type { TagSummary } from '../../hooks/use-tags.js';

/** Pick black or white text for readability over a hex background color. */
export function contrastText(hex: string | null): string | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return undefined;
  const int = parseInt(m[1]!, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  // Relative luminance (sRGB approximation).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? 'rgba(0,0,0,0.87)' : '#fff';
}

interface TagChipsProps {
  readonly tags: readonly TagSummary[];
  /** Max chips to render before collapsing the rest into a "+N" chip. */
  readonly max?: number;
}

export function TagChips({ tags, max = 4 }: TagChipsProps): ReactNode {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const overflow = tags.length - shown.length;

  return (
    <Box sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 0.5, verticalAlign: 'middle' }}>
      {shown.map((tag) => (
        <Chip
          key={tag.id}
          label={tag.name}
          size="small"
          sx={{
            height: 18,
            fontSize: '0.68rem',
            backgroundColor: tag.color ?? undefined,
            color: contrastText(tag.color),
            '& .MuiChip-label': { px: 0.75 },
          }}
        />
      ))}
      {overflow > 0 ? (
        <Chip label={`+${String(overflow)}`} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.68rem', '& .MuiChip-label': { px: 0.75 } }} />
      ) : null}
    </Box>
  );
}
