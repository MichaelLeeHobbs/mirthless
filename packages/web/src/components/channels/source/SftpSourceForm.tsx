// ===========================================
// SFTP Source Connector Form
// ===========================================
// Configuration form for SFTP reader source connectors. Mirrors the File source
// form but polls a remote directory over SFTP. Property keys must match exactly
// what the SFTP source connector reads (see connector-defaults.ts).

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { SFTP_SOURCE_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

const AFTER_PROCESSING = ['DELETE', 'MOVE', 'NONE'] as const;

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

export function SftpSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...SFTP_SOURCE_DEFAULTS });
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

  const afterProcessing = getStr(properties, 'afterProcessing', 'DELETE');

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

      {/* Right column — Polling + processing */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Polling
        </Typography>

        <TextField
          label="Remote Directory"
          value={getStr(properties, 'remoteDirectory', '')}
          onChange={handleText('remoteDirectory')}
          helperText="Remote path to read files from"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="File Pattern"
          value={getStr(properties, 'filePattern', '*')}
          onChange={handleText('filePattern')}
          helperText="Glob pattern to match files (e.g., *.hl7)"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Polling Interval (ms)"
          type="number"
          value={getNum(properties, 'pollingIntervalMs', 5000)}
          onChange={handleNumber('pollingIntervalMs')}
          helperText="How often to check for new files"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 100 } }}
        />

        <TextField
          label="Minimum File Age (ms)"
          type="number"
          value={getNum(properties, 'minFileAgeMs', 1000)}
          onChange={handleNumber('minFileAgeMs')}
          helperText="Only process files older than this age"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 0 } }}
        />

        <TextField
          label="After Processing"
          value={afterProcessing}
          onChange={handleText('afterProcessing')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {AFTER_PROCESSING.map((a) => (
            <MenuItem key={a} value={a}>{a}</MenuItem>
          ))}
        </TextField>

        {afterProcessing === 'MOVE' && (
          <TextField
            label="Move-To Directory"
            value={getStr(properties, 'moveToDirectory', '')}
            onChange={handleText('moveToDirectory')}
            helperText="Remote directory to move processed files to"
            fullWidth
            sx={{ mb: 2 }}
          />
        )}

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'strictHostKey', true)}
              onChange={handleBool('strictHostKey')}
            />
          }
          label="Strict Host Key Checking"
          sx={{ mb: 1, display: 'block' }}
        />

        {getBool(properties, 'strictHostKey', true) && (
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
        <TestConnectionButton connectorType="SFTP" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
