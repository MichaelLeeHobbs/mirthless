// ===========================================
// Templates Section
// ===========================================
// Alert notification templates and limits.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Grid from '@mui/material/Grid';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { ALERT_TEMPLATE_VARIABLES } from '@galvaniflow/core-models';

export interface TemplateFormValues {
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly reAlertIntervalMs: number | null;
  readonly maxAlerts: number | null;
}

interface TemplatesSectionProps {
  readonly values: TemplateFormValues;
  readonly onChange: (values: TemplateFormValues) => void;
}

type TemplateField = 'subjectTemplate' | 'bodyTemplate';

const KNOWN_VARIABLES: ReadonlySet<string> = new Set(ALERT_TEMPLATE_VARIABLES.map((v) => v.name));

/** Placeholders in a template that the engine will not substitute, e.g. `${error}`. */
export function findUnknownVariables(template: string): readonly string[] {
  const names = Array.from(template.matchAll(/\$\{(\w*)\}/g), (m) => m[1] ?? '');
  return [...new Set(names.filter((n) => !KNOWN_VARIABLES.has(n)))];
}

function helperFor(template: string, hint: string): { readonly text: string; readonly warn: boolean } {
  const unknown = findUnknownVariables(template);
  if (unknown.length === 0) return { text: hint, warn: false };
  const list = unknown.map((n) => '${' + n + '}').join(', ');
  return { text: `Not a variable, will be sent as written: ${list}`, warn: true };
}

export function TemplatesSection({ values, onChange }: TemplatesSectionProps): ReactNode {
  const [activeField, setActiveField] = useState<TemplateField>('bodyTemplate');
  const inputs = useRef<Partial<Record<TemplateField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const focused = useRef<Partial<Record<TemplateField, boolean>>>({});
  const pendingCaret = useRef<number | null>(null);

  // Put the caret after an inserted variable once the new value has rendered.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const input = inputs.current[activeField];
    if (caret === null || !input) return;
    pendingCaret.current = null;
    input.focus();
    input.setSelectionRange(caret, caret);
  });

  const insertVariable = (name: string): void => {
    const token = '${' + name + '}';
    const current = values[activeField];
    // Until the field has been focused there is no caret to honour, so append.
    const input = focused.current[activeField] ? inputs.current[activeField] : undefined;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    pendingCaret.current = start + token.length;
    onChange({ ...values, [activeField]: current.slice(0, start) + token + current.slice(end) });
  };

  const subject = helperFor(values.subjectTemplate, 'Leave empty to use "Alert: <alert name>".');
  const body = helperFor(values.bodyTemplate, 'Leave empty for a summary of the alert, channel, error and time.');

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Notification Templates</Typography>

      <TextField
        label="Subject Template"
        value={values.subjectTemplate}
        onChange={(e) => { onChange({ ...values, subjectTemplate: e.target.value }); }}
        onFocus={() => { focused.current.subjectTemplate = true; setActiveField('subjectTemplate'); }}
        inputRef={(el: HTMLInputElement | null) => { inputs.current.subjectTemplate = el; }}
        fullWidth
        size="small"
        sx={{ mb: 2 }}
        helperText={subject.text}
        slotProps={{ formHelperText: { sx: subject.warn ? { color: 'warning.main' } : {} } }}
      />

      <TextField
        label="Body Template"
        value={values.bodyTemplate}
        onChange={(e) => { onChange({ ...values, bodyTemplate: e.target.value }); }}
        onFocus={() => { focused.current.bodyTemplate = true; setActiveField('bodyTemplate'); }}
        inputRef={(el: HTMLTextAreaElement | null) => { inputs.current.bodyTemplate = el; }}
        fullWidth
        size="small"
        multiline
        rows={4}
        sx={{ mb: 1 }}
        helperText={body.text}
        slotProps={{ formHelperText: { sx: body.warn ? { color: 'warning.main' } : {} } }}
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mb: 3 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
          Insert into {activeField === 'subjectTemplate' ? 'subject' : 'body'}:
        </Typography>
        {ALERT_TEMPLATE_VARIABLES.map((v) => (
          <Tooltip key={v.name} title={v.description} describeChild>
            <Chip
              label={'${' + v.name + '}'}
              size="small"
              variant="outlined"
              // Keep focus (and the caret) in the field being edited.
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={() => { insertVariable(v.name); }}
              sx={{ fontFamily: (t) => t.palette.fontFamilyMono }}
            />
          </Tooltip>
        ))}
      </Box>

      <Typography variant="subtitle2" gutterBottom>Limits</Typography>
      <Grid container spacing={2}>
        <Grid
          size={{
            xs: 12,
            md: 6
          }}>
          <TextField
            label="Re-alert Interval (ms)"
            type="number"
            value={values.reAlertIntervalMs ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onChange({
                ...values,
                reAlertIntervalMs: val === '' ? null : parseInt(val, 10),
              });
            }}
            fullWidth
            size="small"
            helperText="Minimum time between alerts (leave empty for no limit)"
          />
        </Grid>
        <Grid
          size={{
            xs: 12,
            md: 6
          }}>
          <TextField
            label="Max Alerts"
            type="number"
            value={values.maxAlerts ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onChange({
                ...values,
                maxAlerts: val === '' ? null : parseInt(val, 10),
              });
            }}
            fullWidth
            size="small"
            helperText="Maximum number of alerts to send (leave empty for no limit)"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
