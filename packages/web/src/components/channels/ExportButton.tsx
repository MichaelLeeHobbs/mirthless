// ===========================================
// Channel Export Button
// ===========================================
// Button that triggers a channel export download.

import { useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import DownloadIcon from '@mui/icons-material/Download';
import { api } from '../../api/client.js';

interface ExportButtonProps {
  /** If provided, export single channel; otherwise export all. */
  readonly channelId?: string;
}

export function ExportButton({ channelId }: ExportButtonProps): ReactNode {
  const [loading, setLoading] = useState(false);

  const handleExport = async (): Promise<void> => {
    setLoading(true);
    try {
      const path = channelId
        ? `/channels/${channelId}/export`
        : '/channels/export';

      const response = await api.get<unknown>(path);
      if (!response.success) return;

      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = channelId ? `channel-${channelId}.json` : 'channels-export.json';
      anchor.click();
      URL.revokeObjectURL(url);
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
