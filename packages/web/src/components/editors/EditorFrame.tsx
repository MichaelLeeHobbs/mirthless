// ===========================================
// Editor frame
// ===========================================
// The shared chrome around every code editor: a toolbar, the editor, and a
// status line, with a full-screen mode. ScriptEditor, TextEditor and
// CodeDiffEditor all render inside it, so every host looks the same.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import { RADIUS } from '../../styles/tokens.js';

interface EditorFrameProps {
  /** Accessible name and toolbar title, e.g. "Deploy script". */
  readonly label: string;
  /** Show the label in the toolbar. Hosts that already title the editor hide it. */
  readonly showLabel?: boolean;
  /** Controls after the title (language switch). */
  readonly start?: ReactNode;
  /** Controls at the right end, before the expand button. */
  readonly end?: ReactNode;
  /** The status line. */
  readonly status?: ReactNode;
  /** Height of the editor area when not expanded (CSS length or px). */
  readonly height: string | number;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly children: ReactNode;
}

function Frame({ label, showLabel, start, end, status, expanded, onExpandedChange, children, fill, rounded = false }: Omit<EditorFrameProps, 'height'> & { readonly fill: boolean; readonly rounded?: boolean }): ReactNode {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: fill ? '100%' : 'auto',
        border: 1,
        borderColor: 'divider',
        borderRadius: rounded ? `${String(RADIUS.md)}px` : 0,
        bgcolor: 'background.paper',
        overflow: 'hidden',
        transition: 'border-color 120ms, box-shadow 120ms',
        '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 3px ${t.palette.action.focus}` },
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, minHeight: 40, px: 1, py: 0.5,
          borderBottom: 1, borderColor: 'divider',
        }}
      >
        {showLabel !== false ? (
          <Typography variant="body2" noWrap sx={{ fontWeight: 600, pl: 0.5, display: { xs: 'none', sm: 'block' } }}>
            {label}
          </Typography>
        ) : null}
        {start}
        <Box sx={{ flexGrow: 1 }} />
        {end}
        <Tooltip title={expanded ? 'Exit full screen (Esc)' : 'Expand to full screen'}>
          <IconButton
            size="small"
            aria-label={expanded ? 'Exit full screen' : 'Expand to full screen'}
            onClick={() => { onExpandedChange(!expanded); }}
          >
            {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flexGrow: 1, minHeight: 0 }}>{children}</Box>
      {status ? (
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 28, px: 1.5,
            borderTop: 1, borderColor: 'divider', typography: 'caption', color: 'text.secondary',
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}
        >
          {status}
        </Box>
      ) : null}
    </Box>
  );
}

/** Toolbar, editor body and status line; full screen when `expanded`. */
export function EditorFrame({ height, expanded, onExpandedChange, ...rest }: EditorFrameProps): ReactNode {
  if (expanded) {
    return (
      <>
        <Box sx={{ height, border: 1, borderColor: 'divider', borderRadius: `${String(RADIUS.md)}px`, bgcolor: 'action.hover' }} />
        <Dialog fullScreen open onClose={() => { onExpandedChange(false); }} aria-label={rest.label}>
          <Frame {...rest} expanded onExpandedChange={onExpandedChange} fill />
        </Dialog>
      </>
    );
  }
  // "100%" means fill the host (a flex page area); anything else sizes the editor area.
  if (height === '100%') {
    return (
      <Box sx={{ height: '100%', minHeight: 0 }}>
        <Frame {...rest} expanded={false} onExpandedChange={onExpandedChange} fill rounded />
      </Box>
    );
  }
  return (
    <Frame {...rest} expanded={false} onExpandedChange={onExpandedChange} fill={false} rounded>
      <Box sx={{ height }}>{rest.children}</Box>
    </Frame>
  );
}
