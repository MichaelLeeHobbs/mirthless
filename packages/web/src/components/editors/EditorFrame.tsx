// Full screen restyles the same elements rather than rendering the editor again in a dialog: a second editor would start with an empty undo history and lose the cursor (#183).

import { type KeyboardEvent, type ReactNode, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import { RADIUS } from '../../styles/tokens.js';
import { EditorToolbarButton } from './EditorToolbarButton.js';

interface EditorFrameProps {
  readonly label: string;
  /** Off when the host already titles the editor. */
  readonly showLabel?: boolean;
  readonly start?: ReactNode;
  readonly end?: ReactNode;
  readonly status?: ReactNode;
  readonly footer?: ReactNode;
  readonly height: string | number;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly children: ReactNode;
}

function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [locked]);
}

export function EditorFrame({
  label, showLabel, start, end, status, footer, height, expanded, onExpandedChange, children,
}: EditorFrameProps): ReactNode {
  useScrollLock(expanded);
  // "100%" means fill the host (a flex page area); anything else sizes the editor area.
  const fills = height === '100%';
  // Escape leaves full screen unless the editor used it (closing its completion list).
  const onKeyDown = (e: KeyboardEvent): void => {
    if (expanded && e.key === 'Escape' && !e.defaultPrevented) onExpandedChange(false);
  };

  return (
    // While expanded this keeps the editor's place in the page, so nothing below it jumps.
    <Box sx={{ height: fills ? '100%' : 'auto', minHeight: 0 }}>
      <Box
        role={expanded ? 'dialog' : 'group'}
        aria-modal={expanded ? true : undefined}
        aria-label={label}
        onKeyDown={onKeyDown}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: fills || expanded ? '100%' : 'auto',
          border: 1,
          borderColor: 'divider',
          borderRadius: expanded ? 0 : `${String(RADIUS.md)}px`,
          bgcolor: 'background.paper',
          overflow: 'hidden',
          transition: 'border-color 120ms, box-shadow 120ms',
          '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 3px ${t.palette.action.focus}` },
          ...(expanded ? { position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.modal } : {}),
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
          <EditorToolbarButton
            icon={expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
            label={expanded ? 'Exit full screen' : 'Full screen'}
            ariaLabel={expanded ? 'Exit full screen' : 'Expand to full screen'}
            tooltip={expanded ? 'Exit full screen (Esc)' : 'Expand to full screen'}
            onClick={() => { onExpandedChange(!expanded); }}
          />
        </Box>
        <Box sx={{ flexGrow: 1, minHeight: 0 }}>
          <Box sx={{ height: fills || expanded ? '100%' : height }}>{children}</Box>
        </Box>
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
        {footer}
      </Box>
      {/* The editor's place while it covers the window. */}
      {expanded && !fills ? (
        <Box sx={{ height, border: 1, borderColor: 'divider', borderRadius: `${String(RADIUS.md)}px`, bgcolor: 'action.hover' }} />
      ) : null}
    </Box>
  );
}
