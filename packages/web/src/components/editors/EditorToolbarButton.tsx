import { type ReactNode, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';

interface EditorToolbarButtonProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly tooltip: string;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
  readonly disabled?: boolean;
  readonly ariaHaspopup?: 'dialog' | 'menu';
}

export function EditorToolbarButton(
  { icon, label, ariaLabel, tooltip, onClick, disabled = false, ariaHaspopup }: EditorToolbarButtonProps,
): ReactNode {
  return (
    <Tooltip title={tooltip}>
      {/* The span keeps the tooltip working while the button is disabled. */}
      <span>
        <Button
          size="small"
          startIcon={icon}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-haspopup={ariaHaspopup}
          onClick={onClick}
          sx={{ textTransform: 'none', minWidth: 0, '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } } }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{label}</Box>
        </Button>
      </span>
    </Tooltip>
  );
}
