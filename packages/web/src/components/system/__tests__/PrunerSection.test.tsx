// Run Now deletes messages and expired collection records, so it asks first and says what it did (#417).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';

interface RunState {
  readonly data?: Record<string, unknown>;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly error: Error | null;
}

const runNow = vi.hoisted(() => ({ mutate: vi.fn(), state: {} as unknown }));
const schedule = vi.hoisted(() => ({ lastRunResult: null as unknown }));

vi.mock('../../../hooks/use-pruner.js', () => ({
  usePrunerStatus: () => ({ data: { enabled: false, cronExpression: '0 3 * * *', lastRunAt: null, lastRunResult: schedule.lastRunResult }, isLoading: false }),
  useUpdatePrunerSchedule: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null }),
  useRunPrunerNow: () => ({ mutate: runNow.mutate, ...(runNow.state as RunState) }),
}));

const { PrunerSection } = await import('../PrunerSection.js');

const IDLE: RunState = { isSuccess: false, isError: false, isPending: false, error: null };
const PRUNED = { channelsPruned: 1, totalDeleted: 20, failedChannelIds: [], expiredRecordsDeleted: 7, expiredRecordsComplete: true, expiredRecordsFailed: false };

function show(state: RunState = IDLE): void {
  runNow.state = state;
  render(<ThemeProvider theme={lightTheme}><PrunerSection /></ThemeProvider>);
}

beforeEach(() => {
  runNow.mutate.mockReset();
  schedule.lastRunResult = null;
});

afterEach(() => { cleanup(); });

describe('Run Now', () => {
  it('says what it deletes and that it cannot be undone, and runs only once that is confirmed', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Run Now' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/old messages.*records of every collection that have expired.*cannot be undone/i);
    expect(runNow.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Run pruner' }));
    expect(runNow.mutate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when it is cancelled', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Run Now' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(runNow.mutate).not.toHaveBeenCalled();
  });

  it('says how many messages and expired records it deleted', () => {
    show({ ...IDLE, isSuccess: true, data: PRUNED });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('1 channels pruned, 20 messages and 7 expired collection records deleted');
    expect(alert.className).toContain('Info');
  });

  it.each([
    ['channels', { failedChannelIds: ['c1'] }, 'Pruning failed for 1 channels'],
    ['expired records', { expiredRecordsFailed: true, expiredRecordsComplete: false }, 'Not every expired collection record could be deleted'],
  ])('is an error when it failed for %s', (_what, failure, text) => {
    show({ ...IDLE, isSuccess: true, data: { ...PRUNED, ...failure } });

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('Error');
    expect(alert.textContent).toContain(text);
  });

  it('says that the next run goes on when there were more expired records than it had time for', () => {
    show({ ...IDLE, isSuccess: true, data: { ...PRUNED, expiredRecordsComplete: false } });

    expect(screen.getByRole('alert').textContent).toContain('The next run goes on with the rest');
  });
});

describe('the last scheduled run', () => {
  it('shows its counts', () => {
    schedule.lastRunResult = { channelsPruned: 2, totalDeleted: 9, expiredRecordsDeleted: 4, completedAt: '2026-11-25T03:00:00Z' };
    show();

    expect(screen.getByText('2 channels pruned, 9 messages and 4 expired collection records deleted')).toBeTruthy();
  });
});
