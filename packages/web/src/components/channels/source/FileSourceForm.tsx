// ===========================================
// File Source Connector Form
// ===========================================
// Configuration form for file reader source connectors.

import { useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { FILE_SOURCE_DEFAULTS } from './connector-defaults.js';

const CHARSETS = ['UTF-8', 'ISO-8859-1', 'US-ASCII'] as const;
const SORT_OPTIONS = ['NAME', 'DATE', 'SIZE'] as const;
const POST_ACTIONS = ['DELETE', 'MOVE', 'NONE'] as const;

function getStr(props: Record<string, unknown>, key: string, fallback: string): string {
  const val = props[key];
  return typeof val === 'string' ? val : fallback;
}

function getNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const val = props[key];
  return typeof val === 'number' ? val : fallback;
}

function getBool(props: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const val = props[key];
  return typeof val === 'boolean' ? val : fallback;
}

export function FileSourceForm({ properties, onChange }: SourceConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...FILE_SOURCE_DEFAULTS });
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

  const handleBool = (key: string) => (_e: ChangeEvent<HTMLInputElement>, checked: boolean): void => {
    update(key, checked);
  };

  const postAction = getStr(properties, 'postAction', 'DELETE');

  return (
    <Grid container spacing={3}>
      {/* Left column — Directory settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Directory
        </Typography>

        <TextField
          label="Directory"
          value={getStr(properties, 'directory', '')}
          onChange={handleText('directory')}
          helperText="Path to the directory to read files from"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="File Filter"
          value={getStr(properties, 'fileFilter', '*')}
          onChange={handleText('fileFilter')}
          helperText="Glob pattern to match files (e.g., *.hl7, *.xml)"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Sort By"
          value={getStr(properties, 'sortBy', 'NAME')}
          onChange={handleText('sortBy')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {SORT_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Polling Interval (ms)"
          type="number"
          value={getNum(properties, 'pollingIntervalMs', 5000)}
          onChange={handleNumber('pollingIntervalMs')}
          helperText="How often to check for new files"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 100 } }}
        />
      </Grid>

      {/* Right column — Processing settings */}
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Processing
        </Typography>

        <TextField
          label="Charset"
          value={getStr(properties, 'charset', 'UTF-8')}
          onChange={handleText('charset')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {CHARSETS.map((c) => (
            <MenuItem key={c} value={c}>{c}</MenuItem>
          ))}
        </TextField>

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'binary', false)}
              onChange={handleBool('binary')}
            />
          }
          label="Binary Mode"
          sx={{ mb: 2, display: 'block' }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={getBool(properties, 'checkFileAge', true)}
              onChange={handleBool('checkFileAge')}
            />
          }
          label="Check File Age"
          sx={{ mb: 1, display: 'block' }}
        />

        {getBool(properties, 'checkFileAge', true) && (
          <TextField
            label="Minimum File Age (ms)"
            type="number"
            value={getNum(properties, 'fileAgeMs', 1000)}
            onChange={handleNumber('fileAgeMs')}
            helperText="Only process files older than this age"
            fullWidth
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { min: 0 } }}
          />
        )}

        <TextField
          label="Post-Processing Action"
          value={postAction}
          onChange={handleText('postAction')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {POST_ACTIONS.map((a) => (
            <MenuItem key={a} value={a}>{a}</MenuItem>
          ))}
        </TextField>

        {postAction === 'MOVE' && (
          <TextField
            label="Move-To Directory"
            value={getStr(properties, 'moveToDirectory', '')}
            onChange={handleText('moveToDirectory')}
            helperText="Directory to move processed files to"
            fullWidth
            sx={{ mb: 2 }}
          />
        )}
      </Grid>
    </Grid>
  );
}
