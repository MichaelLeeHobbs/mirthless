// ===========================================
// Channel Import Dialog
// ===========================================
// Upload dialog with file picker, preview, collision mode select, and import button.

import { useState, useRef, type ReactNode, type ChangeEvent } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import UploadIcon from '@mui/icons-material/Upload';
import { api } from '../../api/client.js';

interface ImportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

interface ImportResult {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

const COLLISION_MODES = [
  { value: 'SKIP', label: 'Skip — Keep existing channel, skip import' },
  { value: 'OVERWRITE', label: 'Overwrite — Replace existing channel with imported data' },
  { value: 'CREATE_NEW', label: 'Create New — Import as a new channel with a new ID' },
] as const;

export function ImportDialog({ open, onClose, onSuccess }: ImportDialogProps): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [collisionMode, setCollisionMode] = useState<string>('SKIP');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setError('');
    setResult(null);
    const selected = e.target.files?.[0];
    if (!selected) {
      setFile(null);
      setPreview('');
      return;
    }
    setFile(selected);

    const reader = new FileReader();
    reader.onload = (): void => {
      try {
        const json = JSON.parse(reader.result as string) as { channels?: unknown[] };
        const channelCount = Array.isArray(json.channels) ? json.channels.length : 0;
        setPreview(`${selected.name} (${String(channelCount)} channel${channelCount === 1 ? '' : 's'})`);
      } catch {
        setPreview(selected.name);
        setError('Invalid JSON file');
      }
    };
    reader.readAsText(selected);
  };

  const handleImport = async (): Promise<void> => {
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const body = { ...parsed, collisionMode };

      const response = await api.post<ImportResult>('/channels/import', body);
      if (!response.success) {
        setError(response.error?.message ?? 'Import failed');
        return;
      }
      setResult(response.data);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = (): void => {
    setFile(null);
    setPreview('');
    setError('');
    setResult(null);
    setCollisionMode('SKIP');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Import Channels</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => fileInputRef.current?.click()}
            sx={{ mb: 1 }}
          >
            Select File
          </Button>
          {preview ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {preview}
            </Typography>
          ) : null}
        </Box>

        <TextField
          label="Collision Mode"
          value={collisionMode}
          onChange={(e) => { setCollisionMode(e.target.value); }}
          select
          fullWidth
          sx={{ mb: 2 }}
          helperText="How to handle channels that already exist"
        >
          {COLLISION_MODES.map((mode) => (
            <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>
          ))}
        </TextField>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

        {result ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            Import complete: {String(result.created)} created, {String(result.updated)} updated,
            {' '}{String(result.skipped)} skipped
            {result.errors.length > 0 ? `, ${String(result.errors.length)} errors` : ''}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result ? (
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={!file || importing}
          >
            {importing ? 'Importing...' : 'Import'}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
