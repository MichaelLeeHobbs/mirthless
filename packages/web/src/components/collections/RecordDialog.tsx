// ===========================================
// Collection Record Dialog
// ===========================================
// Add, edit or (without collections:write) view one collection record: a
// box per indexed field, the payload, and when it expires.

import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CollectionRecord, CollectionSummary } from '../../hooks/use-collections.js';
import { filledFields, formatTtl, fromDateTimeLocal, toDateTimeLocal } from '../../lib/collections.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';

/** What the dialog hands back on save. `expireAt: null` means never (edit) or the collection default (add). */
export interface RecordDraft {
  readonly fields: Record<string, string>;
  readonly payload: string;
  readonly expireAt: string | null;
}

interface RecordDialogProps {
  readonly collection: CollectionSummary;
  /** The record to edit or view; null to add a new one. */
  readonly record: CollectionRecord | null;
  readonly readOnly: boolean;
  readonly isPending: boolean;
  /** A server error from the last save, shown above the form. */
  readonly error: string | null;
  readonly onSave: (draft: RecordDraft) => void;
  readonly onClose: () => void;
}

const MONO = { fontFamily: FONT_FAMILY_MONO, fontSize: '0.8125rem' } as const;

function dialogTitle(record: CollectionRecord | null, readOnly: boolean): string {
  if (record === null) return 'Add record';
  return readOnly ? 'Record' : 'Edit record';
}

function expiryHelp(collection: CollectionSummary, isNew: boolean): string {
  if (!isNew) return 'Leave blank to keep it forever.';
  return collection.defaultTtlSeconds === null
    ? 'Leave blank to keep it forever.'
    : `Leave blank to use the collection default (${formatTtl(collection.defaultTtlSeconds)}).`;
}

/** Mount with a `key` per record so the form starts from that record's values. */
export function RecordDialog({ collection, record, readOnly, isPending, error, onSave, onClose }: RecordDialogProps): ReactNode {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(collection.indexedFields.map((f) => [f, record?.fields[f] ?? ''])));
  const [payload, setPayload] = useState(record?.payload ?? '');
  const [expires, setExpires] = useState(toDateTimeLocal(record?.expireAt ?? null));
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = (): void => {
    const expireAt = fromDateTimeLocal(expires);
    if (expireAt === undefined) {
      setFormError('Expires must be a date and time, or blank.');
      return;
    }
    setFormError(null);
    onSave({ fields: filledFields(values), payload, expireAt });
  };

  const shownError = formError ?? error;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{dialogTitle(record, readOnly)}</DialogTitle>
      <DialogContent>
        {shownError ? <Alert severity="error" sx={{ mb: 2 }}>{shownError}</Alert> : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, flexWrap: 'wrap', mt: 1 }}>
          {collection.indexedFields.map((field, i) => (
            <TextField
              key={field}
              autoFocus={i === 0 && !readOnly}
              label={field}
              size="small"
              value={values[field] ?? ''}
              onChange={(e) => { setValues({ ...values, [field]: e.target.value }); }}
              slotProps={{ input: { readOnly, sx: MONO } }}
              sx={{ flex: { sm: '1 1 200px' } }}
            />
          ))}
        </Stack>
        <TextField
          label="Payload"
          fullWidth
          multiline
          minRows={6}
          maxRows={18}
          margin="normal"
          value={payload}
          onChange={(e) => { setPayload(e.target.value); }}
          slotProps={{ input: { readOnly, sx: MONO } }}
        />
        <TextField
          label="Expires"
          type="datetime-local"
          size="small"
          value={expires}
          onChange={(e) => { setExpires(e.target.value); }}
          helperText={readOnly ? undefined : expiryHelp(collection, record === null)}
          slotProps={{ input: { readOnly }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 260 }}
        />
        {record ? (
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1.5 }}>
            Created {new Date(record.createdAt).toLocaleString()}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {readOnly ? null : (
          <Button variant="contained" onClick={handleSave} disabled={isPending}>
            {record === null ? 'Add' : 'Save'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
