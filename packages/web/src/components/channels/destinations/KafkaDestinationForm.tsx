// ===========================================
// Kafka Destination Connector Form
// ===========================================
// Publishes to a topic. Topic, key and header values may use ${name}, filled
// per message. Property keys must match the Kafka destination schema in
// core-models (see connector-defaults.ts).

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { KAFKA_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { HeadersEditor, coerceHeaders } from '../../common/HeadersEditor.js';
import { KafkaConnectionFields, QueueTlsFields } from '../common/QueueConnectionFields.js';
import { getStr, propertyUpdaters } from '../common/connector-properties.js';

export function KafkaDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (Object.keys(properties).length === 0) onChange({ ...KAFKA_DEST_DEFAULTS });
  }, [properties, onChange]);

  const { update, handleText } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Broker</Typography>
        <KafkaConnectionFields properties={properties} onChange={onChange} />
        <QueueTlsFields properties={properties} onChange={onChange} />
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Record</Typography>
        <TextField
          label="Topic"
          value={getStr(properties, 'topic', '')}
          onChange={handleText('topic')}
          helperText="An existing topic; ${name} is filled from the message's variables"
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Key"
          value={getStr(properties, 'key', '')}
          onChange={handleText('key')}
          helperText="Records with the same key go to the same partition, in order (e.g. ${patientId}); empty sends no key"
          fullWidth
          sx={{ mb: 2 }}
        />
        <HeadersEditor
          value={coerceHeaders(properties['headers'])}
          onChange={(headers) => { update('headers', headers); }}
          label="Record headers (values may use ${name})"
        />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          Sent once every in-sync replica has the record. A retry after a lost acknowledgement can write the record twice.
        </Typography>
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="KAFKA" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
