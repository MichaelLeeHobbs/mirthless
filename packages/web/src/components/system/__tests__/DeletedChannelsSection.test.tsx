// All messages of a deleted channel, removed at an administrator's word (#202).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { formatTimestamp } from '../../../lib/format.js';
import type { DeletedChannel } from '../../../hooks/use-deleted-channels.js';

type Options = { readonly onSuccess: (done: { readonly messages: number; readonly undelivered: number }) => void };
const purge = vi.hoisted(() => ({ mutate: vi.fn<(input: unknown, options: unknown) => void>() }));
const list = vi.hoisted(() => ({ state: {} as Record<string, unknown>, refetch: vi.fn() }));
const notify = vi.hoisted(() => vi.fn());
let granted: readonly string[];

vi.mock('../../../hooks/use-deleted-channels.js', () => ({
  useDeletedChannels: () => ({ isLoading: false, error: null, refetch: list.refetch, ...list.state }),
  usePurgeDeletedChannel: () => ({ mutate: purge.mutate, isPending: false }),
}));
vi.mock('../../../hooks/use-permissions.js', () => ({ usePermissions: () => ({ has: (p: string) => granted.includes(p) }) }));
vi.mock('../../../stores/notification.store.js', () => ({ useNotification: () => ({ notify }) }));

const { DeletedChannelsSection } = await import('../DeletedChannelsSection.js');

const OLD: DeletedChannel = {
  channelId: '11111111-2222-4333-8444-555555555555', name: 'ADT Old', deletedAt: '2026-11-20T08:00:00.000Z',
  messages: 1200, undelivered: 3, firstReceivedAt: '2026-01-02T03:04:05.000Z', lastReceivedAt: '2026-11-19T23:00:00.000Z', prunedAfterDays: 30,
};
const REST: DeletedChannel = {
  ...OLD, channelId: 'aaaaaaaa-2222-4333-8444-555555555555', name: 'Lab Old', messages: 0, undelivered: 0, firstReceivedAt: null, lastReceivedAt: null, prunedAfterDays: null,
};

function show(state: Record<string, unknown> = { data: [OLD, REST] }): void {
  list.state = state;
  render(<ThemeProvider theme={lightTheme}><DeletedChannelsSection /></ThemeProvider>);
}

const row = (name: string): HTMLElement => screen.getByText(name).closest('tr')!;
const open = (name: string): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name: `Delete the messages of ${name}` }));
  return screen.getByRole('dialog');
};
const confirm = (): HTMLElement => within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete messages' });

beforeEach(() => { granted = ['settings:write']; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the deleted channels', () => {
  it('are listed with their id, how many messages there are, from when to when, and whether they are pruned', () => {
    show();
    const shown = row('ADT Old').textContent ?? '';
    for (const text of ['11111111', formatTimestamp(OLD.deletedAt), '1200', '3 not delivered', formatTimestamp(OLD.firstReceivedAt), formatTimestamp(OLD.lastReceivedAt), 'After 30 days']) expect(shown).toContain(text);
    expect(row('Lab Old').textContent).toContain('Not pruned');
    expect(row('Lab Old').textContent).not.toContain('not delivered');
  });

  it('say so when there are none, or when they could not be read', () => {
    show({ data: [] });
    expect(screen.getByText('No deleted channel has messages')).toBeTruthy();
    cleanup();
    show({ error: new Error('connection terminated') });
    expect(screen.getByText('connection terminated')).toBeTruthy();
    expect(screen.queryByText('No deleted channel has messages')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(list.refetch).toHaveBeenCalledOnce();
  });

  it('offer no removal without the permission', () => {
    granted = ['settings:read'];
    show();
    expect(screen.getByRole('button', { name: 'Delete the messages of ADT Old' })).toHaveProperty('disabled', true);
  });
});

describe('the removal', () => {
  it('says what goes, what does not, and that it cannot be undone', () => {
    show();
    const text = open('ADT Old').textContent ?? '';
    for (const part of ['1200 messages', '"ADT Old" (11111111)', '3 of them were never delivered.', 'cannot be undone', 'Files on disk', 'backups are not touched']) expect(text).toContain(part);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(purge.mutate).not.toHaveBeenCalled();
  });

  it('says that rows are left of messages that are gone', () => {
    show();
    const text = open('Lab Old').textContent ?? '';
    expect(text).toContain('what is left of deleted messages');
    expect(text).not.toContain('delivered');
  });

  it('counts one message as one', () => {
    show({ data: [{ ...OLD, messages: 1, undelivered: 1 }] });
    const text = open('ADT Old').textContent ?? '';
    expect(text).toContain('This removes 1 message of');
    expect(text).toContain('1 of them was never delivered.');
  });

  it('needs a reason and the name of the channel, and is of the channel that was clicked', () => {
    show();
    open('ADT Old');
    expect(confirm()).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'the feed has moved' } });
    expect(confirm()).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Type ADT Old to confirm'), { target: { value: 'adt old' } });
    expect(confirm()).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Type ADT Old to confirm'), { target: { value: 'ADT Old' } });

    fireEvent.click(confirm());

    expect(purge.mutate).toHaveBeenCalledExactlyOnceWith({ channelId: OLD.channelId, reason: 'the feed has moved' }, expect.anything());
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('closes the dialog and says how many went once they have', async () => {
    show();
    open('ADT Old');
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'the feed has moved' } });
    fireEvent.change(screen.getByLabelText('Type ADT Old to confirm'), { target: { value: 'ADT Old' } });
    purge.mutate.mockImplementation((_input, options) => { (options as Options).onSuccess({ messages: 1, undelivered: 0 }); });

    fireEvent.click(confirm());

    expect(notify).toHaveBeenCalledExactlyOnceWith('Deleted 1 message of ADT Old', 'success');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
