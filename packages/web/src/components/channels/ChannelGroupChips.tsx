// ===========================================
// Channel Group Chips
// ===========================================
// Displays group memberships for a channel with add/remove controls.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import AddIcon from '@mui/icons-material/Add';
import {
  useChannelGroups,
  useGroupMemberships,
  useAddGroupMember,
  useRemoveGroupMember,
} from '../../hooks/use-channel-groups.js';
import { useNotification } from '../../stores/notification.store.js';

interface ChannelGroupChipsProps {
  readonly channelId: string;
}

export function ChannelGroupChips({ channelId }: ChannelGroupChipsProps): ReactNode {
  const { data: groups } = useChannelGroups();
  const { data: memberships } = useGroupMemberships();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();
  const { notify } = useNotification();

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // Find groups this channel belongs to
  const memberGroupIds = new Set(
    (memberships ?? [])
      .filter((m) => m.channelId === channelId)
      .map((m) => m.channelGroupId),
  );

  const memberGroups = (groups ?? []).filter((g) => memberGroupIds.has(g.id));
  const availableGroups = (groups ?? []).filter((g) => !memberGroupIds.has(g.id));

  const handleRemove = (groupId: string): void => {
    removeMember.mutate(
      { groupId, channelId },
      {
        onSuccess: () => { notify('Removed from group', 'success'); },
        onError: (err) => { notify(err.message, 'error'); },
      },
    );
  };

  const handleAdd = (groupId: string): void => {
    setAnchorEl(null);
    addMember.mutate(
      { groupId, channelId },
      {
        onSuccess: () => { notify('Added to group', 'success'); },
        onError: (err) => { notify(err.message, 'error'); },
      },
    );
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Groups
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {memberGroups.map((g) => (
          <Chip
            key={g.id}
            label={g.name}
            onDelete={() => { handleRemove(g.id); }}
            size="small"
          />
        ))}
        {memberGroups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Not assigned to any groups
          </Typography>
        ) : null}
        {availableGroups.length > 0 ? (
          <>
            <Tooltip title="Add to group">
              <IconButton
                size="small"
                onClick={(e) => { setAnchorEl(e.currentTarget); }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={anchorEl}
              open={anchorEl !== null}
              onClose={() => { setAnchorEl(null); }}
            >
              {availableGroups.map((g) => (
                <MenuItem key={g.id} onClick={() => { handleAdd(g.id); }}>
                  {g.name}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : null}
      </Box>
    </Box>
  );
}
