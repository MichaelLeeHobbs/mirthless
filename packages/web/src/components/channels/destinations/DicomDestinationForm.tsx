// ===========================================
// DICOM Destination Connector Form
// ===========================================
// Configuration form for DICOM C-STORE SCU destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { DICOM_DEST_DEFAULTS } from './connector-defaults.js';

const SEND_MODES = ['single', 'multiple'] as const;

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

export function DicomDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...DICOM_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const update = (key: string, value: unknown): void => {
    onChange({ ...properties, [key]: value });
  };

  const handleText = (key: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    update(key, e.target.value);
  };

  const handleNumber = (key: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    const parsed = parseInt(e.target.value, 10);
    update(key, Number.isNaN(parsed) ? 0 : parsed);
  };

  const mode = getStr(properties, 'mode', 'multiple');

  return (
    <Grid container spacing={3}>
      {/* Left column — Remote SCP */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Remote SCP
        </Typography>

        <TextField
          label="Host"
          value={getStr(properties, 'host', 'localhost')}
          onChange={handleText('host')}
          helperText="Remote DICOM SCP hostname or IP"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Port"
          type="number"
          value={getNum(properties, 'port', 104)}
          onChange={handleNumber('port')}
          helperText="Remote SCP port (1-65535)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <TextField
          label="Called AE Title"
          value={getStr(properties, 'calledAETitle', 'PACS')}
          onChange={handleText('calledAETitle')}
          helperText="Remote SCP Application Entity Title (max 16)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { maxLength: 16 } }}
        />

        <TextField
          label="Calling AE Title"
          value={getStr(properties, 'callingAETitle', 'MIRTHLESS')}
          onChange={handleText('callingAETitle')}
          helperText="Local SCU Application Entity Title (max 16)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { maxLength: 16 } }}
        />
      </Grid>

      {/* Right column — Sending */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Sending
        </Typography>

        <TextField
          label="Mode"
          value={mode}
          onChange={handleText('mode')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {SEND_MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {m === 'single' ? 'Single (one association at a time)' : 'Multiple (concurrent associations)'}
            </MenuItem>
          ))}
        </TextField>

        {mode === 'multiple' && (
          <TextField
            label="Max Associations"
            type="number"
            value={getNum(properties, 'maxAssociations', 4)}
            onChange={handleNumber('maxAssociations')}
            helperText="Maximum concurrent associations"
            fullWidth
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { min: 1, max: 64 } }}
          />
        )}

        <TextField
          label="Timeout (ms)"
          type="number"
          value={getNum(properties, 'timeoutMs', 30000)}
          onChange={handleNumber('timeoutMs')}
          helperText="Per-send timeout"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1000 } }}
        />

        <TextField
          label="Max Retries"
          type="number"
          value={getNum(properties, 'maxRetries', 3)}
          onChange={handleNumber('maxRetries')}
          helperText="Retry attempts per send (0 = no retry)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 0 } }}
        />

        <TextField
          label="Retry Delay (ms)"
          type="number"
          value={getNum(properties, 'retryDelayMs', 1000)}
          onChange={handleNumber('retryDelayMs')}
          helperText="Base delay between retries"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 0 } }}
        />
      </Grid>
    </Grid>
  );
}
