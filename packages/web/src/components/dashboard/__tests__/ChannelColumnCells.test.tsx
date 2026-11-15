import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { ChannelBodyCells, formatUpdated, type ChannelCellRow } from '../ChannelColumnCells.js';
import type { DashboardColumnId } from '../../../lib/dashboard-columns.js';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

const row: ChannelCellRow = {
  channelId: 'ch-1', channelName: 'My Channel',
  sourceConnectorType: 'TCP_MLLP', inboundDataType: 'HL7V2', outboundDataType: 'JSON',
  revision: 8, updatedAt: new Date().toISOString(),
  received: 5, filtered: 1, sent: 10, errored: 2, queued: 0,
};

function renderCells(visible: DashboardColumnId[]): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <table><tbody><tr><ChannelBodyCells row={row} visible={new Set(visible)} /></tr></tbody></table>
    </ThemeProvider>,
  );
}

afterEach(() => { cleanup(); });

describe('ChannelBodyCells', () => {
  it('renders only the visible columns', () => {
    renderCells(['source', 'received']);
    expect(screen.getByText('TCP/MLLP')).toBeTruthy(); // source label
    expect(screen.getByText('5')).toBeTruthy();          // received
    expect(screen.queryByText('8')).toBeNull();          // rev hidden
  });

  it('renders config columns when enabled', () => {
    renderCells(['dataTypes', 'rev']);
    expect(screen.getByText(/HL7V2/)).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy(); // revision
  });

  it('renders the errored count as a link when > 0', () => {
    renderCells(['errored']);
    // Link with an accessible label pointing at the errored messages view.
    expect(screen.getByLabelText(/errored messages for My Channel/)).toBeTruthy();
  });
});

// ----- The "updated" column -----

const ORIGINAL_TZ = process.env['TZ'];
const NOW = '2026-06-15T14:05:09.000Z';
const OLD = '2026-01-02T12:00:00.000Z';
// The type says string, but a channel row from the wire can lack a time.
const missing = (v: null | undefined): string => v as unknown as string;

function inZone(zone: string): void {
  beforeEach(() => {
    process.env['TZ'] = zone;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ORIGINAL_TZ;
  });
}

function renderUpdated(updatedAt: string): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <table><tbody><tr><ChannelBodyCells row={{ ...row, updatedAt }} visible={new Set<DashboardColumnId>(['updated'])} /></tr></tbody></table>
    </ThemeProvider>,
  );
}

for (const zone of ['UTC', 'America/New_York']) {
  describe(`formatUpdated in ${zone}`, () => {
    inZone(zone);

    it('shows a relative age for a recent time', () => {
      expect(formatUpdated('2026-06-15T14:02:00.000Z')).toBe('3m ago');
      expect(formatUpdated('2026-06-15T11:05:09.000Z')).toBe('3h ago');
      expect(formatUpdated('2026-06-10T14:05:09.000Z')).toBe('5d ago');
      expect(formatUpdated(NOW)).toBe('just now');
    });

    it('shows the local date for a time 30 or more days old', () => {
      expect(formatUpdated(OLD)).toBe(new Date(OLD).toLocaleDateString());
    });

    it('shows a dash for null, undefined or an empty string, never the epoch date', () => {
      for (const value of [null, undefined, '']) {
        expect(formatUpdated(value)).toBe('—');
      }
    });

    it('shows an unparseable value as it came, not a blank cell', () => {
      expect(formatUpdated('not-a-date')).toBe('not-a-date');
    });

    it('puts the full local date and time in the tooltip', () => {
      renderUpdated(OLD);
      expect(screen.getByLabelText(new Date(OLD).toLocaleString())).toBeTruthy();
    });

    it('puts a dash in the tooltip and the cell for null, not the epoch', () => {
      renderUpdated(missing(null));
      expect(screen.getByLabelText('—').textContent).toBe('—');
      expect(screen.queryByText(/1969|1970/)).toBeNull();
    });
  });
}
