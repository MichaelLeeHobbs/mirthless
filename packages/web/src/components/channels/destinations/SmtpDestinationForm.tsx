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
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { DestConnectorFormProps } from './types.js';
import { SMTP_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

const CONTENT_TYPES = ['text/plain', 'text/html'] as const;
const DEFAULT_MIME_TYPE = 'text/plain';

interface AttachmentRow {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string;
}

/** Read `properties.attachments` into a normalized row list (tolerant of junk). */
function getAttachments(props: Record<string, unknown>): readonly AttachmentRow[] {
  const val = props['attachments'];
  if (!Array.isArray(val)) return [];
  return val.map((item): AttachmentRow => {
    const rec = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    return {
      filename: typeof rec['filename'] === 'string' ? rec['filename'] : '',
      mimeType: typeof rec['mimeType'] === 'string' ? rec['mimeType'] : DEFAULT_MIME_TYPE,
      content: typeof rec['content'] === 'string' ? rec['content'] : '',
    };
  });
}

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

interface AttachmentsEditorProps {
  readonly value: readonly AttachmentRow[];
  readonly onChange: (next: readonly AttachmentRow[]) => void;
}

/** Editable list of config-driven attachments (filename / MIME type / content). */
function AttachmentsEditor({ value, onChange }: AttachmentsEditorProps): ReactNode {
  const setRow = (index: number, key: keyof AttachmentRow, v: string): void => {
    onChange(value.map((row, i) => (i === index ? { ...row, [key]: v } : row)));
  };
  const addRow = (): void => {
    onChange([...value, { filename: '', mimeType: DEFAULT_MIME_TYPE, content: '' }]);
  };
  const removeRow = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Attachments
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Each attachment is added in addition to any message content above. Filename and content support ${'{msg}'}, ${'{messageId}'}, ${'{channelId}'}, ${'{metaDataId}'}.
      </Typography>

      {value.map((row, index) => (
        <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2 }}>
          <TextField
            label="Filename"
            value={row.filename}
            onChange={(e) => { setRow(index, 'filename', e.target.value); }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="MIME Type"
            value={row.mimeType}
            onChange={(e) => { setRow(index, 'mimeType', e.target.value); }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Content"
            value={row.content}
            onChange={(e) => { setRow(index, 'content', e.target.value); }}
            multiline
            minRows={1}
            sx={{ flex: 2, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.875rem' } }}
          />
          <Button color="error" onClick={() => { removeRow(index); }} sx={{ mt: 1 }}>
            Remove
          </Button>
        </Box>
      ))}

      <Button variant="outlined" onClick={addRow}>Add Attachment</Button>
    </>
  );
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

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'requireTLS', false)}
              onChange={handleBool('requireTLS')}
              disabled={getBool(properties, 'secure', false)}
            />
          }
          label="Require STARTTLS"
          sx={{ mb: 0, display: 'block' }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Forces a STARTTLS upgrade before auth on a non-secure port, so credentials are never sent in plaintext. Not needed when Use TLS/SSL is on (already implicit TLS).
        </Typography>

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
        <AttachmentsEditor
          value={getAttachments(properties)}
          onChange={(next) => { update('attachments', next); }}
        />
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="SMTP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
