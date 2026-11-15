// ===========================================
// Kafka Source Connector Form
// ===========================================
// Reads a topic as a member of a consumer group. Property keys must match the
// Kafka source schema in core-models (see connector-defaults.ts).

import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { KAFKA_SOURCE_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { KafkaConnectionFields, QueueCharsetField, QueueTlsFields } from '../common/QueueConnectionFields.js';
import { getStr, propertyUpdaters } from '../common/connector-properties.js';

const START_FROM = [
  { value: 'EARLIEST', label: 'Earliest (read the whole topic)' },
  { value: 'LATEST', label: 'Latest (only new records)' },
] as const;

export function KafkaSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (Object.keys(properties).length === 0) onChange({ ...KAFKA_SOURCE_DEFAULTS });
  }, [properties, onChange]);

  const { handleText } = propertyUpdaters(properties, onChange);

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Broker</Typography>
        <KafkaConnectionFields properties={properties} onChange={onChange} />
        <QueueTlsFields properties={properties} onChange={onChange} />
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>Topic</Typography>
        <TextField
          label="Topic"
          value={getStr(properties, 'topic', '')}
          onChange={handleText('topic')}
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Consumer Group"
          value={getStr(properties, 'groupId', '')}
          onChange={handleText('groupId')}
          helperText="Channels in the same group share the topic's partitions; use one group per channel"
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Start From"
          value={getStr(properties, 'startFrom', 'EARLIEST')}
          onChange={handleText('startFrom')}
          helperText="Only for a group with no committed offset yet"
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {START_FROM.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
        </TextField>
        <QueueCharsetField properties={properties} onChange={onChange} />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          A record is committed only after the channel has stored it. After a crash or a lost connection a record can arrive twice; its topic, partition and offset are in the source map.
        </Typography>
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="KAFKA" mode="SOURCE" properties={properties} />
      </Grid>
    </Grid>
  );
}
