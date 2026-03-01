// ===========================================
// Channel Source Connector Form
// ===========================================
// Configuration form for channel source connectors.
// Minimal — the source receives messages from other channels automatically.

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import type { SourceConnectorFormProps } from './types.js';
import { CHANNEL_SOURCE_DEFAULTS } from './connector-defaults.js';

export function ChannelSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...CHANNEL_SOURCE_DEFAULTS });
    }
  }, [properties, onChange]);

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Channel Source
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          This channel receives messages from other channels that have a Channel destination
          configured to route to this channel. No additional configuration is needed.
        </Alert>
      </Grid>
    </Grid>
  );
}
