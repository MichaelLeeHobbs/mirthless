// ===========================================
// Database Source Connector Form
// ===========================================
// Configuration form for database reader source connectors.

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { DATABASE_SOURCE_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { FONT_FAMILY_MONO } from '../../../styles/tokens.js';
import { getStr, getNum, propertyUpdaters } from '../common/connector-properties.js';

const UPDATE_MODES = ['NEVER', 'ALWAYS', 'ON_SUCCESS'] as const;
const ROW_FORMATS = ['JSON'] as const;

export function DatabaseSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...DATABASE_SOURCE_DEFAULTS });
    }
  }, [properties, onChange]);

  const { update, handleText, handleNumber } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      {/* Left column — Connection settings */}
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

        <FormControlLabel
          control={
            <Switch
              checked={properties['tls'] === true}
              onChange={(e) => { update('tls', e.target.checked); }}
            />
          }
          label="Encrypt the connection (TLS)"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>

      {/* Right column — Query settings */}
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
          Query
        </Typography>

        <TextField
          label="SELECT Query"
          value={getStr(properties, 'selectQuery', '')}
          onChange={handleText('selectQuery')}
          helperText="SQL query to poll for new messages"
          fullWidth
          multiline
          minRows={3}
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { style: { fontFamily: FONT_FAMILY_MONO } } }}
        />

        <TextField
          label="UPDATE Query (Optional)"
          value={getStr(properties, 'updateQuery', '')}
          onChange={handleText('updateQuery')}
          helperText="SQL query to mark rows as processed"
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { style: { fontFamily: FONT_FAMILY_MONO } } }}
        />

        <TextField
          label="Update Mode"
          value={getStr(properties, 'updateMode', 'NEVER')}
          onChange={handleText('updateMode')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {UPDATE_MODES.map((m) => (
            <MenuItem key={m} value={m}>{m}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Polling Interval (ms)"
          type="number"
          value={getNum(properties, 'pollingIntervalMs', 5000)}
          onChange={handleNumber('pollingIntervalMs')}
          helperText="How often to poll for new rows"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 100 } }}
        />

        <TextField
          label="Row Format"
          value={getStr(properties, 'rowFormat', 'JSON')}
          onChange={handleText('rowFormat')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {ROW_FORMATS.map((f) => (
            <MenuItem key={f} value={f}>{f}</MenuItem>
          ))}
        </TextField>
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="DATABASE" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
