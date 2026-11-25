import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import type { LogEntry } from '../../../hooks/use-logs.js';

let historical: readonly LogEntry[] = [];
let live: readonly LogEntry[] = [];
vi.mock('../../../hooks/use-logs.js', () => ({
  useHistoricalLogs: () => ({ data: { entries: historical, total: historical.length } }),
  useLogStream: () => ({ entries: live, paused: false, setPaused: vi.fn(), clear: vi.fn() }),
}));

const { LogViewer } = await import('../LogViewer.js');

const entry = (seq: number, message: string): LogEntry => ({ timestamp: '2026-11-25T10:00:00.000Z', level: 30, levelLabel: 'INFO', logger: 'server', message, seq });

function show(stored: readonly LogEntry[], streamed: readonly LogEntry[] = []): void {
  historical = stored;
  live = streamed;
  render(<ThemeProvider theme={lightTheme}><LogViewer /></ThemeProvider>);
}

afterEach(cleanup);

describe('LogViewer', () => {
  it('shows lines of the same text and time as the lines they are, and a line that came both ways once', () => {
    show([entry(2, 'same'), entry(1, 'same')], [entry(3, 'new'), entry(2, 'same')]);
    expect(screen.getAllByText(/same/)).toHaveLength(2);
    expect(screen.getByText('3 entries')).toBeTruthy();
  });

  it('draws the newest lines only, and says so', () => {
    show(Array.from({ length: 1_200 }, (_, i) => entry(1_200 - i, `line ${String(1_200 - i)}.`)));
    expect(screen.getByText('1200 entries, the newest 1000 shown')).toBeTruthy();
    expect(screen.getAllByText(/line \d+\./)).toHaveLength(1_000);
    expect(screen.getByText(/line 201\./)).toBeTruthy();
    expect(screen.queryByText(/line 200\./)).toBeNull();
  });
});
