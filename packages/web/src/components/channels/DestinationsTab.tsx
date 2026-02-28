// ===========================================
// Destinations Tab
// ===========================================
// Two-panel layout: destination list (left) + settings (right).

import { useState, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { DestinationFormValues } from './destinations/types.js';
import { createDefaultDestination } from './destinations/connector-defaults.js';
import { DestinationListPanel } from './destinations/DestinationListPanel.js';
import { DestinationSettingsPanel } from './destinations/DestinationSettingsPanel.js';

interface DestinationsTabProps {
  readonly destinations: readonly DestinationFormValues[];
  readonly onChange: (destinations: readonly DestinationFormValues[]) => void;
}

export function DestinationsTab({ destinations, onChange }: DestinationsTabProps): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleAdd = useCallback((): void => {
    const newDest = createDefaultDestination(destinations.length);
    const updated = [...destinations, newDest];
    onChange(updated);
    setSelectedIndex(updated.length - 1);
  }, [destinations, onChange]);

  const handleRemove = useCallback((index: number): void => {
    const updated = destinations.filter((_, i) => i !== index);
    onChange(updated);
    if (selectedIndex >= updated.length) {
      setSelectedIndex(Math.max(0, updated.length - 1));
    }
  }, [destinations, onChange, selectedIndex]);

  const handleMoveUp = useCallback((index: number): void => {
    if (index <= 0) return;
    const updated = [...destinations];
    const temp = updated[index - 1]!;
    updated[index - 1] = updated[index]!;
    updated[index] = temp;
    onChange(updated);
    setSelectedIndex(index - 1);
  }, [destinations, onChange]);

  const handleMoveDown = useCallback((index: number): void => {
    if (index >= destinations.length - 1) return;
    const updated = [...destinations];
    const temp = updated[index + 1]!;
    updated[index + 1] = updated[index]!;
    updated[index] = temp;
    onChange(updated);
    setSelectedIndex(index + 1);
  }, [destinations, onChange]);

  const handleDestUpdate = useCallback((updates: Partial<DestinationFormValues>): void => {
    const updated = destinations.map((d, i) =>
      i === selectedIndex ? { ...d, ...updates } : d,
    );
    onChange(updated);
  }, [destinations, selectedIndex, onChange]);

  const selected = destinations[selectedIndex];

  return (
    <Box sx={{ display: 'flex', gap: 2, minHeight: 500 }}>
      {/* Left panel — destination list */}
      <Paper
        variant="outlined"
        sx={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' }}
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

      {/* Right panel — settings */}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {selected ? (
          <DestinationSettingsPanel
            key={selectedIndex}
            destination={selected}
            onChange={handleDestUpdate}
          />
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Typography color="text.secondary">
              No destinations. Click + to add one.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
