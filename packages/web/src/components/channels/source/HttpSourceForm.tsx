// ===========================================
// HTTP Source Connector Form
// ===========================================
// Configuration form for HTTP listener source connectors.
// Property keys mirror packages/connectors/src/registry.ts (HttpReceiver):
// host, port, path, method, responseStatusCode, responseContentType.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import type { SourceConnectorFormProps } from './types.js';
import { HTTP_SOURCE_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { CertificateSelect } from '../common/CertificateSelect.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
const SCHEMES = ['HTTP', 'HTTPS'] as const;

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

  const updateTls = (key: string, value: unknown): void => {
    update('tls', { ...getTls(properties), [key]: value });
  };

  const scheme = getStr(properties, 'scheme', 'HTTP');
  const isHttps = scheme === 'HTTPS';
  const serverCertId = getTlsStr(properties, 'serverCertId');

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
          label="Path"
          value={getStr(properties, 'path', '/')}
          onChange={handleText('path')}
          helperText="URL path to listen on (e.g. /api/messages)"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Allowed Method"
          value={getStr(properties, 'method', 'POST')}
          onChange={handleText('method')}
          select
          helperText="HTTP method accepted by the listener"
          fullWidth
          sx={{ mb: 2 }}
        >
          {HTTP_METHODS.map((m) => (
            <MenuItem key={m} value={m}>{m}</MenuItem>
          ))}
        </TextField>
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
      </Grid>

      {/* Transport mode — HTTP or HTTPS (server cert selected from the cert store) */}
      <Grid item xs={12}>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Transport
        </Typography>

        <TextField
          label="Mode"
          value={scheme}
          onChange={handleText('scheme')}
          select
          helperText="HTTPS terminates TLS using a server certificate from the Certificates store"
          sx={{ mb: 2, minWidth: 220 }}
        >
          {SCHEMES.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </TextField>

        {isHttps && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              References certificates by ID. Material is resolved server-side at deploy time.
            </Typography>

            <CertificateSelect
              label="Server certificate"
              requirePrivateKey
              required
              value={serverCertId || undefined}
              onChange={(id) => { updateTls('serverCertId', id ?? ''); }}
              error={serverCertId.length === 0}
              helperText={
                serverCertId.length === 0
                  ? 'A server certificate (with private key) is required for HTTPS'
                  : 'Certificate + key the listener presents to clients'
              }
            />

            <CertificateSelect
              label="Trust CA"
              type="CA"
              value={getTlsStr(properties, 'caCertId') || undefined}
              onChange={(id) => { updateTls('caCertId', id ?? ''); }}
              helperText="CA used to verify client certificates for mutual TLS (optional)"
            />

            <FormControlLabel
              control={(
                <Switch
                  checked={getTlsBool(properties, 'requireClientCert', false)}
                  onChange={(e) => { updateTls('requireClientCert', e.target.checked); }}
                />
              )}
              label="Require client certificate"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1 }}>
              When enabled, clients must present a certificate trusted by the CA above (mutual TLS).
            </Typography>
          </>
        )}
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="HTTP" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
