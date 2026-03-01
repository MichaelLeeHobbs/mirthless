// ===========================================
// JavaScript Source Connector Form
// ===========================================
// Configuration form for JavaScript source connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { JAVASCRIPT_SOURCE_DEFAULTS } from './connector-defaults.js';

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

export function JavaScriptSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...JAVASCRIPT_SOURCE_DEFAULTS });
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

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Script
        </Typography>

        <TextField
          label="Polling Script"
          value={getStr(properties, 'script', '')}
          onChange={handleText('script')}
          helperText="JavaScript that returns a string or array of strings. Each returned string becomes a message."
          fullWidth
          multiline
          minRows={8}
          maxRows={20}
          sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.875rem' } }}
        />

        <TextField
          label="Polling Interval (ms)"
          type="number"
          value={getNum(properties, 'pollingIntervalMs', 5000)}
          onChange={handleNumber('pollingIntervalMs')}
          helperText="How often to execute the script"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 100 } }}
        />
      </Grid>
    </Grid>
  );
}
