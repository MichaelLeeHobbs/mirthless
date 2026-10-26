// ===========================================
// Jump To Button
// ===========================================
// The header's entry point to the command palette. It looks like a search box
// so people find it without knowing the shortcut, and it shows the shortcut
// so they learn it.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import SearchIcon from '@mui/icons-material/Search';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';

/** "⌘K" on a Mac, "Ctrl K" everywhere else. */
export function shortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}

interface JumpToButtonProps {
  /** Phones get an icon button; the header has no room for the search-box look. */
  readonly compact: boolean;
  readonly onClick: () => void;
}

export function JumpToButton({ compact, onClick }: JumpToButtonProps): ReactNode {
  const keys = shortcutLabel(typeof navigator === 'undefined' ? '' : navigator.platform);
  if (compact) {
    return (
      <Tooltip title={`Jump to (${keys})`}>
        <IconButton color="inherit" aria-label="Jump to" onClick={onClick} sx={{ mr: 0.5 }}>
          <SearchIcon />
        </IconButton>
      </Tooltip>
    );
  }
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={`Jump to a page or action (${keys})`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, mr: 1.5, pl: 1.25, pr: 0.75, height: 34, width: 280,
        border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'surfaceSunken', color: 'text.secondary',
        justifyContent: 'flex-start', '&:hover': { borderColor: 'text.secondary' },
      }}
    >
      <SearchIcon fontSize="small" />
      <Box component="span" sx={{ flexGrow: 1, textAlign: 'left', fontSize: '0.85rem' }}>Jump to…</Box>
      <Box
        component="kbd"
        sx={{ fontFamily: FONT_FAMILY_MONO, fontSize: '0.7rem', px: 0.75, py: 0.25, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}
      >
        {keys}
      </Box>
    </ButtonBase>
  );
}
