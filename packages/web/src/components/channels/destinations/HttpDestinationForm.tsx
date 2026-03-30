// ===========================================
// HTTP Destination Connector Form
// ===========================================
// Configuration form for HTTP client destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { HTTP_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

const CHARSETS = ['UTF-8', 'ISO-8859-1', 'US-ASCII'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
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

        <TextField
          label="Headers"
          value={getStr(properties, 'headers', '')}
          onChange={handleText('headers')}
          helperText="Additional headers (key: value, one per line)"
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
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

      <Grid item xs={12}>
        <TestConnectionButton connectorType="HTTP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
