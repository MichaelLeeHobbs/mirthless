// ===========================================
// TCP/MLLP Destination Connector Form
// ===========================================
// Configuration form for TCP/MLLP client destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { TCP_MLLP_DEST_DEFAULTS } from './connector-defaults.js';

const CHARSETS = ['UTF-8', 'ISO-8859-1', 'US-ASCII'] as const;
const TRANSMISSION_MODES = ['MLLP', 'RAW', 'DELIMITED'] as const;

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

function getBool(props: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const val = props[key];
  return typeof val === 'boolean' ? val : fallback;
}

export function TcpMllpDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...TCP_MLLP_DEST_DEFAULTS });
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

  const handleBool = (key: string) => (_e: ChangeEvent<HTMLInputElement>, checked: boolean): void => {
    update(key, checked);
  };

  return (
    <Grid container spacing={3}>
      {/* Left column — Network settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Network
        </Typography>

        <TextField
          label="Remote Host"
          value={getStr(properties, 'host', 'localhost')}
          onChange={handleText('host')}
          helperText="Hostname or IP of the remote server"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Remote Port"
          type="number"
          value={getNum(properties, 'port', 6661)}
          onChange={handleNumber('port')}
          helperText="TCP port (1-65535)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <TextField
          label="Send Timeout (ms)"
          type="number"
          value={getNum(properties, 'sendTimeout', 10000)}
          onChange={handleNumber('sendTimeout')}
          helperText="Timeout for sending messages (0 = no timeout)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 0 } }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'keepConnectionOpen', true)}
              onChange={handleBool('keepConnectionOpen')}
            />
          }
          label="Keep Connection Open"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>

      {/* Right column — Data settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Data
        </Typography>

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

        <TextField
          label="Transmission Mode"
          value={getStr(properties, 'transmissionMode', 'MLLP')}
          onChange={handleText('transmissionMode')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {TRANSMISSION_MODES.map((m) => (
            <MenuItem key={m} value={m}>{m}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Buffer Size (bytes)"
          type="number"
          value={getNum(properties, 'bufferSize', 65536)}
          onChange={handleNumber('bufferSize')}
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1024 } }}
        />
      </Grid>
    </Grid>
  );
}
