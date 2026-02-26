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

const RESPONSE_MODES = [
  'NONE',
  'AUTO_BEFORE',
  'AUTO_AFTER_TRANSFORMER',
  'AUTO_AFTER_DESTINATIONS',
  'POSTPROCESSOR',
  'DESTINATION',
] as const;

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
          <TextField {...field} label="Response Mode" select fullWidth sx={{ maxWidth: 400 }}>
            {RESPONSE_MODES.map((m) => (
              <MenuItem key={m} value={m}>{m}</MenuItem>
            ))}
          </TextField>
        )}
      />
    </>
  );
}
