// ===========================================
// TCP/MLLP Source Connector Form
// ===========================================
// Configuration form for TCP/MLLP listener source connectors.
// Property keys mirror packages/connectors/src/registry.ts (TcpMllpReceiver):
// host, port, maxConnections. Decorative fields the receiver never reads
// (charset/transmissionMode/receiveTimeout/bufferSize/keepConnectionOpen) were
// removed so the form cannot promise behavior the runtime does not honor.
// TODO(connectors): expose TLS/charset/ackMode here once the receiver consumes them.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { TCP_MLLP_SOURCE_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

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

      <Grid item xs={12}>
        <TestConnectionButton connectorType="TCP_MLLP" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
