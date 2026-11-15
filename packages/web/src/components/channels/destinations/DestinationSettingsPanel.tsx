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
import { DESTINATION_CONNECTOR_TYPES, type DestinationConnectorType } from '@galvaniflow/core-models';
import type { DestinationFormValues } from './types.js';
import { getDestDefaultProperties } from './connector-defaults.js';
import { DestinationConnectorSettings } from './DestinationConnectorSettings.js';
import { QueueSettingsSection } from './QueueSettingsSection.js';
import { DestinationFilterSection } from './DestinationFilterSection.js';
import { DestinationTransformerSection } from './DestinationTransformerSection.js';
import { ResponseTransformerSection } from './ResponseTransformerSection.js';

/** Dropdown label per destination type; the type list itself comes from core-models. */
const DESTINATION_TYPE_LABELS: Readonly<Record<DestinationConnectorType, string>> = {
  TCP_MLLP: 'TCP / MLLP',
  HTTP: 'HTTP',
  FILE: 'File',
  DATABASE: 'Database',
  JAVASCRIPT: 'JavaScript',
  SMTP: 'SMTP (Email)',
  CHANNEL: 'Channel',
  FHIR: 'FHIR',
  DICOM: 'DICOM',
  SFTP: 'SFTP',
  KAFKA: 'Kafka',
  AMQP: 'AMQP (RabbitMQ)',
};

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

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mb: 2 }}>
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
          {DESTINATION_CONNECTOR_TYPES.map((type) => (
            <MenuItem key={type} value={type}>{DESTINATION_TYPE_LABELS[type]}</MenuItem>
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

      {/* Filter settings */}
      <DestinationFilterSection
        filter={destination.filter}
        onChange={(filter) => { onChange({ filter }); }}
      />

      <Divider sx={{ my: 3 }} />

      {/* Transformer settings */}
      <DestinationTransformerSection
        transformer={destination.transformer}
        onChange={(transformer) => { onChange({ transformer }); }}
      />

      <Divider sx={{ my: 3 }} />

      {/* Response transformer (single script) */}
      <ResponseTransformerSection
        value={destination.responseTransformer}
        onChange={(responseTransformer) => { onChange({ responseTransformer }); }}
      />

      <Divider sx={{ my: 3 }} />

      {/* Queue settings */}
      <QueueSettingsSection destination={destination} onChange={onChange} />
    </Box>
  );
}
