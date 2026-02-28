// ===========================================
// Queue Settings Section
// ===========================================
// Queue mode, retry, and thread settings for a destination.

import { type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DestinationFormValues } from './types.js';

const QUEUE_MODES = [
  { value: 'NEVER', label: 'Never' },
  { value: 'ON_FAILURE', label: 'On Failure' },
  { value: 'ALWAYS', label: 'Always' },
] as const;

interface QueueSettingsSectionProps {
  readonly destination: DestinationFormValues;
  readonly onChange: (updates: Partial<DestinationFormValues>) => void;
}

export function QueueSettingsSection({ destination, onChange }: QueueSettingsSectionProps): ReactNode {
  const queueEnabled = destination.queueMode !== 'NEVER';

  return (
    <>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        Queue Settings
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <TextField
            label="Queue Mode"
            value={destination.queueMode}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ queueMode: e.target.value }); }}
            select
            fullWidth
            sx={{ mb: 2 }}
          >
            {QUEUE_MODES.map((m) => (
              <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
            ))}
          </TextField>

          {queueEnabled ? (
            <>
              <TextField
                label="Retry Count"
                type="number"
                value={destination.retryCount}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const parsed = parseInt(e.target.value, 10);
                  onChange({ retryCount: Number.isNaN(parsed) ? 0 : parsed });
                }}
                helperText="Number of retry attempts (0 = no retries)"
                fullWidth
                sx={{ mb: 2 }}
                slotProps={{ htmlInput: { min: 0 } }}
              />

              <TextField
                label="Retry Interval (ms)"
                type="number"
                value={destination.retryIntervalMs}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const parsed = parseInt(e.target.value, 10);
                  onChange({ retryIntervalMs: Number.isNaN(parsed) ? 0 : parsed });
                }}
                helperText="Delay between retry attempts"
                fullWidth
                sx={{ mb: 2 }}
                slotProps={{ htmlInput: { min: 0 } }}
              />
            </>
          ) : null}
        </Grid>

        {queueEnabled ? (
          <Grid item xs={12} md={6}>
            <TextField
              label="Queue Thread Count"
              type="number"
              value={destination.queueThreadCount}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const parsed = parseInt(e.target.value, 10);
                onChange({ queueThreadCount: Number.isNaN(parsed) ? 1 : Math.max(1, parsed) });
              }}
              helperText="Number of concurrent threads processing the queue"
              fullWidth
              sx={{ mb: 2 }}
              slotProps={{ htmlInput: { min: 1 } }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={destination.rotateQueue}
                  onChange={(_e, checked) => { onChange({ rotateQueue: checked }); }}
                />
              }
              label="Rotate Queue"
              sx={{ mb: 2, display: 'block' }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={destination.waitForPrevious}
                  onChange={(_e, checked) => { onChange({ waitForPrevious: checked }); }}
                />
              }
              label="Wait for Previous Destination"
              sx={{ display: 'block' }}
            />
          </Grid>
        ) : null}
      </Grid>
    </>
  );
}
