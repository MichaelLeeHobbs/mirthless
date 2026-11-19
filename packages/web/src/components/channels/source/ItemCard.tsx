// Open, the item's settings take the header row, so the card spends one row on
// them instead of a title row plus a settings row. The body stays mounted while
// closed, as an accordion's would.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

interface ItemCardProps {
  readonly title: string;
  readonly summary: ReactNode;
  /** The header row while open. */
  readonly settings: ReactNode;
  readonly children: ReactNode;
}

export function ItemCard({ title, summary, settings, children }: ItemCardProps): ReactNode {
  const [open, setOpen] = useState(false);
  // The button you press is replaced by the other one, so focus follows it
  // instead of falling to the page. Not on first render: nothing was pressed.
  const toggled = useRef(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toggled.current) return;
    (open ? collapseButton : openButton).current?.focus();
  }, [open]);
  const toggle = (next: boolean): void => { toggled.current = true; setOpen(next); };

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', '& + &': { mt: 1 } }}>
      {open ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', px: 1.5, pt: 1.5, pb: 1 }}>
          {settings}
          <Tooltip title="Collapse">
            <IconButton ref={collapseButton} size="small" aria-label={`Collapse ${title}`} aria-expanded onClick={() => { toggle(false); }}>
              <ExpandLessIcon />
            </IconButton>
          </Tooltip>
        </Box>
      ) : (
        <ButtonBase
          ref={openButton}
          aria-expanded={false}
          onClick={() => { toggle(true); }}
          sx={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, textAlign: 'left', borderRadius: 1,
            // ButtonBase removes the outline; keyboard users still need to see where they are.
            '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
          }}
        >
          <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{title}</Typography>
          <Typography variant="caption" component="span" sx={{ color: 'text.secondary' }}>{summary}</Typography>
          <ExpandMoreIcon sx={{ color: 'action.active' }} />
        </ButtonBase>
      )}
      <Collapse in={open}>
        <Box sx={{ px: 1.5, pb: 1.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}
