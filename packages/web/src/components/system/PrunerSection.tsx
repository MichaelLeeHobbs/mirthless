// ===========================================
// Pruner Section
// ===========================================
// Data pruner scheduling UI: enable/disable, cron input, run now, last run info.

import { useState, useEffect, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import { usePrunerStatus, useUpdatePrunerSchedule, useRunPrunerNow } from '../../hooks/use-pruner.js';

export function PrunerSection(): ReactNode {
  const { data: status, isLoading } = usePrunerStatus();
  const updateMutation = useUpdatePrunerSchedule();
  const runNowMutation = useRunPrunerNow();

  const [enabled, setEnabled] = useState(false);
  const [cronExpression, setCronExpression] = useState('0 3 * * *');

  useEffect(() => {
    if (status) {
      setEnabled(status.enabled);
      setCronExpression(status.cronExpression);
    }
  }, [status]);

  const handleSave = (): void => {
    updateMutation.mutate({ enabled, cronExpression });
  };

  const handleRunNow = (): void => {
    runNowMutation.mutate(undefined);
  };

  if (isLoading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Data Pruner</Typography>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Data Pruner</Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(_, checked) => setEnabled(checked)} />}
          label="Auto-prune enabled"
        />
        <Chip
          label={enabled ? 'Enabled' : 'Disabled'}
          color={enabled ? 'success' : 'default'}
          size="small"
        />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <TextField
          label="Cron Expression"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          size="small"
          sx={{ width: 300 }}
          helperText="e.g., 0 3 * * * (3 AM daily)"
        />
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={updateMutation.isPending}
        >
          Save Schedule
        </Button>
        <Button
          variant="outlined"
          onClick={handleRunNow}
          disabled={runNowMutation.isPending}
        >
          {runNowMutation.isPending ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
          Run Now
        </Button>
      </Box>

      {updateMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to update schedule: {updateMutation.error.message}
        </Alert>
      )}

      {updateMutation.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Schedule updated successfully
        </Alert>
      )}

      {runNowMutation.isSuccess && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Pruning complete: {runNowMutation.data.channelsPruned} channels pruned, {runNowMutation.data.totalDeleted} messages deleted
        </Alert>
      )}

      {runNowMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Pruning failed: {runNowMutation.error.message}
        </Alert>
      )}

      {status?.lastRunResult && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Last run: {new Date(status.lastRunResult.completedAt).toLocaleString()}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {status.lastRunResult.channelsPruned} channels pruned, {status.lastRunResult.totalDeleted} messages deleted
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
