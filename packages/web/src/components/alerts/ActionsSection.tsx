// ===========================================
// Actions Section
// ===========================================
// Alert actions editor: EMAIL and CHANNEL types.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useChannels } from '../../hooks/use-channels.js';

export interface ActionFormValues {
  readonly type: 'EMAIL' | 'CHANNEL';
  readonly recipients: readonly string[];
  readonly channelId: string;
}

interface ActionsSectionProps {
  readonly actions: readonly ActionFormValues[];
  readonly onChange: (actions: readonly ActionFormValues[]) => void;
}

const DEFAULT_ACTION: ActionFormValues = {
  type: 'EMAIL',
  recipients: [],
  channelId: '',
};

export function ActionsSection({ actions, onChange }: ActionsSectionProps): ReactNode {
  const { data } = useChannels(1, 100);
  const channels = data?.data ?? [];

  const handleAdd = (): void => {
    onChange([...actions, DEFAULT_ACTION]);
  };

  const handleRemove = (index: number): void => {
    const updated = [...actions];
    updated.splice(index, 1);
    onChange(updated);
  };

  const handleUpdate = (index: number, updates: Partial<ActionFormValues>): void => {
    const updated = [...actions];
    updated[index] = { ...updated[index]!, ...updates };
    onChange(updated);
  };

  const handleRecipientsChange = (index: number, recipientStr: string): void => {
    const recipients = recipientStr
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    handleUpdate(index, { recipients });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Actions</Typography>
        <Button startIcon={<AddIcon />} size="small" onClick={handleAdd}>
          Add Action
        </Button>
      </Box>

      {actions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No actions configured. Add an action to define how alerts are delivered.
        </Typography>
      ) : null}

      {actions.map((action, index) => (
        <Paper key={index} variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Chip label={`Action ${String(index + 1)}`} size="small" />
            <IconButton size="small" onClick={() => { handleRemove(index); }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>

          <TextField
            select
            label="Type"
            value={action.type}
            onChange={(e) => { handleUpdate(index, { type: e.target.value as 'EMAIL' | 'CHANNEL' }); }}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          >
            <MenuItem value="EMAIL">Email</MenuItem>
            <MenuItem value="CHANNEL">Channel</MenuItem>
          </TextField>

          {action.type === 'EMAIL' ? (
            <TextField
              label="Recipients (comma-separated emails)"
              value={action.recipients.join(', ')}
              onChange={(e) => { handleRecipientsChange(index, e.target.value); }}
              fullWidth
              size="small"
              helperText="Enter email addresses separated by commas"
            />
          ) : (
            <Autocomplete
              options={channels}
              getOptionLabel={(option) => option.name}
              value={channels.find((ch) => ch.id === action.channelId) ?? null}
              onChange={(_e, newValue) => {
                handleUpdate(index, { channelId: newValue?.id ?? '' });
              }}
              renderInput={(params) => {
                const { InputLabelProps, InputProps, ...rest } = params;
                return (
                  <TextField
                    {...rest}
                    label="Target Channel"
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
          )}
        </Paper>
      ))}
    </Box>
  );
}
