// ===========================================
// HTTP Source Connector Form
// ===========================================
// Configuration form for HTTP listener source connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import type { SourceConnectorFormProps } from './types.js';
import { HTTP_SOURCE_DEFAULTS } from './connector-defaults.js';

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

function getStrArray(props: Record<string, unknown>, key: string, fallback: readonly string[]): readonly string[] {
  const val = props[key];
  return Array.isArray(val) ? val as string[] : fallback;
}

export function HttpSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  // Populate defaults on mount if properties are empty
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...HTTP_SOURCE_DEFAULTS });
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

  const handleMethodsChange = (e: SelectChangeEvent<string[]>): void => {
    const value = e.target.value;
    update('methods', typeof value === 'string' ? value.split(',') : value);
  };

  return (
    <Grid container spacing={3}>
      {/* Left column — Listener settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Listener
        </Typography>

        <TextField
          label="Listen Address"
          value={getStr(properties, 'host', '0.0.0.0')}
          onChange={handleText('host')}
          helperText="IP address to bind to (0.0.0.0 = all interfaces)"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Port"
          type="number"
          value={getNum(properties, 'port', 8080)}
          onChange={handleNumber('port')}
          helperText="HTTP port (1-65535)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <TextField
          label="Context Path"
          value={getStr(properties, 'contextPath', '/')}
          onChange={handleText('contextPath')}
          helperText="URL path prefix (e.g. /api/messages)"
          fullWidth
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Allowed Methods</InputLabel>
          <Select
            multiple
            value={[...getStrArray(properties, 'methods', ['POST'])] as string[]}
            onChange={handleMethodsChange}
            label="Allowed Methods"
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(selected as string[]).map((m) => (
                  <Chip key={m} label={m} size="small" />
                ))}
              </Box>
            )}
          >
            {HTTP_METHODS.map((m) => (
              <MenuItem key={m} value={m}>{m}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>

      {/* Right column — Response settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Response
        </Typography>

        <TextField
          label="Response Status Code"
          type="number"
          value={getNum(properties, 'responseStatusCode', 200)}
          onChange={handleNumber('responseStatusCode')}
          helperText="HTTP status code returned to clients"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 100, max: 599 } }}
        />

        <TextField
          label="Response Content Type"
          value={getStr(properties, 'responseContentType', 'text/plain')}
          onChange={handleText('responseContentType')}
          helperText="Content-Type header of the response"
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
    </Grid>
  );
}
