// ===========================================
// Summary tab: Channel Group dropdown (#223)
// ===========================================
// Changing the group is one server call, so a failure cannot leave the channel
// in no group.

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

vi.mock('../../../hooks/use-channel-groups.js', () => ({
  useChannelGroups: () => ({ data: [{ id: 'g1', name: 'Lab' }, { id: 'g2', name: 'Radiology' }], isLoading: false }),
  useGroupMemberships: () => ({ data: [{ channelGroupId: 'g1', channelId: 'ch-1' }], isLoading: false }),
  useSetChannelGroups: () => ({ mutateAsync: setGroups }),
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

function choose(groupName: string): void {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Channel Group' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: groupName }));
}

beforeEach(() => {
  setGroups.mockReset();
  setGroups.mockResolvedValue(undefined);
  notify.mockClear();
  render(<ThemeProvider theme={darkTheme}><Harness /></ThemeProvider>);
});
afterEach(() => { cleanup(); });

describe('SummaryTab channel group', () => {
  it('moves the channel with one call naming only the new group', async () => {
    choose('Radiology');
    await waitFor(() => { expect(notify).toHaveBeenCalledWith('Channel group updated', 'success'); });
    expect(setGroups).toHaveBeenCalledTimes(1);
    expect(setGroups).toHaveBeenCalledWith({ channelId: 'ch-1', groupIds: ['g2'] });
  });

  it('takes the channel out of every group when None is chosen', async () => {
    choose('None');
    await waitFor(() => { expect(setGroups).toHaveBeenCalledWith({ channelId: 'ch-1', groupIds: [] }); });
  });

  it('reports a failed change', async () => {
    setGroups.mockRejectedValue(new Error('Channel group not found: g2'));
    choose('Radiology');
    await waitFor(() => { expect(notify).toHaveBeenCalledWith('Channel group not found: g2', 'error'); });
  });
});
