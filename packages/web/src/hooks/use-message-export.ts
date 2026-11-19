// The export answers a file, not the ApiResponse envelope, so it is fetched directly.

import { useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store.js';
import { messageFilterParts, type MessageFilters } from '../lib/message-filter-query.js';
import { downloadFailure } from '../lib/audit-unavailable.js';
import { saveBlob } from '../lib/download.js';

export type ExportFormat = 'csv' | 'json';

export type MessageExportFilters = MessageFilters;

const BASE_URL = '/api/v1';

export function buildExportQuery(format: ExportFormat, filters: MessageExportFilters, reason: string): string {
  return [`format=${format}`, ...messageFilterParts(filters), `reason=${encodeURIComponent(reason)}`].join('&');
}

interface ExportArgs {
  readonly channelId: string;
  readonly channelName: string;
  readonly format: ExportFormat;
  readonly filters: MessageExportFilters;
  /** Recorded in the audit log and the file's header. */
  readonly reason: string;
}

interface UseMessageExportResult {
  readonly exportMessages: (args: ExportArgs) => Promise<void>;
  readonly isExporting: boolean;
  readonly error: string | null;
}

export function useMessageExport(): UseMessageExportResult {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportMessages = useCallback(async ({ channelId, channelName, format, filters, reason }: ExportArgs): Promise<void> => {
    setIsExporting(true);
    setError(null);
    try {
      const token = useAuthStore.getState().accessToken;
      const query = buildExportQuery(format, filters, reason);
      const response = await fetch(`${BASE_URL}/channels/${channelId}/messages/export?${query}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(await downloadFailure(response));
      }
      const blob = await response.blob();
      const safeName = channelName.replace(/[^a-z0-9_-]+/gi, '_') || 'channel';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      saveBlob(`${safeName}-messages-${stamp}.${format}`, blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      throw err;
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportMessages, isExporting, error };
}
