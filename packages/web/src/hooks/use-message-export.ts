// ===========================================
// Message Export Hook
// ===========================================
// Downloads a channel's messages as CSV or JSON honoring the current filters.
// The export endpoint streams a file (not the JSON ApiResponse envelope), so we
// fetch the blob directly, attaching the Bearer token from the auth store, then
// trigger a browser download via an object URL.

import { useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store.js';

export type ExportFormat = 'csv' | 'json';

/** Filter subset shared with the message list query. */
export interface MessageExportFilters {
  readonly status?: readonly string[];
  readonly receivedFrom?: string;
  readonly receivedTo?: string;
  readonly metaDataId?: number;
  readonly messageId?: number;
  readonly contentSearch?: string;
}

const BASE_URL = '/api/v1';

/** Build the export query string from format + filters. Exported for testing. */
export function buildExportQuery(format: ExportFormat, filters: MessageExportFilters): string {
  const parts: string[] = [`format=${format}`];
  if (filters.status && filters.status.length > 0) {
    for (const s of filters.status) parts.push(`status=${encodeURIComponent(s)}`);
  }
  if (filters.receivedFrom) parts.push(`receivedFrom=${encodeURIComponent(filters.receivedFrom)}`);
  if (filters.receivedTo) parts.push(`receivedTo=${encodeURIComponent(filters.receivedTo)}`);
  if (filters.metaDataId !== undefined) parts.push(`metaDataId=${String(filters.metaDataId)}`);
  if (filters.messageId !== undefined) parts.push(`messageId=${String(filters.messageId)}`);
  if (filters.contentSearch) parts.push(`contentSearch=${encodeURIComponent(filters.contentSearch)}`);
  return parts.join('&');
}

interface ExportArgs {
  readonly channelId: string;
  readonly channelName: string;
  readonly format: ExportFormat;
  readonly filters: MessageExportFilters;
}

interface UseMessageExportResult {
  readonly exportMessages: (args: ExportArgs) => Promise<void>;
  readonly isExporting: boolean;
  readonly error: string | null;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function useMessageExport(): UseMessageExportResult {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportMessages = useCallback(async ({ channelId, channelName, format, filters }: ExportArgs): Promise<void> => {
    setIsExporting(true);
    setError(null);
    try {
      const token = useAuthStore.getState().accessToken;
      const query = buildExportQuery(format, filters);
      const response = await fetch(`${BASE_URL}/channels/${channelId}/messages/export?${query}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(`Export failed with status ${String(response.status)}`);
      }
      const blob = await response.blob();
      const safeName = channelName.replace(/[^a-z0-9_-]+/gi, '_') || 'channel';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      triggerDownload(blob, `${safeName}-messages-${stamp}.${format}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      throw err;
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportMessages, isExporting, error };
}
