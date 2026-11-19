import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CODE_TEMPLATE_CONTEXT } from '@galvanigraph/core-models';
import type { SourceConnectorFormProps } from './types.js';
import { JAVASCRIPT_SOURCE_DEFAULTS } from './connector-defaults.js';
import { getNum, propertyUpdaters } from '../common/connector-properties.js';
import { ConnectorScriptEditor } from '../common/ConnectorScriptEditor.js';

/** The engine runs it with no message, like a deploy script, and the channel's id and name. */
const POLLING_SCRIPT_SURFACE = { message: false, templateContext: CODE_TEMPLATE_CONTEXT.SOURCE_RECEIVER } as const;

export function JavaScriptSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...JAVASCRIPT_SOURCE_DEFAULTS });
    }
  }, [properties, onChange]);

  const { handleNumber } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <ConnectorScriptEditor
          label="Polling script"
          properties={properties}
          onChange={onChange}
          surface={POLLING_SCRIPT_SURFACE}
        />
        <Typography variant="caption" sx={{ display: 'block', mt: 1, mb: 2, color: 'text.secondary' }}>
          Return a string or an array of strings; each string becomes a message.
        </Typography>

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
