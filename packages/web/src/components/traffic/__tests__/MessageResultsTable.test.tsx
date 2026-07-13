import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { MessageResultsTable } from '../MessageResultsTable.js';
import type { CrossChannelSearchItem } from '../../../hooks/use-cross-channel-search.js';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const items: CrossChannelSearchItem[] = [
  { messageId: 42, channelId: 'ch-1', channelName: 'Lab Feed', receivedAt: new Date().toISOString(), processed: true, status: 'ERROR', connectorName: 'File Writer' },
];

function renderTable(props: Partial<Parameters<typeof MessageResultsTable>[0]> = {}): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <MessageResultsTable
        items={items}
        total={1}
        limit={25}
        offset={0}
        isLoading={false}
        emptyTitle="Nothing here"
        emptyDescription="empty"
        onPageChange={vi.fn()}
        onRowsPerPageChange={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

afterEach(() => { cleanup(); });

describe('MessageResultsTable', () => {
  it('renders message rows with channel + connector', () => {
    renderTable();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Lab Feed')).toBeTruthy();
    expect(screen.getByText('File Writer')).toBeTruthy();
  });

  it('shows a Reprocess action only when onReprocess is provided', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: /reprocess/i })).toBeNull();
    cleanup();
    const onReprocess = vi.fn();
    renderTable({ onReprocess });
    fireEvent.click(screen.getByRole('button', { name: /reprocess/i }));
    expect(onReprocess).toHaveBeenCalledWith('ch-1', 42);
  });

  it('renders the empty state when there are no items', () => {
    renderTable({ items: [], total: 0 });
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});
