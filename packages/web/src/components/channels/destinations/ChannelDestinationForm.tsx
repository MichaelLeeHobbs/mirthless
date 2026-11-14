// ===========================================
// Channel Destination Connector Form
// ===========================================
// Configuration form for channel destination connectors.

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { CHANNEL_DEST_DEFAULTS } from './connector-defaults.js';
import { getStr, getBool, propertyUpdaters } from '../common/connector-properties.js';

export function ChannelDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...CHANNEL_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const { handleText, handleBool } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      <Grid
        size={{
          xs: 12,
          md: 6
        }}>
        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
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
