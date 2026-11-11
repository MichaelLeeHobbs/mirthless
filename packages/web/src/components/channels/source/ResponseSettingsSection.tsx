// ===========================================
// Response Settings Section
// ===========================================
// Response mode configuration for the source connector.

import { type ReactNode } from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { ChannelFormData } from '../../../pages/ChannelEditorPage.js';

/**
 * What the sender is told. The engine reports an error before routing in every
 * mode; the modes differ in whether a failed destination also counts. The last
 * three are stored for compatibility and are answered like "After destinations".
 */
const RESPONSE_MODES: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'AUTO_AFTER_DESTINATIONS', label: 'After destinations' },
  { value: 'AUTO_AFTER_TRANSFORMER', label: 'After source transformer' },
  { value: 'AUTO_BEFORE', label: 'On receipt' },
  { value: 'NONE', label: 'None (answers like After destinations)' },
  { value: 'POSTPROCESSOR', label: 'Postprocessor (answers like After destinations)' },
  { value: 'DESTINATION', label: 'Destination (answers like After destinations)' },
];

const RESPONSE_MODE_HELP =
  'After destinations: a failed destination is reported to the sender as an error, so the sender may resend. '
  + 'After source transformer or On receipt: the sender gets a success once the message is accepted; '
  + 'a failed destination is recorded and alerted but not reported back.';

interface ResponseSettingsSectionProps {
  readonly control: Control<ChannelFormData>;
  readonly errors: FieldErrors<ChannelFormData>;
}

export function ResponseSettingsSection({ control }: ResponseSettingsSectionProps): ReactNode {
  return (
    <>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        Response Settings
      </Typography>

      <Controller
        name="responseMode"
        control={control}
        render={({ field }) => (
          <TextField {...field} label="Response Mode" select fullWidth sx={{ maxWidth: 560 }} helperText={RESPONSE_MODE_HELP}>
            {RESPONSE_MODES.map((m) => (
              <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
            ))}
          </TextField>
        )}
      />
    </>
  );
}
