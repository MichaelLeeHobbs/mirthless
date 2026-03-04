// ===========================================
// Channel Context Menu
// ===========================================
// Right-click context menu for channel rows on the dashboard.

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import EditIcon from '@mui/icons-material/Edit';
import MessageIcon from '@mui/icons-material/Message';
import BarChartIcon from '@mui/icons-material/BarChart';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import type { ContextMenuState } from '../../hooks/use-context-menu.js';
import { useDeploymentAction } from '../../hooks/use-deployment.js';

interface ChannelContextMenuProps {
  readonly menuState: ContextMenuState | null;
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly state: string | null;
  readonly onClose: () => void;
  readonly onClone?: ((channelId: string) => void) | undefined;
  readonly onDelete?: ((channelId: string) => void) | undefined;
  readonly onExport?: ((channelId: string) => void) | undefined;
  readonly onSendMessage?: ((channelId: string, channelName: string) => void) | undefined;
}

export function ChannelContextMenu({
  menuState,
  channelId,
  channelName,
  state,
  onClose,
  onClone,
  onDelete,
  onExport,
  onSendMessage,
}: ChannelContextMenuProps): ReactNode {
  const navigate = useNavigate();
  const deployAction = useDeploymentAction();

  if (!channelId) return null;

  const handleNav = (path: string): void => {
    onClose();
    navigate(path);
  };

  const handleDeploy = (action: 'deploy' | 'undeploy' | 'start' | 'stop' | 'pause' | 'resume'): void => {
    onClose();
    deployAction.mutate({ channelId, action });
  };

  return (
    <Menu
      open={menuState !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={menuState ? { top: menuState.mouseY, left: menuState.mouseX } : { top: 0, left: 0 }}
    >
      <MenuItem disabled sx={{ opacity: '1 !important' }}>
        <ListItemText primaryTypographyProps={{ variant: 'subtitle2', fontWeight: 600 }}>
          {channelName}
        </ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem onClick={() => handleNav(`/channels/${channelId}`)}>
        <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Edit</ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleNav(`/channels/${channelId}/messages`)}>
        <ListItemIcon><MessageIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Messages</ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleNav(`/channels/${channelId}/statistics`)}>
        <ListItemIcon><BarChartIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Statistics</ListItemText>
      </MenuItem>
      <Divider />
      {/* State-aware deployment actions */}
      {state === undefined || state === 'UNDEPLOYED' ? (
        <MenuItem onClick={() => handleDeploy('deploy')}>
          <ListItemIcon><CloudUploadIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Deploy</ListItemText>
        </MenuItem>
      ) : null}
      {state === 'STOPPED' ? (
        <>
          <MenuItem onClick={() => handleDeploy('start')}>
            <ListItemIcon><PlayArrowIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Start</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleDeploy('undeploy')}>
            <ListItemIcon><CloudOffIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Undeploy</ListItemText>
          </MenuItem>
        </>
      ) : null}
      {state === 'STARTED' ? (
        <>
          <MenuItem onClick={() => handleDeploy('pause')}>
            <ListItemIcon><PauseIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Pause</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleDeploy('stop')}>
            <ListItemIcon><StopIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Stop</ListItemText>
          </MenuItem>
        </>
      ) : null}
      {state === 'PAUSED' ? (
        <>
          <MenuItem onClick={() => handleDeploy('resume')}>
            <ListItemIcon><PlayArrowIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Resume</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleDeploy('stop')}>
            <ListItemIcon><StopIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Stop</ListItemText>
          </MenuItem>
        </>
      ) : null}
      {state === 'STARTED' && onSendMessage ? (
        <MenuItem onClick={() => { onClose(); onSendMessage(channelId, channelName ?? ''); }}>
          <ListItemIcon><SendIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Send Message</ListItemText>
        </MenuItem>
      ) : null}
      <Divider />
      {onClone ? (
        <MenuItem onClick={() => { onClose(); onClone(channelId); }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Clone</ListItemText>
        </MenuItem>
      ) : null}
      {onExport ? (
        <MenuItem onClick={() => { onClose(); onExport(channelId); }}>
          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Export</ListItemText>
        </MenuItem>
      ) : null}
      {onDelete ? (
        <MenuItem onClick={() => { onClose(); onDelete(channelId); }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ color: 'error' }}>Delete</ListItemText>
        </MenuItem>
      ) : null}
    </Menu>
  );
}
