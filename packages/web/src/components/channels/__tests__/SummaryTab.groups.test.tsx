// ===========================================
// Summary tab: Channel Group dropdown (#223)
// ===========================================
// Changing the group is one server call, so a failure cannot leave the channel
// in no group. Only a user with channels:write can change it.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import type { ChannelFormData } from '../../../pages/ChannelEditorPage.js';
import type { AdvancedFormValues } from '../AdvancedTab.js';

const setGroups = vi.fn();
const notify = vi.fn();
let permissions = new Set<string>();
let memberships: Array<{ channelGroupId: string; channelId: string }> = [];

vi.mock('../../../hooks/use-channel-groups.js', () => ({
  useChannelGroups: () => ({ data: [{ id: 'g1', name: 'Lab' }, { id: 'g2', name: 'Radiology' }], isLoading: false }),
  useGroupMemberships: () => ({ data: memberships, isLoading: false }),
  useSetChannelGroups: () => ({ mutateAsync: setGroups }),
}));
vi.mock('../../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => permissions.has(p) }),
}));
vi.mock('../../../stores/notification.store.js', () => ({
  useNotification: () => ({ notify }),
}));

import { SummaryTab } from '../SummaryTab.js';

const ADVANCED: AdvancedFormValues = {
  messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false, removeAttachmentsOnCompletion: false,
  pruningEnabled: false, pruningMaxAgeDays: null, pruningArchiveEnabled: false, scriptTimeoutSeconds: 30, metadataColumns: [],
};

function Harness(): ReactNode {
  const { control, formState } = useForm<ChannelFormData>();
  return (
    <SummaryTab
      control={control}
      errors={formState.errors}
      isEditMode
      channelId="ch-1"
      revision={1}
      advancedValues={ADVANCED}
      onAdvancedChange={vi.fn()}
    />
  );
}

function renderTab(): void {
  render(<ThemeProvider theme={darkTheme}><Harness /></ThemeProvider>);
}

function groupField(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Channel Group' });
}

function choose(groupName: string): void {
  fireEvent.mouseDown(groupField());
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: groupName }));
}

beforeEach(() => {
  setGroups.mockReset();
  setGroups.mockResolvedValue(undefined);
  notify.mockClear();
  permissions = new Set(['channels:read', 'channels:write']);
  memberships = [{ channelGroupId: 'g1', channelId: 'ch-1' }];
});
afterEach(() => { cleanup(); });

describe('SummaryTab channel group', () => {
  it('moves the channel with one call naming only the new group', async () => {
    renderTab();
    choose('Radiology');
    await waitFor(() => { expect(notify).toHaveBeenCalledWith('Channel group updated', 'success'); });
    expect(setGroups).toHaveBeenCalledTimes(1);
    expect(setGroups).toHaveBeenCalledWith({ channelId: 'ch-1', groupIds: ['g2'] });
  });

  it('takes the channel out of every group when None is chosen', async () => {
    renderTab();
    choose('None');
    await waitFor(() => { expect(setGroups).toHaveBeenCalledWith({ channelId: 'ch-1', groupIds: [] }); });
  });

  it('reports a failed change', async () => {
    setGroups.mockRejectedValue(new Error('Channel group not found: g2'));
    renderTab();
    choose('Radiology');
    await waitFor(() => { expect(notify).toHaveBeenCalledWith('Channel group not found: g2', 'error'); });
  });

  it('is read-only without channels:write', () => {
    permissions = new Set(['channels:read']);
    renderTab();
    expect(groupField().getAttribute('aria-disabled')).toBe('true');
  });

  it('names every group a channel in several belongs to', () => {
    memberships = [{ channelGroupId: 'g1', channelId: 'ch-1' }, { channelGroupId: 'g2', channelId: 'ch-1' }];
    renderTab();
    expect(screen.getByText('In 2 groups: Lab, Radiology. Saving keeps only the group you choose.')).toBeTruthy();
  });
});
