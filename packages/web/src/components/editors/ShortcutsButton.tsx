// ===========================================
// Editor shortcuts button
// ===========================================
// Lists the editor's keyboard shortcuts, so they can be found without
// knowing they exist.

import { type ReactNode, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import KeyboardIcon from '@mui/icons-material/Keyboard';

/** Shortcut, then what it does. Ctrl means Cmd on a Mac. */
export const EDITOR_SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Ctrl+Space', 'Suggest completions'],
  ['Ctrl+Space twice', 'Show documentation beside suggestions'],
  ['F8 / Shift+F8', 'Go to the next / previous problem'],
  ['Shift+Alt+F', 'Format the script'],
  ['Ctrl+/', 'Comment or uncomment the line'],
  ['Ctrl+F / Ctrl+H', 'Find / replace'],
  ['F2', 'Rename a variable everywhere'],
  ['F12', 'Go to definition'],
  ['F1', 'All editor commands'],
  ['Ctrl+M', 'Let Tab move focus out of the editor'],
  ['Esc', 'Close full screen'],
];

export function ShortcutsButton(): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title="Keyboard shortcuts">
        <IconButton size="small" aria-label="Keyboard shortcuts" onClick={(e) => { setAnchor(e.currentTarget); }}>
          <KeyboardIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => { setAnchor(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { 'aria-label': 'Keyboard shortcuts', sx: { p: 2, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Keyboard shortcuts</Typography>
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.75, m: 0 }}>
          {EDITOR_SHORTCUTS.map(([keys, action]) => (
            <Box key={keys} sx={{ display: 'contents' }}>
              <Box component="dt" sx={{ typography: 'caption', fontWeight: 600, whiteSpace: 'nowrap' }}>{keys}</Box>
              <Box component="dd" sx={{ typography: 'caption', color: 'text.secondary', m: 0 }}>{action}</Box>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
}
