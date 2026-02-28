// ===========================================
// Channel Quick Actions Menu
// ===========================================
// Dropdown menu for deployment actions based on current channel state.

import { useState, type ReactNode } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { useDeploymentAction } from '../../hooks/use-deployment.js';

interface ChannelActionsProps {
  readonly channelId: string;
  readonly state: string | undefined;
}

interface ActionDef {
  readonly label: string;
  readonly action: 'deploy' | 'undeploy' | 'start' | 'stop' | 'halt' | 'pause' | 'resume';
  readonly icon: ReactNode;
}

function getActions(state: string | undefined): readonly ActionDef[] {
  if (state === undefined) {
    return [{ label: 'Deploy', action: 'deploy', icon: <CloudUploadIcon fontSize="small" /> }];
  }
  switch (state) {
    case 'STOPPED':
      return [
        { label: 'Start', action: 'start', icon: <PlayArrowIcon fontSize="small" /> },
        { label: 'Undeploy', action: 'undeploy', icon: <CloudOffIcon fontSize="small" /> },
      ];
    case 'STARTED':
      return [
        { label: 'Pause', action: 'pause', icon: <PauseIcon fontSize="small" /> },
        { label: 'Stop', action: 'stop', icon: <StopIcon fontSize="small" /> },
      ];
    case 'PAUSED':
      return [
        { label: 'Resume', action: 'resume', icon: <PlayArrowIcon fontSize="small" /> },
        { label: 'Stop', action: 'stop', icon: <StopIcon fontSize="small" /> },
      ];
    default:
      return [];
  }
}

export function ChannelActions({ channelId, state }: ChannelActionsProps): ReactNode {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const deployAction = useDeploymentAction();
  const actions = getActions(state);

  const handleClick = (event: React.MouseEvent<HTMLElement>): void => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = (): void => {
    setAnchorEl(null);
  };

  const handleAction = (action: ActionDef['action']): void => {
    handleClose();
    deployAction.mutate({ channelId, action });
  };

  if (actions.length === 0) return null;

  return (
    <>
      <IconButton size="small" onClick={handleClick} aria-label="Channel actions">
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {actions.map((a) => (
          <MenuItem key={a.action} onClick={() => handleAction(a.action)} disabled={deployAction.isPending}>
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
