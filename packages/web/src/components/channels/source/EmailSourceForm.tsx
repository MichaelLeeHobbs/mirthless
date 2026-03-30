// ===========================================
// Email Source Connector Form
// ===========================================
// Configuration form for Email (IMAP/POP3) source connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { EMAIL_SOURCE_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

const PROTOCOLS = ['IMAP', 'POP3'] as const;
const POST_ACTIONS = ['DELETE', 'MARK_READ', 'MOVE'] as const;

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

export function EmailSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...EMAIL_SOURCE_DEFAULTS });
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

  const handleCheck = (key: string) => (_e: ChangeEvent<HTMLInputElement>, checked: boolean): void => {
    update(key, checked);
  };

  const postAction = getStr(properties, 'postAction', 'MARK_READ');

  return (
    <Grid container spacing={3}>
      {/* Left column -- Connection */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Connection
        </Typography>

        <TextField
          label="Host"
          value={getStr(properties, 'host', '')}
          onChange={handleText('host')}
          helperText="Mail server hostname"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Port"
          type="number"
          value={getNum(properties, 'port', 993)}
          onChange={handleNumber('port')}
          helperText="Mail server port (1-65535)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={getBool(properties, 'secure', true)}
              onChange={handleCheck('secure')}
            />
          }
          label="Use SSL/TLS"
          sx={{ mb: 2, display: 'block' }}
        />

        <TextField
          label="Username"
          value={getStr(properties, 'username', '')}
          onChange={handleText('username')}
          helperText="Mail account username"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Password"
          type="password"
          value={getStr(properties, 'password', '')}
          onChange={handleText('password')}
          helperText="Mail account password"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Protocol"
          value={getStr(properties, 'protocol', 'IMAP')}
          onChange={handleText('protocol')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {PROTOCOLS.map((p) => (
            <MenuItem key={p} value={p}>{p}</MenuItem>
          ))}
        </TextField>
      </Grid>

      {/* Right column -- Polling & Processing */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Polling & Processing
        </Typography>

        <TextField
          label="Folder"
          value={getStr(properties, 'folder', 'INBOX')}
          onChange={handleText('folder')}
          helperText="Mailbox folder to poll"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Polling Interval (ms)"
          type="number"
          value={getNum(properties, 'pollingIntervalMs', 60000)}
          onChange={handleNumber('pollingIntervalMs')}
          helperText="Minimum 1000ms"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1000 } }}
        />

        <TextField
          label="Post Action"
          value={postAction}
          onChange={handleText('postAction')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {POST_ACTIONS.map((a) => (
            <MenuItem key={a} value={a}>
              {a === 'DELETE' ? 'Delete' : a === 'MARK_READ' ? 'Mark as Read' : 'Move'}
            </MenuItem>
          ))}
        </TextField>

        {postAction === 'MOVE' && (
          <TextField
            label="Move-To Folder"
            value={getStr(properties, 'moveToFolder', '')}
            onChange={handleText('moveToFolder')}
            helperText="Target folder for processed emails"
            fullWidth
            sx={{ mb: 2 }}
          />
        )}

        <TextField
          label="Subject Filter"
          value={getStr(properties, 'subjectFilter', '')}
          onChange={handleText('subjectFilter')}
          helperText="Only process emails containing this text in subject (leave empty for all)"
          fullWidth
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={getBool(properties, 'includeAttachments', false)}
              onChange={handleCheck('includeAttachments')}
            />
          }
          label="Include Attachments"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="EMAIL" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
