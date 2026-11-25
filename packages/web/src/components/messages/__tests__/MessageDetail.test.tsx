// The script log's tab (#164).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { withScriptLogRun } from '@galvanigraph/core-models';
import { lightTheme } from '../../../styles/theme.js';

const idle = (): Record<string, unknown> => ({ mutate: vi.fn(), isPending: false });
let content: Readonly<Record<string, string>> = {};
vi.mock('../../../hooks/use-messages.js', () => ({
  useMessageDetail: () => ({
    data: {
      messageId: 7, receivedAt: '2026-11-25T10:00:00Z', processedAt: null, processed: true,
      connectors: [{ metaDataId: 0, connectorName: 'Source', status: 'TRANSFORMED', sendAttempts: 0, content }],
    },
    isLoading: false, error: null,
  }),
  useDeleteMessage: idle,
}));
vi.mock('../../../hooks/use-message-actions.js', () => ({ useResendDestination: idle }));
vi.mock('../../../hooks/use-permissions.js', () => ({ usePermissions: () => ({ has: () => true }) }));

const { MessageDetailPanel } = await import('../MessageDetail.js');

function open(stored: Readonly<Record<string, string>>): void {
  content = stored;
  render(<ThemeProvider theme={lightTheme}><MessageDetailPanel channelId="c1" messageId={7} channelDeleted={false} /></ThemeProvider>);
}

const LOG = withScriptLogRun(null, { script: 'Source filter', lines: [{ level: 'WARN', time: '2026-11-25T10:00:00.000Z', text: 'no MRN' }], leftOut: 2 });

afterEach(cleanup);

describe('the script log of a message', () => {
  it('has a tab after the contents, which shows its lines', () => {
    open({ raw: 'MSH|^~', scriptLog: LOG });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Raw', 'Script Log']);

    fireEvent.click(screen.getByRole('tab', { name: 'Script Log' }));

    expect(screen.getByLabelText('Log of Source filter').textContent).toContain('WARN  no MRN');
    expect(screen.getByText('2 more lines of this run are not kept')).toBeTruthy();
    expect(screen.queryByText(LOG)).toBeNull();
  });

  it('has none when the scripts logged nothing', () => {
    open({ raw: 'MSH|^~' });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Raw']);
  });
});
