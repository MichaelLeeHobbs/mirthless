// Property keys mirror what packages/connectors/src/registry.ts reads for the HttpReceiver.

import { useEffect, useRef, type ReactNode } from 'react';
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
import { QUEUE_CHARSET_OPTIONS } from '../common/charset-options.js';
import { getStr, getNum, getTlsStr, getTlsBool, propertyUpdaters } from '../common/connector-properties.js';
import { HTTP_METHODS, HTTP_SCHEMES as SCHEMES } from '@galvanigraph/core-models';

export function HttpSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...HTTP_SOURCE_DEFAULTS });
    }
  }, [properties, onChange]);

  const { updateTls, handleText, handleNumber } = propertyUpdaters(properties, onChange);

  const scheme = getStr(properties, 'scheme', 'HTTP');
  const isHttps = scheme === 'HTTPS';
  const serverCertId = getTlsStr(properties, 'serverCertId');

  return (
    <Grid container spacing={3}>
      <Grid
        size={{
          xs: 12,
          md: 6
        }}>
        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
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

        <TextField
          label="Body Charset"
          value={getStr(properties, 'bodyCharset', 'utf-8')}
          onChange={handleText('bodyCharset')}
          select
          helperText="Used when Content-Type names no charset; a body that is not valid text is refused (415). Binary keeps every body as base64 instead."
          fullWidth
          sx={{ mb: 2 }}
        >
          {QUEUE_CHARSET_OPTIONS.map((c) => (
            <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
          ))}
        </TextField>
      </Grid>

      <Grid
        size={{
          xs: 12,
          md: 6
        }}>
        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
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
          label="Error Status Code"
          type="number"
          value={getNum(properties, 'errorStatusCode', 500)}
          onChange={handleNumber('errorStatusCode')}
          helperText="HTTP status returned when pipeline dispatch fails"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 400, max: 599 } }}
        />

        <TextField
          label="Max Body Bytes"
          type="number"
          value={getNum(properties, 'maxBodyBytes', 52428800)}
          onChange={handleNumber('maxBodyBytes')}
          helperText="Body cap in bytes, received and decompressed (default 52428800 = 50 MiB)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />
      </Grid>

      <Grid size={12}>
        <Divider sx={{ mb: 2 }} />
        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
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
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                display: 'block',
                mb: 2
              }}>
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
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                display: 'block',
                mt: 0.5,
                mb: 1
              }}>
              When enabled, clients must present a certificate trusted by the CA above (mutual TLS).
            </Typography>
          </>
        )}
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="HTTP" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
