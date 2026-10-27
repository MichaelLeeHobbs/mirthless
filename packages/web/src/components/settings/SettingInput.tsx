// ===========================================
// Setting Input
// ===========================================
// The control for one setting, picked by its type: a switch for booleans, a
// number field, a monospace box for JSON, a write-only field for secrets and a
// text field for the rest.

import { useState, type ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';

interface SettingInputProps {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
  readonly error: string | null;
  /** Set for a secret: the field starts empty and says whether a value is stored. */
  readonly secretStored?: boolean;
  readonly placeholder?: string;
}

function SecretInput({ id, label, value, onChange, disabled, error, secretStored }: SettingInputProps): ReactNode {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      id={id}
      size="small"
      fullWidth
      type={shown ? 'text' : 'password'}
      autoComplete="new-password"
      value={value}
      disabled={disabled}
      placeholder={secretStored ? 'Saved. Type to replace.' : 'Not set'}
      error={error !== null}
      helperText={error}
      onChange={(e) => { onChange(e.target.value); }}
      slotProps={{
        htmlInput: { 'aria-label': label },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" edge="end" aria-label={shown ? `Hide ${label}` : `Show ${label}`} onClick={() => { setShown((s) => !s); }} disabled={disabled}>
                {shown ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

export function SettingInput(props: SettingInputProps): ReactNode {
  const { id, label, type, value, onChange, disabled, error, secretStored, placeholder } = props;

  if (secretStored !== undefined) return <SecretInput {...props} />;

  if (type === 'boolean') {
    return (
      <Switch
        id={id}
        checked={value === 'true'}
        disabled={disabled}
        onChange={(_e, checked) => { onChange(checked ? 'true' : 'false'); }}
        slotProps={{ input: { 'aria-label': label } }}
      />
    );
  }

  const json = type === 'json';
  return (
    <TextField
      id={id}
      size="small"
      fullWidth
      type={type === 'number' ? 'number' : 'text'}
      multiline={json}
      minRows={json ? 3 : undefined}
      maxRows={json ? 8 : undefined}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      error={error !== null}
      helperText={error}
      onChange={(e) => { onChange(e.target.value); }}
      slotProps={{ htmlInput: { 'aria-label': label, style: json ? { fontFamily: FONT_FAMILY_MONO, fontSize: '0.85rem' } : undefined } }}
    />
  );
}
