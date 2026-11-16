// ===========================================
// File Destination Connector Form
// ===========================================
// Configuration form for file writer destination connectors.

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { FILE_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { getStr, getBool, propertyUpdaters } from '../common/connector-properties.js';
import { CHARSET_OPTIONS } from '../common/charset-options.js';

export function FileDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...FILE_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const { handleText, handleBool } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      {/* Left column — Output settings */}
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
          Output
        </Typography>

        <TextField
          label="Directory"
          value={getStr(properties, 'directory', '')}
          onChange={handleText('directory')}
          helperText="Path to the output directory"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Output Pattern"
          value={getStr(properties, 'outputPattern', '${messageId}.txt')}
          onChange={handleText('outputPattern')}
          helperText="Use ${messageId} or ${timestamp} so each message gets its own file. A fixed name is replaced by every message unless Append Mode is on."
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Charset"
          value={getStr(properties, 'charset', 'utf-8')}
          onChange={handleText('charset')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {CHARSET_OPTIONS.map((c) => (
            <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
          ))}
        </TextField>
      </Grid>

      {/* Right column — Write settings */}
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
          Write Options
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'binary', false)}
              onChange={handleBool('binary')}
            />
          }
          label="Binary Mode"
          sx={{ mb: 2, display: 'block' }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'tempFileEnabled', true)}
              onChange={handleBool('tempFileEnabled')}
            />
          }
          label="Use Temp File"
          sx={{ mb: 2, display: 'block' }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'appendMode', false)}
              onChange={handleBool('appendMode')}
            />
          }
          label="Append Mode"
          sx={{ mb: 2, display: 'block' }}
        />
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="FILE" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
