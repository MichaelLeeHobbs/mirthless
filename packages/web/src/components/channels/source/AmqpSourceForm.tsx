// ===========================================
// AMQP (RabbitMQ) Source Connector Form
// ===========================================
// Consumes an existing queue. Property keys must match the AMQP source schema
// in core-models (see connector-defaults.ts).

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { AMQP_SOURCE_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { AmqpConnectionFields, QueueCharsetField, QueueStoreAttemptsField, QueueTlsFields } from '../common/QueueConnectionFields.js';
import { getStr, propertyUpdaters } from '../common/connector-properties.js';

export function AmqpSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (Object.keys(properties).length === 0) onChange({ ...AMQP_SOURCE_DEFAULTS });
  }, [properties, onChange]);

  const { handleText } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Broker</Typography>
        <AmqpConnectionFields properties={properties} onChange={onChange} />
        <QueueTlsFields properties={properties} onChange={onChange} />
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Queue</Typography>
        <TextField
          label="Queue"
          value={getStr(properties, 'queue', '')}
          onChange={handleText('queue')}
          helperText="An existing queue; the channel does not create one"
          fullWidth
          sx={{ mb: 2 }}
        />
        <QueueCharsetField properties={properties} onChange={onChange} />
        <QueueStoreAttemptsField properties={properties} onChange={onChange} />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          A message is acknowledged only after the channel has stored it. One the channel could not store goes back to the queue, and if it keeps failing the channel stops with the message still on the queue; one stored with an error goes to the queue&apos;s dead-letter exchange, if it has one. After a lost connection a message can arrive twice, with redelivered set in the source map.
        </Typography>
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="AMQP" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
