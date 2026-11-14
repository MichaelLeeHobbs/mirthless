// ===========================================
// TCP/MLLP Source Connector Form
// ===========================================
// Configuration form for TCP/MLLP listener source connectors.
// Property keys mirror packages/connectors/src/registry.ts (TcpMllpReceiver):
// host, port, maxConnections, responseMode, charset, maxFrameBytes.
// TLS is intentionally NOT surfaced here: TCP TLS needs the same server-side
// cert-store resolution HTTP has (engine.ts resolves only for connectorType
// === 'HTTP'), so a form-only tls bag would be silently ignored at deploy.
// That is a separate workstream — see docs/design connector-parity notes.

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { TCP_MLLP_SOURCE_DEFAULTS } from './connector-defaults.js';
import { MLLP_CHARSETS, MLLP_RESPONSE_MODES } from './tcp-mllp-options.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { getStr, getNum, propertyUpdaters } from '../common/connector-properties.js';

export function TcpMllpSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  // Populate defaults on mount if properties are empty
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...TCP_MLLP_SOURCE_DEFAULTS });
    }
  }, [properties, onChange]);

  const { handleText, handleNumber } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      {/* Network settings */}
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
          Network
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
          value={getNum(properties, 'port', 6661)}
          onChange={handleNumber('port')}
          helperText="TCP port (1-65535)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <TextField
          label="Max Connections"
          type="number"
          value={getNum(properties, 'maxConnections', 10)}
          onChange={handleNumber('maxConnections')}
          helperText="Maximum concurrent client connections"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 1000 } }}
        />
      </Grid>

      {/* MLLP settings */}
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
          MLLP
        </Typography>

        <TextField
          label="Response Mode"
          value={getStr(properties, 'responseMode', 'AUTO_ACK')}
          onChange={handleText('responseMode')}
          select
          helperText="AUTO_ACK builds an HL7 ACK/NAK from the inbound message; PASSTHROUGH relays the downstream response"
          fullWidth
          sx={{ mb: 2 }}
        >
          {MLLP_RESPONSE_MODES.map((o) => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Charset"
          value={getStr(properties, 'charset', 'utf-8')}
          onChange={handleText('charset')}
          select
          helperText="Payload encoding for MLLP framing/parsing"
          fullWidth
          sx={{ mb: 2 }}
        >
          {MLLP_CHARSETS.map((o) => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Max Frame Bytes"
          type="number"
          value={getNum(properties, 'maxFrameBytes', 52428800)}
          onChange={handleNumber('maxFrameBytes')}
          helperText="Per-connection buffer cap in bytes (default 52428800 = 50 MiB)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="TCP_MLLP" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
