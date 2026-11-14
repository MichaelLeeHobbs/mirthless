// ===========================================
// JavaScript Destination Connector Form
// ===========================================
// Configuration form for JavaScript destination connectors.

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { JAVASCRIPT_DEST_DEFAULTS } from './connector-defaults.js';
import { FONT_FAMILY_MONO } from '../../../styles/tokens.js';
import { getStr, propertyUpdaters } from '../common/connector-properties.js';

export function JavaScriptDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...JAVASCRIPT_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const { handleText } = propertyUpdaters(properties, onChange);

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
          label="Destination Script"
          value={getStr(properties, 'script', '')}
          onChange={handleText('script')}
          helperText="JavaScript with access to 'msg' (message content) and 'connectorMessage'. Return value becomes response."
          fullWidth
          multiline
          minRows={8}
          maxRows={20}
          sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: FONT_FAMILY_MONO, fontSize: '0.875rem' } }}
        />
      </Grid>
    </Grid>
  );
}
