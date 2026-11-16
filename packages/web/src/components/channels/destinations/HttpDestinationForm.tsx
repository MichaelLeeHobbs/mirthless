// ===========================================
// HTTP Destination Connector Form
// ===========================================
// Configuration form for HTTP client destination connectors.

import { useEffect, useRef, type ReactNode } from 'react';
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
import { CertificateSelect } from '../common/CertificateSelect.js';
import { getStr, getNum, getTlsStr, getTlsBool, propertyUpdaters } from '../common/connector-properties.js';
import { HTTP_METHODS, HTTP_SCHEMES as SCHEMES } from '@galvaniflow/core-models';

export function HttpDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...HTTP_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const { update, updateTls, handleText, handleNumber } = propertyUpdaters(properties, onChange);

  const scheme = getStr(properties, 'scheme', 'HTTP');
  const isHttps = scheme === 'HTTPS';

  return (
    <Grid container spacing={3}>
      {/* Left column — Request settings */}
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
          Connection
        </Typography>

        <TextField
          label="Response Timeout (ms)"
          type="number"
          value={getNum(properties, 'responseTimeout', 30000)}
          onChange={handleNumber('responseTimeout')}
          helperText="Milliseconds to wait for the response; at least 1"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />
      </Grid>

      {/* Transport mode — HTTP or HTTPS (TLS material selected from the cert store) */}
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
          helperText="HTTPS selects TLS material from the Certificates store"
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
              label="Trust CA"
              type="CA"
              value={getTlsStr(properties, 'caCertId') || undefined}
              onChange={(id) => { updateTls('caCertId', id ?? ''); }}
              helperText="Trust this custom/internal CA when verifying the server certificate (optional)"
            />

            <CertificateSelect
              label="Client certificate (mTLS)"
              requirePrivateKey
              value={getTlsStr(properties, 'clientCertId') || undefined}
              onChange={(id) => { updateTls('clientCertId', id ?? ''); }}
              helperText="Client certificate + key for mutual TLS (optional)"
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
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                display: 'block',
                mt: 0.5,
                mb: 1
              }}>
              Keep enabled. Disabling skips server certificate verification (insecure — audited exceptions only).
            </Typography>
          </>
        )}
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="HTTP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
