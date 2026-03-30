// ===========================================
// SMTP Destination Connector Form
// ===========================================
// Configuration form for SMTP email destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { SMTP_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

const CONTENT_TYPES = ['text/plain', 'text/html'] as const;

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

export function SmtpDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...SMTP_DEST_DEFAULTS });
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
      {/* Left column — SMTP Server */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          SMTP Server
        </Typography>

        <TextField
          label="Host"
          value={getStr(properties, 'host', '')}
          onChange={handleText('host')}
          helperText="SMTP server hostname"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Port"
          type="number"
          value={getNum(properties, 'port', 587)}
          onChange={handleNumber('port')}
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'secure', false)}
              onChange={handleBool('secure')}
            />
          }
          label="Use TLS/SSL"
          sx={{ mb: 2, display: 'block' }}
        />

        <TextField
          label="Username"
          value={getStr(properties, 'authUser', '')}
          onChange={handleText('authUser')}
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Password"
          type="password"
          value={getStr(properties, 'authPass', '')}
          onChange={handleText('authPass')}
          fullWidth
          sx={{ mb: 2 }}
        />
      </Grid>

      {/* Right column — Email */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Email
        </Typography>

        <TextField
          label="From"
          value={getStr(properties, 'from', '')}
          onChange={handleText('from')}
          helperText="Sender email address"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="To"
          value={getStr(properties, 'to', '')}
          onChange={handleText('to')}
          helperText="Recipient email address(es), comma-separated"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="CC"
          value={getStr(properties, 'cc', '')}
          onChange={handleText('cc')}
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="BCC"
          value={getStr(properties, 'bcc', '')}
          onChange={handleText('bcc')}
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Subject"
          value={getStr(properties, 'subject', '')}
          onChange={handleText('subject')}
          helperText="Supports ${msg}, ${messageId}, ${channelId}"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Body Template"
          value={getStr(properties, 'bodyTemplate', '${msg}')}
          onChange={handleText('bodyTemplate')}
          helperText="Email body template. Supports ${msg}, ${messageId}, ${channelId}"
          fullWidth
          multiline
          minRows={4}
          sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.875rem' } }}
        />

        <TextField
          label="Content Type"
          value={getStr(properties, 'contentType', 'text/plain')}
          onChange={handleText('contentType')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {CONTENT_TYPES.map((ct) => (
            <MenuItem key={ct} value={ct}>{ct}</MenuItem>
          ))}
        </TextField>

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'attachContent', false)}
              onChange={handleBool('attachContent')}
            />
          }
          label="Attach Message Content"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="SMTP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
