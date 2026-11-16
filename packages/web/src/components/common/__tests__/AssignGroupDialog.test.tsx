// ===========================================
// Assign Group Dialog Tests (#223)
// ===========================================
// The dialog shows every group the channel is in and changes its group with one
// server call, so a failure cannot leave it in no group or in some of its old ones.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';

// ----- Mocks -----

const setGroups = vi.fn();
const notify = vi.fn();
const GROUPS = [
  { id: 'g1', name: 'Lab' },
  { id: 'g2', name: 'Radiology' },
  { id: 'g3', name: 'Pharmacy' },
];
let memberships: Array<{ channelGroupId: string; channelId: string }> = [];

vi.mock('../../../hooks/use-channel-groups.js', () => ({
  useChannelGroups: () => ({ data: GROUPS, isLoading: false }),
  useGroupMemberships: () => ({ data: memberships, isLoading: false }),
  useSetChannelGroups: () => ({ mutateAsync: setGroups, isPending: false }),
}));
vi.mock('../../../stores/notification.store.js', () => ({
  useNotification: () => ({ notify }),
}));

import { AssignGroupDialog } from '../AssignGroupDialog.js';

const onClose = vi.fn();

function renderDialog(): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <AssignGroupDialog open onClose={onClose} channelId="ch-1" />
    </ThemeProvider>,
  );
}

function choose(groupName: string): void {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Group' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: groupName }));
}

function save(): HTMLElement {
  return screen.getByRole('button', { name: 'Save' });
}

beforeEach(() => {
  setGroups.mockReset();
  setGroups.mockResolvedValue(undefined);
  notify.mockClear();
  onClose.mockClear();
  memberships = [{ channelGroupId: 'g1', channelId: 'ch-1' }, { channelGroupId: 'g3', channelId: 'other' }];
});
afterEach(() => { cleanup(); });

describe('AssignGroupDialog', () => {
  it('names every group the channel is in, not just the first', () => {
    memberships = [{ channelGroupId: 'g1', channelId: 'ch-1' }, { channelGroupId: 'g2', channelId: 'ch-1' }];
    renderDialog();
    expect(screen.getByText('In 2 groups: Lab, Radiology. Saving keeps only the group you choose.')).toBeTruthy();
  });

  it('moves the channel with one call naming only the new group', async () => {
    renderDialog();
    choose('Radiology');
    fireEvent.click(save());

    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    expect(setGroups).toHaveBeenCalledTimes(1);
    expect(setGroups).toHaveBeenCalledWith({ channelId: 'ch-1', groupIds: ['g2'] });
    expect(notify).toHaveBeenCalledWith('Channel group updated', 'success');
  });

  it('takes the channel out of every group with one call when None is chosen', async () => {
    memberships = [{ channelGroupId: 'g1', channelId: 'ch-1' }, { channelGroupId: 'g2', channelId: 'ch-1' }];
    renderDialog();
    choose('None');
    fireEvent.click(save());

    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    expect(setGroups).toHaveBeenCalledTimes(1);
    expect(setGroups).toHaveBeenCalledWith({ channelId: 'ch-1', groupIds: [] });
  });

  it('lets a channel in two groups be cut down to the group already shown', async () => {
    memberships = [{ channelGroupId: 'g1', channelId: 'ch-1' }, { channelGroupId: 'g2', channelId: 'ch-1' }];
    renderDialog();
    expect(save()).toHaveProperty('disabled', false);
    fireEvent.click(save());

    await waitFor(() => { expect(setGroups).toHaveBeenCalledWith({ channelId: 'ch-1', groupIds: ['g1'] }); });
  });

  it('disables Save while the choice matches the channel\'s only group', () => {
    renderDialog();
    expect(save()).toHaveProperty('disabled', true);
  });

  it('reports a failed save and stays open', async () => {
    setGroups.mockRejectedValue(new Error('Channel group not found: g2'));
    renderDialog();
    choose('Radiology');
    fireEvent.click(save());

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Failed to update group: Channel group not found: g2', 'error');
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
