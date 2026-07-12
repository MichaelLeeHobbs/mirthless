// ===========================================
// Headers Key/Value Editor
// ===========================================
// Edits an HTTP header map as a Record<string, string>. The connector
// dispatchers spread `headers` as a Record, so the form must produce an
// object — never a raw string.

import { type ReactNode, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

interface HeadersEditorProps {
  readonly value: Record<string, string>;
  readonly onChange: (headers: Record<string, string>) => void;
  readonly label?: string;
}

/** Parse a possibly-legacy value into a header record. Accepts an object or a
 * newline/colon delimited string (for records saved before this editor existed). */
export function coerceHeaders(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key.length > 0) out[key] = val;
      }
    }
    return out;
  }
  return {};
}

/** Ordered rows so typing an empty key doesn't collapse the row. */
export function HeadersEditor({ value, onChange, label = 'Headers' }: HeadersEditorProps): ReactNode {
  const rows = Object.entries(value);

  const rebuild = (next: readonly (readonly [string, string])[]): void => {
    const out: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k.length > 0) out[k] = v;
    }
    onChange(out);
  };

  const handleKeyChange = (index: number) => (e: ChangeEvent<HTMLInputElement>): void => {
    const next = rows.map((r, i): readonly [string, string] => (i === index ? [e.target.value, r[1]] : r));
    rebuild(next);
  };

  const handleValueChange = (index: number) => (e: ChangeEvent<HTMLInputElement>): void => {
    const next = rows.map((r, i): readonly [string, string] => (i === index ? [r[0], e.target.value] : r));
    rebuild(next);
  };

  const handleRemove = (index: number) => (): void => {
    rebuild(rows.filter((_, i) => i !== index));
  };

  const handleAdd = (): void => {
    // Store a placeholder key so a new empty row renders; ignored until named.
    onChange({ ...value, '': '' });
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {label}
      </Typography>
      {rows.map(([key, val], index) => (
        <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
          <TextField
            label="Name"
            value={key}
            onChange={handleKeyChange(index)}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            label="Value"
            value={val}
            onChange={handleValueChange(index)}
            size="small"
            sx={{ flex: 2 }}
          />
          <IconButton size="small" color="error" onClick={handleRemove(index)} aria-label="remove header">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={handleAdd} sx={{ mt: 0.5 }}>
        Add Header
      </Button>
    </Box>
  );
}
