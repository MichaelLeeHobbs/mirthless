// ===========================================
// TCP/MLLP Destination Connector Form
// ===========================================
// Configuration form for TCP/MLLP client destination connectors.
// Property keys mirror packages/connectors/src/registry.ts (TcpMllpDispatcher):
// host, port, maxConnections, responseTimeout, acquireTimeoutMs, charset.
// TLS is intentionally NOT surfaced here: TCP TLS needs the same server-side
// cert-store resolution HTTP has (engine.ts resolves only for connectorType
// === 'HTTP'), so a form-only tls bag would be silently ignored at deploy.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { TCP_MLLP_DEST_DEFAULTS } from './connector-defaults.js';
import { MLLP_CHARSETS } from '../source/tcp-mllp-options.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

export function TcpMllpDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...TCP_MLLP_DEST_DEFAULTS });
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
      {/* Network settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Network
        </Typography>

        <TextField
          label="Remote Host"
          value={getStr(properties, 'host', 'localhost')}
          onChange={handleText('host')}
          helperText="Hostname or IP of the remote server"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Remote Port"
          type="number"
          value={getNum(properties, 'port', 6661)}
          onChange={handleNumber('port')}
          helperText="TCP port (1-65535)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />
      </Grid>

      {/* Connection settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Connection
        </Typography>

        <TextField
          label="Max Connections"
          type="number"
          value={getNum(properties, 'maxConnections', 5)}
          onChange={handleNumber('maxConnections')}
          helperText="Size of the outbound connection pool"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 1000 } }}
        />

        <TextField
          label="Response Timeout (ms)"
          type="number"
          value={getNum(properties, 'responseTimeout', 30000)}
          onChange={handleNumber('responseTimeout')}
          helperText="Timeout waiting for the ACK response (0 = no timeout)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 0 } }}
        />

        <TextField
          label="Acquire Timeout (ms)"
          type="number"
          value={getNum(properties, 'acquireTimeoutMs', 30000)}
          onChange={handleNumber('acquireTimeoutMs')}
          helperText="Max wait for a pooled socket before the send fails"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 0 } }}
        />

        <TextField
          label="Charset"
          value={getStr(properties, 'charset', 'utf-8')}
          onChange={handleText('charset')}
          select
          helperText="Payload encoding for MLLP framing"
          fullWidth
          sx={{ mb: 2 }}
        >
          {MLLP_CHARSETS.map((o) => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </TextField>
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="TCP_MLLP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
