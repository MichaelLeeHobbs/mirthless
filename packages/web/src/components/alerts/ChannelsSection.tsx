// ===========================================
// Channels Section
// ===========================================
// Channel multi-select for alert scope.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import { useChannels } from '../../hooks/use-channels.js';

interface ChannelsSectionProps {
  readonly channelIds: readonly string[];
  readonly onChange: (channelIds: readonly string[]) => void;
}

export function ChannelsSection({ channelIds, onChange }: ChannelsSectionProps): ReactNode {
  const { data, isLoading } = useChannels(1, 100);
  const channels = data?.data ?? [];

  const selectedChannels = channels.filter((ch) => channelIds.includes(ch.id));

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Channels</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select which channels this alert monitors. Leave empty to monitor all channels.
      </Typography>

      {channelIds.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          No channels selected — this alert will apply to all channels.
        </Alert>
      ) : null}

      <Autocomplete
        multiple
        options={channels}
        getOptionLabel={(option) => option.name}
        value={selectedChannels}
        onChange={(_e, newValue) => { onChange(newValue.map((ch) => ch.id)); }}
        loading={isLoading}
        renderInput={(params) => {
          const { InputLabelProps, InputProps, ...rest } = params;
          return (
            <TextField
              {...rest}
              label="Channels"
              placeholder="Select channels..."
              size="small"
              slotProps={{
                inputLabel: InputLabelProps,
                input: InputProps as Record<string, unknown>,
              }}
            />
          );
        }}
        isOptionEqualToValue={(option, value) => option.id === value.id}
      />
    </Box>
  );
}
