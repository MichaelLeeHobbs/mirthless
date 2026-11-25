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
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { usePrunerStatus, useUpdatePrunerSchedule, useRunPrunerNow } from '../../hooks/use-pruner.js';

interface PrunedCounts {
  readonly channelsPruned: number;
  readonly totalDeleted: number;
  readonly expiredRecordsDeleted: number;
}

function countsText({ channelsPruned, totalDeleted, expiredRecordsDeleted }: PrunedCounts): string {
  return `${String(channelsPruned)} channels pruned, ${String(totalDeleted)} messages and ${String(expiredRecordsDeleted)} expired collection records deleted`;
}

type RunResult = NonNullable<ReturnType<typeof useRunPrunerNow>['data']>;

function leftText({ failedChannelIds, expiredRecordsFailed, expiredRecordsComplete }: RunResult): string {
  const sentences: string[] = [];
  if (failedChannelIds.length > 0) sentences.push(`Pruning failed for ${String(failedChannelIds.length)} channels; see the server log.`);
  if (expiredRecordsFailed) sentences.push('Not every expired collection record could be deleted; see the server log.');
  else if (!expiredRecordsComplete) sentences.push('There were more expired collection records than it had time for. The next run goes on with the rest.');
  return sentences.length === 0 ? '' : `. ${sentences.join(' ')}`;
}

function isFailed(run: RunResult & { readonly failed?: boolean }): boolean {
  return run.failed === true || run.failedChannelIds.length > 0 || run.expiredRecordsFailed;
}

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

  const [confirming, setConfirming] = useState(false);
  const handleRunNow = (): void => {
    setConfirming(false);
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
          onClick={() => { setConfirming(true); }}
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
        <Alert severity={isFailed(runNowMutation.data) ? 'error' : 'info'} sx={{ mb: 2 }}>
          Pruner run: {countsText(runNowMutation.data)}{leftText(runNowMutation.data)}
        </Alert>
      )}

      {runNowMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Pruning failed: {runNowMutation.error.message}
        </Alert>
      )}

      {status?.lastRunResult && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{
            color: 'text.secondary'
          }}>
            Last run: {new Date(status.lastRunResult.completedAt).toLocaleString()}
          </Typography>
          <Typography variant="body2" sx={{ color: isFailed(status.lastRunResult) ? 'error.main' : 'text.secondary' }}>
            {status.lastRunResult.failed ? 'The run failed. See the server log.' : `${countsText(status.lastRunResult)}${leftText(status.lastRunResult)}`}
          </Typography>
        </Box>
      )}

      <ConfirmDialog
        open={confirming}
        title="Run the data pruner now?"
        message="It deletes the old messages of every channel that has pruning on, and the records of every collection that have expired. This cannot be undone."
        confirmLabel="Run pruner"
        severity="error"
        onConfirm={handleRunNow}
        onCancel={() => { setConfirming(false); }}
      />
    </Paper>
  );
}
