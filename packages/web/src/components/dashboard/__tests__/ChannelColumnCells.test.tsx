import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { ChannelBodyCells, type ChannelCellRow } from '../ChannelColumnCells.js';
import type { DashboardColumnId } from '../../../lib/dashboard-columns.js';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

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
