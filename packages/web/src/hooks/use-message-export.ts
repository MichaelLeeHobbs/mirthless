// ===========================================
// Message Export Hook
// ===========================================
// Downloads a channel's messages as CSV or JSON honoring the current filters.
// The export endpoint streams a file (not the JSON ApiResponse envelope), so we
// fetch the blob directly, attaching the Bearer token from the auth store, then
// trigger a browser download via an object URL.

import { useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store.js';
import { messageFilterParts, type MessageFilters } from '../lib/message-filter-query.js';
import { downloadFailure } from '../lib/audit-unavailable.js';
import { saveBlob } from '../lib/download.js';

export type ExportFormat = 'csv' | 'json';

/** Filter subset shared with the message list query. */
export type MessageExportFilters = MessageFilters;

const BASE_URL = '/api/v1';

/** Build the export query string from format, filters and reason. Exported for testing. */
export function buildExportQuery(format: ExportFormat, filters: MessageExportFilters, reason: string): string {
  return [`format=${format}`, ...messageFilterParts(filters), `reason=${encodeURIComponent(reason)}`].join('&');
}

interface ExportArgs {
  readonly channelId: string;
  readonly channelName: string;
  readonly format: ExportFormat;
  readonly filters: MessageExportFilters;
  /** Why the export is taken: required, recorded in the audit log and the file's header. */
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
