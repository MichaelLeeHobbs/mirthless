// ===========================================
// Summary Tab
// ===========================================
// Channel editor Summary tab with core configuration fields.

import { type ReactNode } from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { ChannelFormData } from '../../pages/ChannelEditorPage.js';

const DATA_TYPES = ['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR'] as const;

const SOURCE_CONNECTOR_TYPES = [
  'TCP_MLLP',
  'HTTP',
  'FILE',
  'DATABASE',
  'JAVASCRIPT',
  'CHANNEL',
  'DICOM',
  'FHIR',
] as const;

const INITIAL_STATES = ['STARTED', 'STOPPED', 'PAUSED'] as const;

const RESPONSE_MODES = [
  'NONE',
  'AUTO_BEFORE',
  'AUTO_AFTER_TRANSFORMER',
  'AUTO_AFTER_DESTINATIONS',
  'POSTPROCESSOR',
  'DESTINATION',
] as const;

interface SummaryTabProps {
  readonly control: Control<ChannelFormData>;
  readonly errors: FieldErrors<ChannelFormData>;
  readonly isEditMode: boolean;
  readonly channelId: string | undefined;
  readonly revision: number | undefined;
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}

export function SummaryTab({ control, errors, isEditMode, channelId, revision }: SummaryTabProps): ReactNode {
  return (
    <Grid container spacing={3}>
      {/* Left column — Identity & Description */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Channel Identity
        </Typography>

        <Controller
          name="name"
          control={control}
          rules={{ required: 'Name is required', maxLength: { value: 255, message: 'Max 255 characters' } }}
          render={({ field }) => (
            <TextField
              {...field}
              label="Channel Name"
              error={Boolean(errors.name)}
              helperText={errors.name?.message}
              fullWidth
              sx={{ mb: 2 }}
            />
          )}
        />

        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Description"
              multiline
              rows={3}
              fullWidth
              sx={{ mb: 2 }}
            />
          )}
        />

        {isEditMode ? (
          <>
            <TextField
              label="Channel ID"
              value={channelId ?? ''}
              fullWidth
              sx={{ mb: 2 }}
              slotProps={{
                input: {
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => { copyToClipboard(channelId ?? ''); }}
                        aria-label="copy channel ID"
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            <TextField
              label="Revision"
              value={revision ?? ''}
              fullWidth
              sx={{ mb: 2 }}
              slotProps={{ input: { readOnly: true } }}
            />
          </>
        ) : null}
      </Grid>

      {/* Right column — Data Types & Connector */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Data Configuration
        </Typography>

        <Controller
          name="inboundDataType"
          control={control}
          render={({ field }) => (
            <TextField {...field} label="Inbound Data Type" select fullWidth sx={{ mb: 2 }}>
              {DATA_TYPES.map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </TextField>
          )}
        />

        <Controller
          name="outboundDataType"
          control={control}
          render={({ field }) => (
            <TextField {...field} label="Outbound Data Type" select fullWidth sx={{ mb: 2 }}>
              {DATA_TYPES.map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </TextField>
          )}
        />

        <Controller
          name="sourceConnectorType"
          control={control}
          render={({ field }) => (
            <TextField {...field} label="Source Connector Type" select fullWidth sx={{ mb: 2 }}>
              {SOURCE_CONNECTOR_TYPES.map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </TextField>
          )}
        />

        <Controller
          name="initialState"
          control={control}
          render={({ field }) => (
            <TextField {...field} label="Initial State on Deploy" select fullWidth sx={{ mb: 2 }}>
              {INITIAL_STATES.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
          )}
        />

        <Controller
          name="responseMode"
          control={control}
          render={({ field }) => (
            <TextField {...field} label="Response Mode" select fullWidth sx={{ mb: 2 }}>
              {RESPONSE_MODES.map((m) => (
                <MenuItem key={m} value={m}>{m}</MenuItem>
              ))}
            </TextField>
          )}
        />
      </Grid>
    </Grid>
  );
}
