// Without this field a new channel goes to Default or the creator's one group (D-310).

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
