// ===========================================
// Message Search Bar
// ===========================================
// Filter controls for the message browser: date range, status, connector, content search.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import FilterListIcon from '@mui/icons-material/FilterList';
import { humanize } from '../../lib/format.js';
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
  readonly messageId: string;
  readonly contentSearch: string;
  /** The channel encrypts stored content, which a text search cannot read. */
  readonly contentEncrypted?: boolean;
  /** Actual destination connectors (metaDataId + name) to populate the filter. */
  readonly connectors?: readonly { readonly metaDataId: number; readonly name: string }[];
  readonly onReceivedFromChange: (value: string) => void;
  readonly onReceivedToChange: (value: string) => void;
  readonly onStatusesChange: (value: readonly string[]) => void;
  readonly onMetaDataIdChange: (value: string) => void;
  readonly onMessageIdChange: (value: string) => void;
  readonly onContentSearchChange: (value: string) => void;
}

export function MessageSearchBar({
  receivedFrom,
  receivedTo,
  statuses,
  metaDataId,
  messageId,
  contentSearch,
  contentEncrypted = false,
  connectors,
  onReceivedFromChange,
  onReceivedToChange,
  onStatusesChange,
  onMetaDataIdChange,
  onMessageIdChange,
  onContentSearchChange,
}: MessageSearchBarProps): ReactNode {
  const isPhone = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const handleStatusChange =(event: SelectChangeEvent<string[]>): void => {
    const val = event.target.value;
    onStatusesChange(typeof val === 'string' ? val.split(',') : val);
  };

  const errorsOnly = statuses.length === 1 && statuses[0] === 'ERROR';
  const advancedCount = [receivedFrom, receivedTo, metaDataId, messageId].filter((v) => v !== '').length
    + (statuses.length > 0 && !errorsOnly ? 1 : 0);
  const showAdvanced = !isPhone || filtersOpen;

  return (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        label="Search content"
        size="small"
        value={contentSearch}
        onChange={(e) => onContentSearchChange(e.target.value)}
        disabled={contentEncrypted}
        helperText={contentEncrypted ? 'Not available: this channel encrypts stored content.' : undefined}
        sx={{ flex: '1 1 160px', minWidth: 150, maxWidth: { sm: contentEncrypted ? 360 : 280 } }}
      />
      <ToggleButton
        value="errors"
        size="small"
        selected={errorsOnly}
        onChange={() => { onStatusesChange(errorsOnly ? [] : ['ERROR']); }}
        sx={{ px: 1.5, whiteSpace: 'nowrap', color: 'text.primary' }}
      >
        Errors only
      </ToggleButton>
      {isPhone ? (
        <Button size="small" startIcon={<FilterListIcon />} onClick={() => { setFiltersOpen((o) => !o); }} aria-expanded={filtersOpen}>
          {advancedCount > 0 ? `Filters (${String(advancedCount)})` : 'Filters'}
        </Button>
      ) : null}
      {showAdvanced ? (
        <>
      <TextField
        label="From"
        type="datetime-local"
        size="small"
        value={receivedFrom}
        onChange={(e) => onReceivedFromChange(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: '100%', sm: 180 } }}
      />
      <TextField
        label="To"
        type="datetime-local"
        size="small"
        value={receivedTo}
        onChange={(e) => onReceivedToChange(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: '100%', sm: 180 } }}
      />
      <FormControl size="small" sx={{ width: 160 }}>
        <InputLabel>Status</InputLabel>
        <Select
          multiple
          value={statuses as string[]}
          onChange={handleStatusChange}
          label="Status"
          renderValue={(selected) => (selected as string[]).map(humanize).join(', ')}
        >
          {STATUS_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              <Checkbox checked={statuses.includes(s)} size="small" />
              <ListItemText primary={humanize(s)} />
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
          {(connectors ?? []).map((c) => (
            <MenuItem key={c.metaDataId} value={String(c.metaDataId)}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label="Message ID"
        size="small"
        type="number"
        value={messageId}
        onChange={(e) => onMessageIdChange(e.target.value)}
        slotProps={{ htmlInput: { min: 1, 'aria-label': 'Search by message ID' } }}
        sx={{ width: 140 }}
      />
        </>
      ) : null}
    </Box>
  );
}
