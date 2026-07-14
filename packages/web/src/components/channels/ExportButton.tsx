// ===========================================
// Channel Export Button
// ===========================================
// Button that triggers a channel export download.

import { useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import DownloadIcon from '@mui/icons-material/Download';
import { downloadChannelExport } from '../../lib/channel-export.js';
import { useNotification } from '../../stores/notification.store.js';

interface ExportButtonProps {
  /** If provided, export single channel; otherwise export all. */
  readonly channelId?: string;
}

export function ExportButton({ channelId }: ExportButtonProps): ReactNode {
  const [loading, setLoading] = useState(false);
  const { notify } = useNotification();

  const handleExport = async (): Promise<void> => {
    setLoading(true);
    try {
      await downloadChannelExport(channelId);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Export failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outlined"
      startIcon={<DownloadIcon />}
      onClick={handleExport}
      disabled={loading}
    >
      {loading ? 'Exporting...' : 'Export'}
    </Button>
  );
}
