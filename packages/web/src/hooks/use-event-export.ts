// ===========================================
// Event Export Hook
// ===========================================
// Triggers browser download of audit events as CSV or JSON.

import { useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store.js';

const BASE_URL = '/api/v1';

export interface EventExportParams {
  readonly format: 'csv' | 'json';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly level?: string;
  readonly name?: string;
  readonly outcome?: string;
  readonly maxRows?: number;
}

interface EventExportState {
  readonly isExporting: boolean;
  readonly error: string | null;
  readonly exportEvents: (params: EventExportParams) => Promise<void>;
}

function buildExportUrl(params: EventExportParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('format', params.format);
  if (params.startDate !== undefined && params.startDate !== '') searchParams.set('startDate', params.startDate);
  if (params.endDate !== undefined && params.endDate !== '') searchParams.set('endDate', params.endDate);
  if (params.level !== undefined && params.level !== '') searchParams.set('level', params.level);
  if (params.name !== undefined && params.name !== '') searchParams.set('name', params.name);
  if (params.outcome !== undefined && params.outcome !== '') searchParams.set('outcome', params.outcome);
  if (params.maxRows !== undefined) searchParams.set('maxRows', String(params.maxRows));
  return `${BASE_URL}/events/export?${searchParams.toString()}`;
}

export function useEventExport(): EventExportState {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportEvents = useCallback(async (params: EventExportParams): Promise<void> => {
    setIsExporting(true);
    setError(null);

    try {
      const token = useAuthStore.getState().accessToken;
      const url = buildExportUrl(params);

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        setError(`Export failed with status ${String(response.status)}`);
        return;
      }

      const contentDisposition = response.headers.get('Content-Disposition') ?? '';
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition);
      const filename = filenameMatch?.[1] ?? `events-export.${params.format}`;

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setError(message);
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { isExporting, error, exportEvents };
}
