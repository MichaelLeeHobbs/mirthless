import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { NeedsAttention, rankAttention } from '../NeedsAttention.js';
import type { ChannelStatisticsSummary } from '../../../hooks/use-statistics.js';
import type { ChannelStatus } from '../../../hooks/use-deployment.js';

function stat(channelId: string, channelName: string, errored: number): ChannelStatisticsSummary {
  return {
    channelId, channelName, enabled: true, sourceConnectorType: 'TCP_MLLP',
    inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', revision: 1, updatedAt: '2026-01-01T00:00:00Z',
    received: 100, filtered: 0, sent: 100 - errored, errored, queued: 0,
  } as ChannelStatisticsSummary;
}

const status = (channelId: string, state: string): ChannelStatus => ({ channelId, state }) as ChannelStatus;

afterEach(() => { cleanup(); });

describe('rankAttention', () => {
  it('lists errored channels worst first, then stopped ones, and skips healthy channels', () => {
    const items = rankAttention(
      [stat('a', 'Alpha', 9), stat('b', 'Bravo', 0), stat('c', 'Charlie', 32), stat('d', 'Delta', 0)],
      [status('a', 'STARTED'), status('b', 'STARTED'), status('c', 'STARTED'), status('d', 'STOPPED')],
    );
    expect(items.map((i) => i.channelId)).toEqual(['c', 'a', 'd']);
    expect(items[2]).toMatchObject({ stopped: true, errored: 0 });
  });

  it('returns nothing when no channel is stopped or erroring', () => {
    expect(rankAttention([stat('a', 'Alpha', 0)], [status('a', 'STARTED')])).toEqual([]);
  });
});

describe('NeedsAttention', () => {
  function renderStrip(stats: ChannelStatisticsSummary[], statuses: ChannelStatus[]): void {
    render(
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter><NeedsAttention statistics={stats} statuses={statuses} /></MemoryRouter>
      </ThemeProvider>,
    );
  }

  it("links an errored channel to that channel's failed messages", () => {
    renderStrip([stat('c', 'Charlie', 32)], [status('c', 'STARTED')]);
    expect(screen.getByText('32 errored')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'View failed messages' });
    expect(link.getAttribute('href')).toBe('/channels/c/messages?status=ERROR');
  });

  it('renders nothing when every channel is fine', () => {
    renderStrip([stat('a', 'Alpha', 0)], [status('a', 'STARTED')]);
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });
});
