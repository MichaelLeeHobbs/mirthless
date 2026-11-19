import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

interface ItemOrderActionsProps {
  /** "rule" or "step", for the button labels. */
  readonly noun: string;
  readonly index: number;
  readonly total: number;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onRemove: () => void;
}

export function ItemOrderActions({ noun, index, total, onMoveUp, onMoveDown, onRemove }: ItemOrderActionsProps): ReactNode {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 'auto' }}>
      <Tooltip title={`Move ${noun} up`}>
        <span>
          <IconButton size="small" onClick={onMoveUp} disabled={index === 0} aria-label={`Move ${noun} up`}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={`Move ${noun} down`}>
        <span>
          <IconButton size="small" onClick={onMoveDown} disabled={index === total - 1} aria-label={`Move ${noun} down`}>
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={`Remove ${noun}`}>
        <IconButton size="small" onClick={onRemove} aria-label={`Remove ${noun}`}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
