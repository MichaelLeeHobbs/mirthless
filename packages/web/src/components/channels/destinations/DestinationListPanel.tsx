// ===========================================
// Destination List Panel
// ===========================================
// Left sidebar showing the list of destinations with add/remove/reorder controls.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { DestinationFormValues } from './types.js';

interface DestinationListPanelProps {
  readonly destinations: readonly DestinationFormValues[];
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onMoveUp: (index: number) => void;
  readonly onMoveDown: (index: number) => void;
}

export function DestinationListPanel({
  destinations,
  selectedIndex,
  onSelect,
  onAdd,
  onRemove,
  onMoveUp,
  onMoveDown,
}: DestinationListPanelProps): ReactNode {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Destinations ({String(destinations.length)})
        </Typography>
        <Tooltip title="Add destination">
          <IconButton size="small" onClick={onAdd} aria-label="add destination">
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* List */}
      <List dense sx={{ flexGrow: 1, overflow: 'auto', minHeight: 0 }}>
        {destinations.map((dest, index) => (
          <ListItemButton
            key={index}
            selected={index === selectedIndex}
            onClick={() => { onSelect(index); }}
            sx={{ pr: 0.5 }}
          >
            <ListItemText
              primary={dest.name}
              secondary={dest.connectorType.replace('_', '/')}
              primaryTypographyProps={{
                noWrap: true,
                sx: { fontWeight: index === selectedIndex ? 600 : 400 },
              }}
              secondaryTypographyProps={{ noWrap: true }}
              sx={{ minWidth: 0 }}
            />
            {!dest.enabled ? (
              <Typography variant="caption" color="text.disabled" sx={{ mx: 0.5, flexShrink: 0 }}>
                OFF
              </Typography>
            ) : null}
          </ListItemButton>
        ))}
      </List>

      {/* Bottom controls */}
      {destinations.length > 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, py: 1, borderTop: 1, borderColor: 'divider' }}>
          <Tooltip title="Move up">
            <span>
              <IconButton
                size="small"
                disabled={selectedIndex <= 0}
                onClick={() => { onMoveUp(selectedIndex); }}
                aria-label="move destination up"
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Move down">
            <span>
              <IconButton
                size="small"
                disabled={selectedIndex >= destinations.length - 1}
                onClick={() => { onMoveDown(selectedIndex); }}
                aria-label="move destination down"
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Remove destination">
            <IconButton
              size="small"
              color="error"
              onClick={() => { onRemove(selectedIndex); }}
              aria-label="remove destination"
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}
    </Box>
  );
}
