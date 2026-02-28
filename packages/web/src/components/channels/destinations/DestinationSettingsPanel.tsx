// ===========================================
// Destination Settings Panel
// ===========================================
// Right panel: name, enabled, connector type, connector form, queue settings.

import { useRef, useEffect, type ReactNode, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { DestinationFormValues } from './types.js';
import { getDestDefaultProperties } from './connector-defaults.js';
import { DestinationConnectorSettings } from './DestinationConnectorSettings.js';
import { QueueSettingsSection } from './QueueSettingsSection.js';

const CONNECTOR_TYPES = [
  { value: 'TCP_MLLP', label: 'TCP / MLLP' },
  { value: 'HTTP', label: 'HTTP' },
  { value: 'FILE', label: 'File' },
  { value: 'DATABASE', label: 'Database' },
  { value: 'JAVASCRIPT', label: 'JavaScript' },
  { value: 'CHANNEL', label: 'Channel' },
  { value: 'DICOM', label: 'DICOM' },
  { value: 'FHIR', label: 'FHIR' },
] as const;

interface DestinationSettingsPanelProps {
  readonly destination: DestinationFormValues;
  readonly onChange: (updates: Partial<DestinationFormValues>) => void;
}

export function DestinationSettingsPanel({ destination, onChange }: DestinationSettingsPanelProps): ReactNode {
  const prevConnectorTypeRef = useRef(destination.connectorType);

  // Reset properties when connector type changes
  useEffect(() => {
    if (destination.connectorType !== prevConnectorTypeRef.current) {
      prevConnectorTypeRef.current = destination.connectorType;
      onChange({ properties: getDestDefaultProperties(destination.connectorType) });
    }
  }, [destination.connectorType, onChange]);

  return (
    <Box>
      {/* General settings */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        General
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          label="Destination Name"
          value={destination.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ name: e.target.value }); }}
          fullWidth
        />

        <TextField
          label="Connector Type"
          value={destination.connectorType}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ connectorType: e.target.value }); }}
          select
          sx={{ minWidth: 200 }}
        >
          {CONNECTOR_TYPES.map((ct) => (
            <MenuItem key={ct.value} value={ct.value}>{ct.label}</MenuItem>
          ))}
        </TextField>
      </Box>

      <FormControlLabel
        control={
          <Switch
            checked={destination.enabled}
            onChange={(_e, checked) => { onChange({ enabled: checked }); }}
          />
        }
        label="Enabled"
        sx={{ mb: 2, display: 'block' }}
      />

      <Divider sx={{ my: 3 }} />

      {/* Connector-specific settings */}
      <DestinationConnectorSettings
        connectorType={destination.connectorType}
        properties={destination.properties}
        onChange={(properties) => { onChange({ properties }); }}
      />

      <Divider sx={{ my: 3 }} />

      {/* Queue settings */}
      <QueueSettingsSection destination={destination} onChange={onChange} />
    </Box>
  );
}
