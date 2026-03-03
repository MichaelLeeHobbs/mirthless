// ===========================================
// Tag Filter Component
// ===========================================
// MUI Autocomplete with colored Chip rendering for dashboard tag filtering.

import { type ReactNode } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import type { TagSummary } from '../../hooks/use-tags.js';

interface TagFilterProps {
  readonly tags: readonly TagSummary[];
  readonly selectedTagIds: readonly string[];
  readonly onChangeTagIds: (ids: readonly string[]) => void;
}

export function TagFilter({ tags, selectedTagIds, onChangeTagIds }: TagFilterProps): ReactNode {
  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id));

  return (
    <Autocomplete
      multiple
      size="small"
      options={[...tags]}
      getOptionLabel={(option) => option.name}
      value={[...selectedTags]}
      onChange={(_, newValue) => onChangeTagIds(newValue.map((t) => t.id))}
      isOptionEqualToValue={(option, value) => option.id === value.id}
      renderTags={(value, getTagProps) =>
        value.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              label={option.name}
              size="small"
              {...tagProps}
              sx={{
                backgroundColor: option.color ?? undefined,
                color: option.color ? '#fff' : undefined,
              }}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...(params as TextFieldProps)}
          placeholder={selectedTagIds.length === 0 ? 'Filter by tags...' : ''}
        />
      )}
      sx={{ minWidth: 280, maxWidth: 500 }}
    />
  );
}
