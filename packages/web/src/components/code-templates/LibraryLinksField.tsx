// ===========================================
// Library Links Field
// ===========================================
// The channels whose scripts get a library's templates: every channel, or
// chosen ones (D-310, plan section 2). A library write needs Change code
// templates on every linked channel, before and after the change, so a writer
// limited to some groups can link only their own channels. Links outside the
// reader's access show as a count only and are never sent back.

import type { ReactNode, ChangeEvent } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useChannels } from '../../hooks/use-channels.js';

interface LibraryLinksFieldProps {
  /** null: every channel. */
  readonly value: readonly string[] | null;
  /** Links the reader cannot see, left out of `value`. */
  readonly outsideScopeCount: number;
  readonly onChange: (value: readonly string[] | null) => void;
}

const EVERY = 'every';
const CHOSEN = 'chosen';

export function LibraryLinksField({ value, outsideScopeCount, onChange }: LibraryLinksFieldProps): ReactNode {
  // The first page the API allows; a link to a channel past it is kept (unseen below).
  const { data, isLoading } = useChannels(1, 100);
  const channels = data?.data ?? [];
  const chosen = channels.filter((c) => value?.includes(c.id) === true);
  // Links the list does not show stay linked when the selection changes.
  const unseen = (value ?? []).filter((id) => !channels.some((c) => c.id === id));

  return (
    <Box>
      <TextField
        select label="Channels" size="small" fullWidth value={value === null ? EVERY : CHOSEN}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.value === EVERY ? null : []); }}
        helperText="The channels whose scripts get this library's templates."
      >
        <MenuItem value={EVERY}>Every channel</MenuItem>
        <MenuItem value={CHOSEN}>Chosen channels</MenuItem>
      </TextField>
      {value !== null && (
        <Autocomplete
          multiple size="small" sx={{ mt: 2 }}
          options={channels}
          loading={isLoading}
          value={chosen}
          getOptionLabel={(c) => c.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, next) => { onChange([...unseen, ...next.map((c) => c.id)]); }}
          renderInput={(params) => <TextField {...params} label="Linked channels" placeholder="Choose channels" />}
        />
      )}
      {outsideScopeCount > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          +{String(outsideScopeCount)} outside your access. Changing the links needs access to those channels too.
        </Typography>
      )}
    </Box>
  );
}
