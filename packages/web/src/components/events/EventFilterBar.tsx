// ===========================================
// Event Filter Bar
// ===========================================
// Filter controls for the events list.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import TextField from '@mui/material/TextField';

export interface EventFilters {
  readonly level: string;
  readonly name: string;
  readonly outcome: string;
}

interface EventFilterBarProps {
  readonly filters: EventFilters;
  readonly onFilterChange: (filters: EventFilters) => void;
}

const EVENT_LEVELS = ['', 'INFO', 'WARN', 'ERROR'] as const;
const EVENT_OUTCOMES = ['', 'SUCCESS', 'FAILURE'] as const;

const EVENT_NAMES = [
  '', 'USER_LOGIN', 'USER_LOGIN_FAILED',
  'USER_CREATED', 'USER_UPDATED', 'USER_DELETED',
  'CHANNEL_CREATED', 'CHANNEL_UPDATED', 'CHANNEL_DELETED',
  'CHANNEL_DEPLOYED', 'CHANNEL_UNDEPLOYED',
  'CHANNEL_STARTED', 'CHANNEL_STOPPED', 'CHANNEL_PAUSED',
  'SETTINGS_CHANGED', 'CODE_TEMPLATE_UPDATED',
  'GLOBAL_SCRIPT_UPDATED', 'ALERT_UPDATED',
] as const;

export function EventFilterBar({ filters, onFilterChange }: EventFilterBarProps): ReactNode {
  const handleLevelChange = (e: SelectChangeEvent): void => {
    onFilterChange({ ...filters, level: e.target.value });
  };

  const handleNameChange = (e: SelectChangeEvent): void => {
    onFilterChange({ ...filters, name: e.target.value });
  };

  const handleOutcomeChange = (e: SelectChangeEvent): void => {
    onFilterChange({ ...filters, outcome: e.target.value });
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
      <FormControl size="small" sx={{ minWidth: 120 }}>
        <InputLabel>Level</InputLabel>
        <Select value={filters.level} label="Level" onChange={handleLevelChange}>
          <MenuItem value="">All</MenuItem>
          {EVENT_LEVELS.filter((l) => l !== '').map((level) => (
            <MenuItem key={level} value={level}>{level}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>Event Name</InputLabel>
        <Select value={filters.name} label="Event Name" onChange={handleNameChange}>
          <MenuItem value="">All</MenuItem>
          {EVENT_NAMES.filter((n) => n !== '').map((name) => (
            <MenuItem key={name} value={name}>{name.replace(/_/g, ' ')}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 120 }}>
        <InputLabel>Outcome</InputLabel>
        <Select value={filters.outcome} label="Outcome" onChange={handleOutcomeChange}>
          <MenuItem value="">All</MenuItem>
          {EVENT_OUTCOMES.filter((o) => o !== '').map((outcome) => (
            <MenuItem key={outcome} value={outcome}>{outcome}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        size="small"
        label="Search"
        placeholder="Filter by event name..."
        disabled
        sx={{ minWidth: 160 }}
      />
    </Box>
  );
}
