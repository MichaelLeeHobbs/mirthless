// ===========================================
// Assign Group Dialog
// ===========================================
// Lets the user change which group a channel belongs to.

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
import { useChannelGroups, useGroupMemberships, useAddGroupMember, useRemoveGroupMember } from '../../hooks/use-channel-groups.js';
import { useNotification } from '../../stores/notification.store.js';

interface AssignGroupDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly channelId: string;
}

const NONE_VALUE = '__none__';

export function AssignGroupDialog({ open, onClose, channelId }: AssignGroupDialogProps): ReactNode {
  const groupsQuery = useChannelGroups();
  const membershipsQuery = useGroupMemberships();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();
  const { notify } = useNotification();
  const [selectedGroupId, setSelectedGroupId] = useState<string>(NONE_VALUE);
  const [saving, setSaving] = useState(false);

  const groups = groupsQuery.data ?? [];

  const channelMemberships = useMemo((): readonly { channelGroupId: string }[] => {
    return (membershipsQuery.data ?? []).filter((m) => m.channelId === channelId);
  }, [membershipsQuery.data, channelId]);

  const currentGroupId = useMemo((): string => {
    return channelMemberships[0]?.channelGroupId ?? NONE_VALUE;
  }, [channelMemberships]);

  // Sync selection when data loads or channelId changes
  useEffect(() => {
    setSelectedGroupId(currentGroupId);
  }, [currentGroupId]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (selectedGroupId === currentGroupId) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      // Remove from ALL current groups (handles multi-membership cleanup)
      for (const m of channelMemberships) {
        await removeMember.mutateAsync({ groupId: m.channelGroupId, channelId });
      }
      // Add to new group if not "None"
      if (selectedGroupId !== NONE_VALUE) {
        await addMember.mutateAsync({ groupId: selectedGroupId, channelId });
      }
      notify('Channel group updated', 'success');
      onClose();
    } catch (err) {
      notify(`Failed to update group: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedGroupId, currentGroupId, channelId, channelMemberships, removeMember, addMember, notify, onClose]);

  const isLoading = groupsQuery.isLoading || membershipsQuery.isLoading;

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
          disabled={saving || isLoading || selectedGroupId === currentGroupId}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
