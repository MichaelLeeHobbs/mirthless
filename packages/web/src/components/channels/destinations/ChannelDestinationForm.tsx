// ===========================================
// Channel Destination Connector Form
// ===========================================
// Configuration form for channel destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { CHANNEL_DEST_DEFAULTS } from './connector-defaults.js';

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getBool(props: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const val = props[key];
  return typeof val === 'boolean' ? val : fallback;
}

export function ChannelDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...CHANNEL_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const update = (key: string, value: unknown): void => {
    onChange({ ...properties, [key]: value });
  };

  const handleText = (key: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    update(key, e.target.value);
  };

  const handleBool = (key: string) => (_e: ChangeEvent<HTMLInputElement>, checked: boolean): void => {
    update(key, checked);
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Target Channel
        </Typography>

        <TextField
          label="Target Channel ID"
          value={getStr(properties, 'targetChannelId', '')}
          onChange={handleText('targetChannelId')}
          helperText="The channel ID to route messages to"
          fullWidth
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'waitForResponse', false)}
              onChange={handleBool('waitForResponse')}
            />
          }
          label="Wait for Response"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>
    </Grid>
  );
}
