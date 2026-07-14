// ===========================================
// HTTP Destination Connector Form
// ===========================================
// Configuration form for HTTP client destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import type { DestConnectorFormProps } from './types.js';
import { HTTP_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { HeadersEditor, coerceHeaders } from '../../common/HeadersEditor.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

/** Read the nested `tls` object, tolerating a missing/invalid value. */
function getTls(props: Record<string, unknown>): Record<string, unknown> {
  const tls = props['tls'];
  return tls !== null && typeof tls === 'object' ? tls as Record<string, unknown> : {};
}

function getTlsStr(props: Record<string, unknown>, key: string): string {
  const val = getTls(props)[key];
  return typeof val === 'string' ? val : '';
}

function getTlsBool(props: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const val = getTls(props)[key];
  return typeof val === 'boolean' ? val : fallback;
}

export function HttpDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...HTTP_DEST_DEFAULTS });
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

  const updateTls = (key: string, value: unknown): void => {
    update('tls', { ...getTls(properties), [key]: value });
  };

  const handleTlsText = (key: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    updateTls(key, e.target.value);
  };

  return (
    <Grid container spacing={3}>
      {/* Left column — Request settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Request
        </Typography>

        <TextField
          label="URL"
          value={getStr(properties, 'url', 'http://localhost:8080')}
          onChange={handleText('url')}
          helperText="Target URL for outbound requests"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Method"
          value={getStr(properties, 'method', 'POST')}
          onChange={handleText('method')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {HTTP_METHODS.map((m) => (
            <MenuItem key={m} value={m}>{m}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Content Type"
          value={getStr(properties, 'contentType', 'text/plain')}
          onChange={handleText('contentType')}
          helperText="Content-Type header for the request body"
          fullWidth
          sx={{ mb: 2 }}
        />

        <HeadersEditor
          value={coerceHeaders(properties['headers'])}
          onChange={(headers) => { update('headers', headers); }}
          label="Additional request headers"
        />
      </Grid>

      {/* Right column — Response settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Connection
        </Typography>

        <TextField
          label="Response Timeout (ms)"
          type="number"
          value={getNum(properties, 'responseTimeout', 30000)}
          onChange={handleNumber('responseTimeout')}
          helperText="Timeout waiting for response (0 = no timeout)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 0 } }}
        />
      </Grid>

      {/* TLS / client certificates — only used for https:// URLs */}
      <Grid item xs={12}>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
          TLS / Certificates
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Applied only for https:// URLs. Leave blank to use the system trust store.
        </Typography>

        <TextField
          label="CA Certificate (PEM)"
          value={getTlsStr(properties, 'ca')}
          onChange={handleTlsText('ca')}
          helperText="Trust this custom/internal CA when verifying the server certificate"
          fullWidth
          multiline
          minRows={3}
          sx={{ mb: 2, '& textarea': { fontFamily: 'monospace' } }}
        />

        <TextField
          label="Client Certificate (PEM)"
          value={getTlsStr(properties, 'cert')}
          onChange={handleTlsText('cert')}
          helperText="Client certificate chain for mutual TLS (optional)"
          fullWidth
          multiline
          minRows={3}
          sx={{ mb: 2, '& textarea': { fontFamily: 'monospace' } }}
        />

        <TextField
          label="Client Key (PEM)"
          value={getTlsStr(properties, 'key')}
          onChange={handleTlsText('key')}
          helperText="Private key for the client certificate (optional)"
          fullWidth
          multiline
          minRows={3}
          sx={{ mb: 2, '& textarea': { fontFamily: 'monospace' } }}
        />

        <FormControlLabel
          control={(
            <Switch
              checked={getTlsBool(properties, 'rejectUnauthorized', true)}
              onChange={(e) => { updateTls('rejectUnauthorized', e.target.checked); }}
            />
          )}
          label="Reject unauthorized certificates"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1 }}>
          Keep enabled. Disabling skips server certificate verification (insecure — audited exceptions only).
        </Typography>
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="HTTP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
