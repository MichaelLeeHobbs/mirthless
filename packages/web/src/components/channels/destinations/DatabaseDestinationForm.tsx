// ===========================================
// Database Destination Connector Form
// ===========================================
// Configuration form for database writer destination connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { DATABASE_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';

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

export function DatabaseDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...DATABASE_DEST_DEFAULTS });
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
      {/* Left column — Connection settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Connection
        </Typography>

        <TextField
          label="Host"
          value={getStr(properties, 'host', 'localhost')}
          onChange={handleText('host')}
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Port"
          type="number"
          value={getNum(properties, 'port', 5432)}
          onChange={handleNumber('port')}
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <TextField
          label="Database"
          value={getStr(properties, 'database', '')}
          onChange={handleText('database')}
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Username"
          value={getStr(properties, 'username', '')}
          onChange={handleText('username')}
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Password"
          type="password"
          value={getStr(properties, 'password', '')}
          onChange={handleText('password')}
          fullWidth
          sx={{ mb: 2 }}
        />
      </Grid>

      {/* Right column — Query settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Query
        </Typography>

        <TextField
          label="SQL Query"
          value={getStr(properties, 'query', '')}
          onChange={handleText('query')}
          helperText="INSERT/UPDATE query with ${variable} placeholders"
          fullWidth
          multiline
          minRows={4}
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'useTransaction', false)}
              onChange={handleBool('useTransaction')}
            />
          }
          label="Use Transaction"
          sx={{ mb: 2, display: 'block' }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'returnGeneratedKeys', false)}
              onChange={handleBool('returnGeneratedKeys')}
            />
          }
          label="Return Generated Keys"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>

      <Grid item xs={12}>
        <TestConnectionButton connectorType="DATABASE" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
