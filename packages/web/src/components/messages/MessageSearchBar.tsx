// ===========================================
// Message Search Bar
// ===========================================
// Filter controls for the message browser: date range, status, connector, content search.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import type { SelectChangeEvent } from '@mui/material/Select';

const STATUS_OPTIONS = ['RECEIVED', 'FILTERED', 'TRANSFORMED', 'SENT', 'QUEUED', 'ERROR', 'PENDING'] as const;

interface MessageSearchBarProps {
  readonly receivedFrom: string;
  readonly receivedTo: string;
  readonly statuses: readonly string[];
  readonly metaDataId: string;
  readonly contentSearch: string;
  readonly onReceivedFromChange: (value: string) => void;
  readonly onReceivedToChange: (value: string) => void;
  readonly onStatusesChange: (value: readonly string[]) => void;
  readonly onMetaDataIdChange: (value: string) => void;
  readonly onContentSearchChange: (value: string) => void;
}

export function MessageSearchBar({
  receivedFrom,
  receivedTo,
  statuses,
  metaDataId,
  contentSearch,
  onReceivedFromChange,
  onReceivedToChange,
  onStatusesChange,
  onMetaDataIdChange,
  onContentSearchChange,
}: MessageSearchBarProps): ReactNode {
  const handleStatusChange = (event: SelectChangeEvent<string[]>): void => {
    const val = event.target.value;
    onStatusesChange(typeof val === 'string' ? val.split(',') : val);
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        label="From"
        type="datetime-local"
        size="small"
        value={receivedFrom}
        onChange={(e) => onReceivedFromChange(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: 200 }}
      />
      <TextField
        label="To"
        type="datetime-local"
        size="small"
        value={receivedTo}
        onChange={(e) => onReceivedToChange(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: 200 }}
      />
      <FormControl size="small" sx={{ width: 180 }}>
        <InputLabel>Status</InputLabel>
        <Select
          multiple
          value={statuses as string[]}
          onChange={handleStatusChange}
          label="Status"
          renderValue={(selected) => (selected as string[]).join(', ')}
        >
          {STATUS_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              <Checkbox checked={statuses.includes(s)} size="small" />
              <ListItemText primary={s} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ width: 140 }}>
        <InputLabel>Connector</InputLabel>
        <Select
          value={metaDataId}
          onChange={(e) => onMetaDataIdChange(e.target.value)}
          label="Connector"
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="0">Source</MenuItem>
          <MenuItem value="1">Dest 1</MenuItem>
          <MenuItem value="2">Dest 2</MenuItem>
          <MenuItem value="3">Dest 3</MenuItem>
        </Select>
      </FormControl>
      <TextField
        label="Search content"
        size="small"
        value={contentSearch}
        onChange={(e) => onContentSearchChange(e.target.value)}
        sx={{ width: 220 }}
      />
    </Box>
  );
}
