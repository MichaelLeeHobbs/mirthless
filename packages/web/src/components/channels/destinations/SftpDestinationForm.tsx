// ===========================================
// SFTP Destination Connector Form
// ===========================================
// Configuration form for SFTP writer destination connectors. Mirrors the File
// destination form but writes over SFTP. Property keys must match exactly what
// the SFTP destination connector reads (see connector-defaults.ts).

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { SFTP_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

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

export function SftpDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...SFTP_DEST_DEFAULTS });
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
      {/* Left column — Connection + credentials */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Connection
        </Typography>

        <TextField
          label="Host"
          value={getStr(properties, 'host', '')}
          onChange={handleText('host')}
          helperText="SFTP server hostname or IP"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Port"
          type="number"
          value={getNum(properties, 'port', 22)}
          onChange={handleNumber('port')}
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <TextField
          label="Username"
          value={getStr(properties, 'username', '')}
          onChange={handleText('username')}
          autoComplete="off"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Password"
          type="password"
          value={getStr(properties, 'password', '')}
          onChange={handleText('password')}
          helperText="Leave blank to use a private key"
          autoComplete="new-password"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Private Key"
          value={getStr(properties, 'privateKey', '')}
          onChange={handleText('privateKey')}
          helperText="PEM-encoded private key (optional)"
          type="password"
          multiline
          minRows={2}
          autoComplete="off"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Passphrase"
          type="password"
          value={getStr(properties, 'passphrase', '')}
          onChange={handleText('passphrase')}
          helperText="Passphrase for the private key (if any)"
          autoComplete="new-password"
          fullWidth
          sx={{ mb: 2 }}
        />
      </Grid>

      {/* Right column — Output settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Output
        </Typography>

        <TextField
          label="Remote Directory"
          value={getStr(properties, 'remoteDirectory', '')}
          onChange={handleText('remoteDirectory')}
          helperText="Remote path to write files to"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="File Name Template"
          value={getStr(properties, 'fileNameTemplate', '${messageId}.dat')}
          onChange={handleText('fileNameTemplate')}
          helperText="Filename pattern (${messageId}, ${timestamp})"
          fullWidth
          sx={{ mb: 2 }}
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

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'strictHostKey', false)}
              onChange={handleBool('strictHostKey')}
            />
          }
          label="Strict Host Key Checking"
          sx={{ mb: 1, display: 'block' }}
        />

        {getBool(properties, 'strictHostKey', false) && (
          <TextField
            label="Host Key"
            value={getStr(properties, 'hostKey', '')}
            onChange={handleText('hostKey')}
            helperText="Expected server host key (base64)"
            fullWidth
            sx={{ mb: 2 }}
          />
        )}
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="SFTP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
