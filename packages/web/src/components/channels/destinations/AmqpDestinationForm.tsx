// Property keys must match the AMQP destination schema in core-models (see connector-defaults.ts).

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { AMQP_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { HeadersEditor, coerceHeaders } from '../../common/HeadersEditor.js';
import { AmqpConnectionFields, QueueTlsFields } from '../common/QueueConnectionFields.js';
import { getStr, propertyUpdaters } from '../common/connector-properties.js';

export function AmqpDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (Object.keys(properties).length === 0) onChange({ ...AMQP_DEST_DEFAULTS });
  }, [properties, onChange]);

  const { update, handleText } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Broker</Typography>
        <AmqpConnectionFields properties={properties} onChange={onChange} />
        <QueueTlsFields properties={properties} onChange={onChange} />
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Message</Typography>
        <TextField
          label="Exchange"
          value={getStr(properties, 'exchange', '')}
          onChange={handleText('exchange')}
          helperText="An existing exchange; empty is the default exchange, which routes to the queue named by the routing key"
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Routing Key"
          value={getStr(properties, 'routingKey', '')}
          onChange={handleText('routingKey')}
          helperText="${name} is filled from the message's variables"
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Content Type"
          value={getStr(properties, 'contentType', 'text/plain')}
          onChange={handleText('contentType')}
          fullWidth
          sx={{ mb: 2 }}
        />
        <HeadersEditor
          value={coerceHeaders(properties['headers'])}
          onChange={(headers) => { update('headers', headers); }}
          label="Message headers (values may use ${name})"
        />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          Sent as a persistent message once the broker confirms it. A message no queue would receive is an error, not dropped.
        </Typography>
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="AMQP" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
