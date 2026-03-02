// ===========================================
// DICOM Source Connector Form
// ===========================================
// Configuration form for DICOM C-STORE SCP source connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { DICOM_SOURCE_DEFAULTS } from './connector-defaults.js';

const DISPATCH_MODES = ['PER_FILE', 'PER_ASSOCIATION'] as const;
const POST_ACTIONS = ['DELETE', 'MOVE', 'NONE'] as const;

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

export function DicomSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...DICOM_SOURCE_DEFAULTS });
    }
  }, [properties, onChange]);

  const update = (key: string, value: unknown): void => {
    onChange({ ...properties, [key]: value });
  };

  const handleText = (key: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    update(key, e.target.value);
  };

  const handleNumber = (key: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    const parsed = parseInt(e.target.value, 10);
    update(key, Number.isNaN(parsed) ? 0 : parsed);
  };

  const postAction = getStr(properties, 'postAction', 'DELETE');

  return (
    <Grid container spacing={3}>
      {/* Left column — DICOM Listener */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          DICOM Listener
        </Typography>

        <TextField
          label="Port"
          type="number"
          value={getNum(properties, 'port', 4242)}
          onChange={handleNumber('port')}
          helperText="DICOM SCP port (1-65535)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        />

        <TextField
          label="AE Title"
          value={getStr(properties, 'aeTitle', 'MIRTHLESS')}
          onChange={handleText('aeTitle')}
          helperText="Application Entity Title (max 16 characters)"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { maxLength: 16 } }}
        />

        <TextField
          label="Storage Directory"
          value={getStr(properties, 'storageDir', '')}
          onChange={handleText('storageDir')}
          helperText="Directory for received DICOM files"
          fullWidth
          sx={{ mb: 2 }}
        />
      </Grid>

      {/* Right column — Processing */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Processing
        </Typography>

        <TextField
          label="Min Pool Size"
          type="number"
          value={getNum(properties, 'minPoolSize', 2)}
          onChange={handleNumber('minPoolSize')}
          helperText="Minimum worker pool size"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />

        <TextField
          label="Max Pool Size"
          type="number"
          value={getNum(properties, 'maxPoolSize', 10)}
          onChange={handleNumber('maxPoolSize')}
          helperText="Maximum worker pool size"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />

        <TextField
          label="Connection Timeout (ms)"
          type="number"
          value={getNum(properties, 'connectionTimeoutMs', 10000)}
          onChange={handleNumber('connectionTimeoutMs')}
          helperText="Timeout waiting for idle worker"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1000 } }}
        />

        <TextField
          label="Dispatch Mode"
          value={getStr(properties, 'dispatchMode', 'PER_FILE')}
          onChange={handleText('dispatchMode')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {DISPATCH_MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {m === 'PER_FILE' ? 'Per File' : 'Per Association'}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Post Action"
          value={postAction}
          onChange={handleText('postAction')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {POST_ACTIONS.map((a) => (
            <MenuItem key={a} value={a}>{a === 'DELETE' ? 'Delete' : a === 'MOVE' ? 'Move' : 'None'}</MenuItem>
          ))}
        </TextField>

        {postAction === 'MOVE' && (
          <TextField
            label="Move-To Directory"
            value={getStr(properties, 'moveToDirectory', '')}
            onChange={handleText('moveToDirectory')}
            helperText="Directory to move files after processing"
            fullWidth
            sx={{ mb: 2 }}
          />
        )}
      </Grid>
    </Grid>
  );
}
