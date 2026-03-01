// ===========================================
// Trigger Section
// ===========================================
// Alert trigger configuration: error types and regex filter.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import { ERROR_EVENT_TYPES } from '@mirthless/core-models';

export interface TriggerFormValues {
  readonly errorTypes: readonly string[];
  readonly regex: string;
}

interface TriggerSectionProps {
  readonly values: TriggerFormValues;
  readonly onChange: (values: TriggerFormValues) => void;
}

export function TriggerSection({ values, onChange }: TriggerSectionProps): ReactNode {
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

  const handleRegexChange = (regex: string): void => {
    onChange({ ...values, regex });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Trigger</Typography>
      <Box sx={{ mb: 2 }}>
        <Chip label="CHANNEL_ERROR" color="primary" size="small" sx={{ mb: 1 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Trigger when errors occur in the selected event types.
        </Typography>
      </Box>

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
        onChange={(e) => { handleRegexChange(e.target.value); }}
        fullWidth
        size="small"
        helperText="Only trigger when the error message matches this regular expression"
      />
    </Box>
  );
}
