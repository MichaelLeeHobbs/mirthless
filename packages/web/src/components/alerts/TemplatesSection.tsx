// ===========================================
// Templates Section
// ===========================================
// Alert notification templates and limits.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Grid from '@mui/material/Grid';

export interface TemplateFormValues {
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly reAlertIntervalMs: number | null;
  readonly maxAlerts: number | null;
}

interface TemplatesSectionProps {
  readonly values: TemplateFormValues;
  readonly onChange: (values: TemplateFormValues) => void;
}

export function TemplatesSection({ values, onChange }: TemplatesSectionProps): ReactNode {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>Notification Templates</Typography>

      <TextField
        label="Subject Template"
        value={values.subjectTemplate}
        onChange={(e) => { onChange({ ...values, subjectTemplate: e.target.value }); }}
        fullWidth
        size="small"
        sx={{ mb: 2 }}
        helperText="Template for the alert subject. Use ${channelName}, ${error}, etc."
      />

      <TextField
        label="Body Template"
        value={values.bodyTemplate}
        onChange={(e) => { onChange({ ...values, bodyTemplate: e.target.value }); }}
        fullWidth
        size="small"
        multiline
        rows={4}
        sx={{ mb: 3 }}
        helperText="Template for the alert body. Use ${channelName}, ${error}, ${timestamp}, etc."
      />

      <Typography variant="subtitle2" gutterBottom>Limits</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <TextField
            label="Re-alert Interval (ms)"
            type="number"
            value={values.reAlertIntervalMs ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onChange({
                ...values,
                reAlertIntervalMs: val === '' ? null : parseInt(val, 10),
              });
            }}
            fullWidth
            size="small"
            helperText="Minimum time between alerts (leave empty for no limit)"
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            label="Max Alerts"
            type="number"
            value={values.maxAlerts ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onChange({
                ...values,
                maxAlerts: val === '' ? null : parseInt(val, 10),
              });
            }}
            fullWidth
            size="small"
            helperText="Maximum number of alerts to send (leave empty for no limit)"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
