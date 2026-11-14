// ===========================================
// JavaScript Source Connector Form
// ===========================================
// Configuration form for JavaScript source connectors.

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { JAVASCRIPT_SOURCE_DEFAULTS } from './connector-defaults.js';
import { FONT_FAMILY_MONO } from '../../../styles/tokens.js';
import { getStr, getNum, propertyUpdaters } from '../common/connector-properties.js';

export function JavaScriptSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...JAVASCRIPT_SOURCE_DEFAULTS });
    }
  }, [properties, onChange]);

  const { handleText, handleNumber } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
          Script
        </Typography>

        <TextField
          label="Polling Script"
          value={getStr(properties, 'script', '')}
          onChange={handleText('script')}
          helperText="JavaScript that returns a string or array of strings. Each returned string becomes a message."
          fullWidth
          multiline
          minRows={8}
          maxRows={20}
          sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: FONT_FAMILY_MONO, fontSize: '0.875rem' } }}
        />

        <TextField
          label="Polling Interval (ms)"
          type="number"
          value={getNum(properties, 'pollingIntervalMs', 5000)}
          onChange={handleNumber('pollingIntervalMs')}
          helperText="How often to execute the script"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 100 } }}
        />
      </Grid>
    </Grid>
  );
}
