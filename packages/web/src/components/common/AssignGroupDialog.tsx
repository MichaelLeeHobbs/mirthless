// ===========================================
// Assign Group Dialog
// ===========================================
// Lets the user change which group a channel belongs to. A channel has one
// group in the UI (D-126); a channel the API put in several shows them all,
// and saving keeps only the chosen one. The change is one server call, so a
// failure leaves the channel's groups as they were (#223).

import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import { useChannelGroups, useGroupMemberships, useSetChannelGroups } from '../../hooks/use-channel-groups.js';
import { useNotification } from '../../stores/notification.store.js';
import { errorMessage } from '../../lib/error-message.js';
import { isSameGroupSet, multiGroupNote } from '../../lib/group-membership.js';

interface AssignGroupDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly channelId: string;
}

const NONE_VALUE = '__none__';

export function AssignGroupDialog({ open, onClose, channelId }: AssignGroupDialogProps): ReactNode {
  const groupsQuery = useChannelGroups();
  const membershipsQuery = useGroupMemberships();
  const setGroups = useSetChannelGroups();
  const { notify } = useNotification();
  const [selectedGroupId, setSelectedGroupId] = useState<string>(NONE_VALUE);
  const [saving, setSaving] = useState(false);

  const groups = groupsQuery.data ?? [];

  const currentGroupIds = useMemo((): readonly string[] => {
    return (membershipsQuery.data ?? []).filter((m) => m.channelId === channelId).map((m) => m.channelGroupId);
  }, [membershipsQuery.data, channelId]);

  const initialGroupId = currentGroupIds[0] ?? NONE_VALUE;

  // Sync selection when data loads or channelId changes
  useEffect(() => {
    setSelectedGroupId(initialGroupId);
  }, [initialGroupId]);

  const nextGroupIds = useMemo((): readonly string[] => (selectedGroupId === NONE_VALUE ? [] : [selectedGroupId]), [selectedGroupId]);
  const unchanged = isSameGroupSet(nextGroupIds, currentGroupIds);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      await setGroups.mutateAsync({ channelId, groupIds: nextGroupIds });
      notify('Channel group updated', 'success');
      onClose();
    } catch (err) {
      notify(`Failed to update group: ${errorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [nextGroupIds, channelId, setGroups, notify, onClose]);

  const isLoading = groupsQuery.isLoading || membershipsQuery.isLoading;
  const currentNames = currentGroupIds.map((id) => groups.find((g) => g.id === id)?.name ?? id);
  const helperText = multiGroupNote(currentNames);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Change Group</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <TextField
            select
            fullWidth
            label="Group"
            value={selectedGroupId}
            onChange={(e) => { setSelectedGroupId(e.target.value); }}
            helperText={helperText}
            sx={{ mt: 1 }}
          >
            <MenuItem value={NONE_VALUE}>None</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || isLoading || unchanged}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
