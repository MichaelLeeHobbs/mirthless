// ===========================================
// JavaScript Destination Connector Form
// ===========================================
// Configuration form for JavaScript destination connectors.

import { useEffect, useRef, type ReactNode } from 'react';
import Typography from '@mui/material/Typography';
import { CODE_TEMPLATE_CONTEXT } from '@galvaniflow/core-models';
import type { DestConnectorFormProps } from './types.js';
import { JAVASCRIPT_DEST_DEFAULTS } from './connector-defaults.js';
import { ConnectorScriptEditor } from '../common/ConnectorScriptEditor.js';

/** The engine runs it with msg typed by the data type, the channel identity and the connector message. */
const DESTINATION_SCRIPT_SURFACE = { connectorMessage: true, templateContext: CODE_TEMPLATE_CONTEXT.DESTINATION_DISPATCHER } as const;

export function JavaScriptDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...JAVASCRIPT_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  return (
    <>
      <ConnectorScriptEditor
        label="Destination script"
        properties={properties}
        onChange={onChange}
        surface={DESTINATION_SCRIPT_SURFACE}
      />
      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
        Runs for each message with msg, connectorMessage and the channel maps. What it returns becomes the response.
      </Typography>
    </>
  );
}
