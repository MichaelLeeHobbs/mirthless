// ===========================================
// SystemInfoPage Tests
// ===========================================
// Tabs live in the path, so each one is a bookmark and one click from the
// palette. Overview leads with a status strip that names what is wrong, and
// "Copy diagnostics" puts a plain-text summary on the clipboard. Data hooks
// are mocked at the API boundary.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../styles/theme.js';

const GB = 2 ** 30;
const MB = 2 ** 20;
const notifyMock = vi.fn();
const useSystemInfoMock = vi.fn();

const INFO = {
  server: { version: '0.1.0', nodeVersion: 'v24.1.0', env: 'production', pid: 4127, uptime: 389_200, startedAt: '2026-10-23T00:00:00.000Z', hostname: 'mirth-01' },
  os: { platform: 'linux', release: '6.8.0', arch: 'x64', cpus: 8, loadAverage: [0.42, 0.38, 0.3], totalMemory: 16 * GB, freeMemory: 9 * GB },
  memory: { rss: 512 * MB, heapUsed: 214 * MB, heapTotal: 300 * MB, heapLimit: 4 * GB, external: 12 * MB },
  engine: { deployed: 6, started: 4, stopped: 1, paused: 1 },
  database: { connected: true, latencyMs: 2.4, version: '17.2', sizeBytes: 3 * GB },
};

function query(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { data: INFO, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), ...overrides };
}

vi.mock('../../hooks/use-system-info.js', () => ({
  useSystemInfo: (enabled?: boolean) => useSystemInfoMock(enabled),
}));
vi.mock('../../stores/notification.store.js', () => ({
  useNotification: () => ({ notify: notifyMock }),
}));
vi.mock('../../hooks/use-logs.js', () => ({
  useHistoricalLogs: () => ({ data: { entries: [], total: 0 } }),
  useLogStream: () => ({ entries: [], paused: false, setPaused: vi.fn(), clear: vi.fn() }),
}));
vi.mock('../../hooks/use-pruner.js', () => ({
  usePrunerStatus: () => ({ data: { enabled: true, cronExpression: '0 2 * * *', lastRunAt: null, lastRunResult: null }, isLoading: false }),
  useUpdatePrunerSchedule: () => ({ mutate: vi.fn(), isPending: false }),
  useRunPrunerNow: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../hooks/use-backup.js', () => ({
  useBackup: () => ({ mutate: vi.fn(), isPending: false }),
  useRestore: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SystemInfoPage } from '../SystemInfoPage.js';

function Where(): React.ReactNode {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderAt(path: string): void {
  render(
    <ThemeProvider theme={lightTheme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/system" element={<SystemInfoPage />} />
          <Route path="/system/:tab" element={<SystemInfoPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  notifyMock.mockReset();
  useSystemInfoMock.mockReset().mockReturnValue(query());
});
afterEach(() => { cleanup(); });

describe('SystemInfoPage tabs', () => {
  it('opens on Overview and polls system info there', () => {
    renderAt('/system');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeTruthy();
    expect(useSystemInfoMock).toHaveBeenCalledWith(true);
  });

  it('opens the tab named in the path and stops polling system info', () => {
    renderAt('/system/pruner');
    expect(screen.getByRole('tab', { name: 'Data pruner', selected: true })).toBeTruthy();
    expect(screen.getByText('Auto-prune enabled')).toBeTruthy();
    expect(useSystemInfoMock).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('button', { name: /copy diagnostics/i })).toBeNull();
  });

  it('moves to a tab’s own path with one click', () => {
    renderAt('/system');
    fireEvent.click(screen.getByRole('tab', { name: 'Logs' }));
    expect(screen.getByTestId('where').textContent).toBe('/system/logs');
    fireEvent.click(screen.getByRole('tab', { name: 'Backup & restore' }));
    expect(screen.getByTestId('where').textContent).toBe('/system/backup');
  });

  it('sends an unknown tab back to Overview', () => {
    renderAt('/system/nope');
    expect(screen.getByTestId('where').textContent).toBe('/system');
  });
});

describe('SystemInfoPage overview', () => {
  it('names each part of the server in the status strip', () => {
    renderAt('/system');
    const strip = screen.getByRole('region', { name: 'System status' });
    expect(strip.textContent).toContain('PostgreSQL 17.2 · 2.4 ms');
    expect(strip.textContent).toContain('4 of 6 started · 1 paused · 1 stopped');
    expect(screen.getByLabelText(/^Engine: Attention/)).toBeTruthy();
  });

  it('links the engine cell to the dashboard', () => {
    renderAt('/system');
    fireEvent.click(screen.getByLabelText(/^Engine:/));
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('shows the database as unreachable when the probe fails', () => {
    useSystemInfoMock.mockReturnValue(query({ data: { ...INFO, database: { connected: false, latencyMs: null, version: null, sizeBytes: null } } }));
    renderAt('/system');
    expect(screen.getByLabelText(/^Database: Unreachable/)).toBeTruthy();
  });

  it('shows an error with retry when system info fails to load', () => {
    const refetch = vi.fn();
    useSystemInfoMock.mockReturnValue(query({ data: undefined, error: new Error('boom'), refetch }));
    renderAt('/system');
    expect(screen.getByText("Couldn't load system info")).toBeTruthy();
    expect((screen.getByRole('button', { name: /copy diagnostics/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('copies a plain-text diagnostics summary and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/system');
    fireEvent.click(screen.getByRole('button', { name: /copy diagnostics/i }));
    await waitFor(() => { expect(notifyMock).toHaveBeenCalledWith('Diagnostics copied to the clipboard', 'success'); });
    expect(String(writeText.mock.calls[0]?.[0])).toContain('pid 4127 on mirth-01');
  });

  it('reports a clipboard failure instead of claiming success', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    renderAt('/system');
    fireEvent.click(screen.getByRole('button', { name: /copy diagnostics/i }));
    await waitFor(() => { expect(notifyMock).toHaveBeenCalledWith('Could not copy to the clipboard', 'error'); });
  });
});
