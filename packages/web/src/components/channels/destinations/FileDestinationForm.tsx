// ===========================================
// File Destination Connector Form
// ===========================================
// Configuration form for file writer destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { FILE_DEST_DEFAULTS } from './connector-defaults.js';

const CHARSETS = ['UTF-8', 'ISO-8859-1', 'US-ASCII'] as const;

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getBool(props: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const val = props[key];
  return typeof val === 'boolean' ? val : fallback;
}

export function FileDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...FILE_DEST_DEFAULTS });
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
      {/* Left column — Output settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Output
        </Typography>

        <TextField
          label="Directory"
          value={getStr(properties, 'directory', '')}
          onChange={handleText('directory')}
          helperText="Path to the output directory"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Output Pattern"
          value={getStr(properties, 'outputPattern', '${messageId}.txt')}
          onChange={handleText('outputPattern')}
          helperText="Filename pattern (${messageId}, ${timestamp}, ${originalFilename})"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Charset"
          value={getStr(properties, 'charset', 'UTF-8')}
          onChange={handleText('charset')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {CHARSETS.map((c) => (
            <MenuItem key={c} value={c}>{c}</MenuItem>
          ))}
        </TextField>
      </Grid>

      {/* Right column — Write settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Write Options
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'binary', false)}
              onChange={handleBool('binary')}
            />
          }
          label="Binary Mode"
          sx={{ mb: 2, display: 'block' }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'tempFileEnabled', true)}
              onChange={handleBool('tempFileEnabled')}
            />
          }
          label="Use Temp File"
          sx={{ mb: 2, display: 'block' }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'appendMode', false)}
              onChange={handleBool('appendMode')}
            />
          }
          label="Append Mode"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>
    </Grid>
  );
}
