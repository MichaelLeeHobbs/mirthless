// ===========================================
// New Channel Group Field
// ===========================================
// The group a new channel joins, shown only to someone who can change channels
// in several groups but not on every channel (D-310); anyone else's channel
// goes to Default or their one group without asking.

import type { ReactNode, ChangeEvent } from 'react';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useNewChannelGroups } from '../../hooks/use-new-channel-groups.js';

interface NewChannelGroupFieldProps {
  readonly value: string;
  readonly onChange: (groupId: string) => void;
}

export function NewChannelGroupField({ value, onChange }: NewChannelGroupFieldProps): ReactNode {
  const choices = useNewChannelGroups();
  if (choices === null) return null;
  return (
    <TextField
      select label="Group" required fullWidth size="small" value={value}
      helperText="You can change channels in several groups. Choose the one this channel joins."
      onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.value); }}
    >
      {choices.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
    </TextField>
  );
}
