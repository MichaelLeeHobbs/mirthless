// ===========================================
// Bulk Actions Toolbar
// ===========================================
// Floating toolbar for bulk channel operations.

import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import { useDeploymentAction } from '../../hooks/use-deployment.js';

interface BulkActionsToolbarProps {
  readonly selectedIds: ReadonlySet<string>;
  readonly onClear: () => void;
}

export function BulkActionsToolbar({ selectedIds, onClear }: BulkActionsToolbarProps): ReactNode {
  const deployAction = useDeploymentAction();
  const count = selectedIds.size;

  if (count === 0) return null;

  const handleBulk = (action: 'deploy' | 'undeploy' | 'start' | 'stop'): void => {
    for (const channelId of selectedIds) {
      deployAction.mutate({ channelId, action });
    }
  };

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1200,
        px: 2,
        py: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        borderRadius: 2,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>
        {count} selected
      </Typography>
      <Button size="small" startIcon={<CloudUploadIcon />} onClick={() => handleBulk('deploy')} disabled={deployAction.isPending}>
        Deploy
      </Button>
      <Button size="small" startIcon={<PlayArrowIcon />} color="success" onClick={() => handleBulk('start')} disabled={deployAction.isPending}>
        Start
      </Button>
      <Button size="small" startIcon={<StopIcon />} color="error" onClick={() => handleBulk('stop')} disabled={deployAction.isPending}>
        Stop
      </Button>
      <Button size="small" startIcon={<CloudOffIcon />} onClick={() => handleBulk('undeploy')} disabled={deployAction.isPending}>
        Undeploy
      </Button>
      <IconButton size="small" onClick={onClear} aria-label="clear selection">
        <CloseIcon fontSize="small" />
      </IconButton>
    </Paper>
  );
}
