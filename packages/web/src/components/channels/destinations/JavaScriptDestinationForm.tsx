// ===========================================
// JavaScript Destination Connector Form
// ===========================================
// Configuration form for JavaScript destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { JAVASCRIPT_DEST_DEFAULTS } from './connector-defaults.js';

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

export function JavaScriptDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...JAVASCRIPT_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const handleText = (key: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...properties, [key]: e.target.value });
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Script
        </Typography>

        <TextField
          label="Destination Script"
          value={getStr(properties, 'script', '')}
          onChange={handleText('script')}
          helperText="JavaScript with access to 'msg' (message content) and 'connectorMessage'. Return value becomes response."
          fullWidth
          multiline
          minRows={8}
          maxRows={20}
          sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.875rem' } }}
        />
      </Grid>
    </Grid>
  );
}
