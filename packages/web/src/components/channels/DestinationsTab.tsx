import { useState, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { DestinationFormValues } from './destinations/types.js';
import { createDefaultDestination } from './destinations/connector-defaults.js';
import { DestinationListPanel } from './destinations/DestinationListPanel.js';
import { DestinationSettingsPanel } from './destinations/DestinationSettingsPanel.js';
import { useListKeys } from '../../hooks/use-list-keys.js';

interface DestinationsTabProps {
  readonly destinations: readonly DestinationFormValues[];
  readonly onChange: (destinations: readonly DestinationFormValues[]) => void;
}

export function DestinationsTab({ destinations, onChange }: DestinationsTabProps): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);
  // The settings panel is keyed by the destination, not its position, so a
  // removed or moved destination's editors (and their undo) go with it (#228).
  const { keys, remove: removeKey, swap: swapKeys } = useListKeys(destinations.length);

  const handleAdd = useCallback((): void => {
    const newDest = createDefaultDestination(destinations);
    const updated = [...destinations, newDest];
    onChange(updated);
    setSelectedIndex(updated.length - 1);
  }, [destinations, onChange]);

  const handleRemove = useCallback((index: number): void => {
    const updated = destinations.filter((_, i) => i !== index);
    removeKey(index);
    onChange(updated);
    // Stay on the same destination when one before it goes; on the next one when it goes.
    const next = index < selectedIndex ? selectedIndex - 1 : selectedIndex;
    setSelectedIndex(Math.max(0, Math.min(next, updated.length - 1)));
  }, [destinations, onChange, selectedIndex, removeKey]);

  const handleMoveUp = useCallback((index: number): void => {
    if (index <= 0) return;
    const updated = [...destinations];
    const temp = updated[index - 1]!;
    updated[index - 1] = updated[index]!;
    updated[index] = temp;
    swapKeys(index - 1, index);
    onChange(updated);
    setSelectedIndex(index - 1);
  }, [destinations, onChange, swapKeys]);

  const handleMoveDown = useCallback((index: number): void => {
    if (index >= destinations.length - 1) return;
    const updated = [...destinations];
    const temp = updated[index + 1]!;
    updated[index + 1] = updated[index]!;
    updated[index] = temp;
    swapKeys(index, index + 1);
    onChange(updated);
    setSelectedIndex(index + 1);
  }, [destinations, onChange, swapKeys]);

  const handleDestUpdate = useCallback((updates: Partial<DestinationFormValues>): void => {
    const updated = destinations.map((d, i) =>
      i === selectedIndex ? { ...d, ...updates } : d,
    );
    onChange(updated);
  }, [destinations, selectedIndex, onChange]);

  const selected = destinations[selectedIndex];

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, minHeight: { md: 500 } }}>
      <Paper
        variant="outlined"
        sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0, display: 'flex', flexDirection: 'column' }}
      >
        <DestinationListPanel
          destinations={destinations}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
        />
      </Paper>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {selected ? (
          <DestinationSettingsPanel
            key={keys[selectedIndex]}
            destination={selected}
            onChange={handleDestUpdate}
          />
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Typography sx={{
              color: 'text.secondary'
            }}>
              No destinations. Click + to add one.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
