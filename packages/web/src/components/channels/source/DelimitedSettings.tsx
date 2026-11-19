// Kept on the source transformer as inboundProperties.delimited (D-257), and
// validated with the schema deploy checks, so a bad setting shows before deploying.

import { useEffect, useState, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { delimitedOptionsSchema } from '@galvanigraph/core-models';
import { unescapeControlChars } from '@galvanigraph/core-util';
import { FONT_FAMILY_MONO } from '../../../styles/tokens.js';
import { propertyUpdaters } from '../common/connector-properties.js';

type Settings = Readonly<Record<string, unknown>>;

const ESCAPES: ReadonlyArray<readonly [string, string]> = [['\\', '\\\\'], ['\n', '\\n'], ['\r', '\\r'], ['\t', '\\t']];

/** So a delimiter can be typed and seen; unescapeControlChars (core-util) reads them back. */
export function showEscapes(text: string): string {
  let out = text;
  for (const [raw, shown] of ESCAPES) out = out.replaceAll(raw, shown);
  return out;
}

function shown(settings: Settings): ReturnType<typeof delimitedOptionsSchema.parse> {
  const parsed = delimitedOptionsSchema.safeParse(settings);
  return parsed.success ? parsed.data : { ...delimitedOptionsSchema.parse({}), ...settings } as ReturnType<typeof delimitedOptionsSchema.parse>;
}

export function delimitedProblem(settings: Settings): string | undefined {
  const parsed = delimitedOptionsSchema.safeParse(settings);
  return parsed.success ? undefined : parsed.error.issues.map((i) => i.message).join('; ');
}

export function readColumnNames(text: string): string[] {
  return text.split(',').map((name) => name.trim()).filter((name) => name !== '');
}

interface DraftFieldProps<T> {
  readonly label: string;
  readonly value: T;
  readonly format: (value: T) => string;
  readonly parse: (text: string) => T;
  readonly onCommit: (value: T) => void;
  readonly helperText?: string;
  readonly mono?: boolean;
}

/**
 * A text field that keeps what is typed. Saving the parsed value and showing
 * it formatted on every keystroke would rewrite a half-typed "\" or a trailing
 * comma; the draft is replaced only when the saved value changes from outside.
 */
function DraftField<T>({ label, value, format, parse, onCommit, helperText, mono }: DraftFieldProps<T>): ReactNode {
  const [draft, setDraft] = useState(() => format(value));
  useEffect(() => {
    if (format(parse(draft)) !== format(value)) setDraft(format(value));
    // Only an outside change to the saved value replaces the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <TextField label={label} size="small" fullWidth value={draft} helperText={helperText}
      onChange={(e) => { setDraft(e.target.value); onCommit(parse(e.target.value)); }}
      slotProps={mono === true ? { htmlInput: { style: { fontFamily: FONT_FAMILY_MONO } } } : undefined} />
  );
}

const asText = (text: string): string => text;
const joinNames = (names: readonly string[]): string => names.join(', ');

interface DelimitedSettingsProps {
  readonly settings: Settings;
  readonly onChange: (settings: Record<string, unknown>) => void;
}

export function DelimitedSettings({ settings, onChange }: DelimitedSettingsProps): ReactNode {
  const s = shown(settings);
  const { update: set } = propertyUpdaters(settings, onChange);
  const problem = delimitedProblem(settings);
  return (
    <>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>Delimited settings</Typography>
      {problem !== undefined && <Alert severity="error" sx={{ mb: 2 }}>The channel will not deploy: {problem}</Alert>}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <DraftField label="Column delimiter" value={s.columnDelimiter} format={showEscapes} parse={unescapeControlChars}
            onCommit={(v) => { set('columnDelimiter', v); }} helperText="\t for tab" mono />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <DraftField label="Record delimiter" value={s.recordDelimiter} format={showEscapes} parse={unescapeControlChars}
            onCommit={(v) => { set('recordDelimiter', v); }} helperText="\n or \r\n" mono />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <DraftField label="Quote" value={s.quote} format={asText} parse={asText}
            onCommit={(v) => { set('quote', v); }} mono />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          {s.escapeWithDoubleQuote
            ? <TextField label="Quote escape" size="small" fullWidth value="" disabled helperText="Used when quotes are not doubled" />
            : <DraftField label="Quote escape" value={s.quoteEscape} format={asText} parse={asText}
                onCommit={(v) => { set('quoteEscape', v); }} mono />}
        </Grid>
        <Grid size={12}>
          <DraftField label="Column names" value={s.columnNames} format={joinNames} parse={readColumnNames}
            onCommit={(v) => { set('columnNames', v); }}
            helperText="In order, comma-separated. Scripts read msg[0].name; a column past the list is column4, column5…" />
        </Grid>
      </Grid>
      <FormControlLabel label='A quote inside a quoted value is written twice ("")'
        control={<Switch checked={s.escapeWithDoubleQuote} onChange={(_e, on) => { set('escapeWithDoubleQuote', on); }} />} />
      <FormControlLabel label="Ignore carriage returns (read CRLF files like LF)"
        control={<Switch checked={s.ignoreCR} onChange={(_e, on) => { set('ignoreCR', on); }} />} />
    </>
  );
}
