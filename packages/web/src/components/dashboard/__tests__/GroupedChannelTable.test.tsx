// ===========================================
// Grouped Channel Table: drag to regroup (#223)
// ===========================================
// The drag handle shows only to a user who may change groups, and a drop moves
// the channel with one server call so a failure cannot leave it in no group.
// jsdom has no layout for dnd-kit to measure, so the drop is delivered by
// calling the DndContext's onDragEnd with the event dnd-kit would send.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { ComponentProps, ReactNode } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { darkTheme } from '../../../styles/theme.js';

// ----- Mocks -----

const setGroups = vi.fn();
const notify = vi.fn();
let granted = new Set<string>(['channels:read', 'channels:write']);
let onDragEnd: ((e: DragEndEvent) => void) | undefined;

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>): ReactNode => {
      onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../hooks/use-channel-groups.js', () => ({
  useUpdateChannelGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteChannelGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useSetChannelGroups: () => ({ mutateAsync: setGroups, isPending: false }),
}));
vi.mock('../../../hooks/use-deployment.js', () => ({
  useDeploymentAction: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../hooks/use-channels.js', () => ({
  useToggleChannelEnabled: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => granted.has(p) }),
}));
vi.mock('../../../stores/notification.store.js', () => ({
  useNotification: () => ({ notify }),
}));

import { GroupedChannelTable } from '../GroupedChannelTable.js';

// ----- Fixtures -----

function stats(channelId: string, channelName: string): ComponentProps<typeof GroupedChannelTable>['statistics'][number] {
  return {
    channelId, channelName, enabled: true, sourceConnectorType: 'TCP_MLLP', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
    revision: 1, updatedAt: '2026-11-15T12:00:00.000Z', received: 0, filtered: 0, sent: 0, errored: 0, queued: 0,
  };
}

function group(id: string, name: string): ComponentProps<typeof GroupedChannelTable>['groups'][number] {
  return { id, name, description: null, revision: 1, memberCount: 1, createdAt: '', updatedAt: '' };
}

function renderTable(): void {
  const { rerender } = render(table(INITIAL_MEMBERSHIPS));
  rerenderWith = (memberships) => { rerender(table(memberships)); };
}

type Memberships = ComponentProps<typeof GroupedChannelTable>['memberships'];

const INITIAL_MEMBERSHIPS: Memberships = [{ channelGroupId: 'g1', channelId: 'c1' }, { channelGroupId: 'g2', channelId: 'c2' }];

/** Re-render with new server memberships, as the memberships query does after a refetch. */
let rerenderWith: (memberships: Memberships) => void = () => undefined;

function table(memberships: Memberships): ReactNode {
  return (
    <ThemeProvider theme={darkTheme}>
      <GroupedChannelTable
        statistics={[stats('c1', 'ADT In'), stats('c2', 'Orders Out')]}
        deploymentStatuses={[]}
        groups={[group('g1', 'Lab'), group('g2', 'Radiology')]}
        memberships={memberships}
      />
    </ThemeProvider>
  );
}

/** A promise the test settles by hand, to hold a move in flight. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve: () => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Deliver the drop dnd-kit would send when channel `channelId` from `fromGroupId` lands on `overId`. */
async function drop(channelId: string, fromGroupId: string, overId: string | null): Promise<void> {
  const event = {
    active: { id: channelId, data: { current: { fromGroupId } } },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent;
  await act(async () => { onDragEnd?.(event); });
}

/** The name of the group section row that lists `channelName`. */
function sectionOf(channelName: string): string | null {
  const rows = screen.getAllByRole('row');
  let section: string | null = null;
  for (const row of rows) {
    const heading = /^(.+) \(\d+\)$/.exec(row.querySelector('h6, .MuiTypography-subtitle2')?.textContent ?? '');
    if (heading) section = heading[1] ?? null;
    if (row.textContent?.includes(channelName) && !heading) return section;
  }
  return null;
}

beforeEach(() => {
  setGroups.mockReset();
  setGroups.mockResolvedValue(undefined);
  notify.mockClear();
  onDragEnd = undefined;
  granted = new Set(['channels:read', 'channels:write']);
});
afterEach(() => { cleanup(); });

describe('GroupedChannelTable drag handle', () => {
  it('shows a drag handle on each channel for a user with channels:write', () => {
    renderTable();
    expect(screen.getAllByRole('button', { name: 'Drag to change group' })).toHaveLength(2);
  });

  it('hides the drag handle without channels:write', () => {
    granted = new Set(['channels:read']);
    renderTable();
    expect(screen.queryByRole('button', { name: 'Drag to change group' })).toBeNull();
    // The channels are still listed in their groups.
    expect(screen.getByText('ADT In')).toBeTruthy();
  });
});

describe('GroupedChannelTable drop', () => {
  it('moves the channel with one call naming only the target group, showing it there while the call runs', async () => {
    setGroups.mockImplementation(() => new Promise<void>(() => undefined));
    renderTable();
    await drop('c1', 'g1', 'g2');

    expect(setGroups).toHaveBeenCalledTimes(1);
    expect(setGroups).toHaveBeenCalledWith({ channelId: 'c1', groupIds: ['g2'] });
    expect(sectionOf('ADT In')).toBe('Radiology');
  });

  it('takes the channel out of every group with one call when dropped on Ungrouped', async () => {
    renderTable();
    await drop('c1', 'g1', '__ungrouped__');

    expect(setGroups).toHaveBeenCalledTimes(1);
    expect(setGroups).toHaveBeenCalledWith({ channelId: 'c1', groupIds: [] });
  });

  it('does nothing when dropped back on its own group or outside any group', async () => {
    renderTable();
    await drop('c1', 'g1', 'g1');
    await drop('c1', 'g1', null);

    expect(setGroups).not.toHaveBeenCalled();
  });

  it('puts the row back in its old group and reports the error when the move fails', async () => {
    setGroups.mockRejectedValue(new Error('Channel group not found: g2'));
    renderTable();
    await drop('c1', 'g1', 'g2');

    await waitFor(() => { expect(notify).toHaveBeenCalledWith('Channel group not found: g2', 'error'); });
    expect(sectionOf('ADT In')).toBe('Lab');
  });

  it('follows the server after a move, so a later Change Group back to the old group shows', async () => {
    renderTable();
    await drop('c1', 'g1', 'g2');
    // The memberships refetch after the move...
    rerenderWith([{ channelGroupId: 'g2', channelId: 'c1' }, { channelGroupId: 'g2', channelId: 'c2' }]);
    expect(sectionOf('ADT In')).toBe('Radiology');
    // ...then the Change Group dialog puts it back in Lab.
    rerenderWith([{ channelGroupId: 'g1', channelId: 'c1' }, { channelGroupId: 'g2', channelId: 'c2' }]);

    expect(sectionOf('ADT In')).toBe('Lab');
  });

  it('keeps another channel\'s move in flight when one move fails', async () => {
    const first = deferred();
    setGroups.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => new Promise<void>(() => undefined));
    renderTable();
    await drop('c1', 'g1', 'g2');
    await drop('c2', 'g2', 'g1');

    await act(async () => { first.reject(new Error('boom')); await first.promise.catch(() => undefined); });

    await waitFor(() => { expect(sectionOf('ADT In')).toBe('Lab'); });
    expect(sectionOf('Orders Out')).toBe('Lab');
  });
});
