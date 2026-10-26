// ===========================================
// Trigger Section
// ===========================================
// Alert trigger configuration: channel errors (event types + regex) or
// "no messages received" for a number of minutes.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import { ERROR_EVENT_TYPES, type AlertTriggerInput } from '@mirthless/core-models';

export type TriggerType = 'CHANNEL_ERROR' | 'NO_MESSAGES';

export interface TriggerFormValues {
  readonly type: TriggerType;
  readonly errorTypes: readonly string[];
  readonly regex: string;
  readonly windowMinutes: number;
}

type ErrorEventType = (typeof ERROR_EVENT_TYPES)[number];

function isErrorEventType(value: string): value is ErrorEventType {
  return (ERROR_EVENT_TYPES as readonly string[]).includes(value);
}

/** Build the API trigger for the selected type, dropping the other type's fields. */
export function buildTriggerPayload(values: TriggerFormValues): AlertTriggerInput {
  if (values.type === 'NO_MESSAGES') {
    return { type: 'NO_MESSAGES', windowMinutes: values.windowMinutes };
  }
  return {
    type: 'CHANNEL_ERROR',
    errorTypes: values.errorTypes.filter(isErrorEventType),
    regex: values.regex || null,
  };
}

interface TriggerSectionProps {
  readonly values: TriggerFormValues;
  readonly onChange: (values: TriggerFormValues) => void;
}

export function TriggerSection({ values, onChange }: TriggerSectionProps): ReactNode {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>Trigger</Typography>
      <TextField
        select
        label="Trigger when"
        value={values.type}
        onChange={(e) => { onChange({ ...values, type: e.target.value as TriggerType }); }}
        size="small"
        sx={{ mb: 2, minWidth: 320 }}
      >
        <MenuItem value="CHANNEL_ERROR">A channel reports an error</MenuItem>
        <MenuItem value="NO_MESSAGES">A started channel receives no messages</MenuItem>
      </TextField>

      {values.type === 'NO_MESSAGES'
        ? <NoMessagesFields values={values} onChange={onChange} />
        : <ChannelErrorFields values={values} onChange={onChange} />}
    </Box>
  );
}

function NoMessagesFields({ values, onChange }: TriggerSectionProps): ReactNode {
  return (
    <TextField
      label="Minutes without a message"
      type="number"
      value={values.windowMinutes}
      onChange={(e) => {
        const parsed = parseInt(e.target.value, 10);
        onChange({ ...values, windowMinutes: Number.isNaN(parsed) ? 1 : Math.min(10_080, Math.max(1, parsed)) });
      }}
      size="small"
      slotProps={{ htmlInput: { min: 1, max: 10_080 } }}
      helperText="Alert when a started channel has received nothing for this long. Checked every 30 seconds."
    />
  );
}

function ChannelErrorFields({ values, onChange }: TriggerSectionProps): ReactNode {
  const handleErrorTypeToggle = (errorType: string): void => {
    const current = [...values.errorTypes];
    const index = current.indexOf(errorType);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(errorType);
    }
    onChange({ ...values, errorTypes: current });
  };

  return (
    <>
      <Typography variant="subtitle2" gutterBottom>Error Event Types</Typography>
      <FormGroup sx={{ mb: 2 }}>
        {ERROR_EVENT_TYPES.map((eventType) => (
          <FormControlLabel
            key={eventType}
            control={
              <Checkbox
                checked={values.errorTypes.includes(eventType)}
                onChange={() => { handleErrorTypeToggle(eventType); }}
                size="small"
              />
            }
            label={eventType.replace(/_/g, ' ')}
          />
        ))}
      </FormGroup>

      <TextField
        label="Regex Filter (optional)"
        value={values.regex}
        onChange={(e) => { onChange({ ...values, regex: e.target.value }); }}
        fullWidth
        size="small"
        helperText="Only trigger when the error message matches this regular expression"
      />
    </>
  );
}
