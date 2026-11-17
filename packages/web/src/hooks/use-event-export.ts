// ===========================================
// Event Export Hook
// ===========================================
// Triggers browser download of audit events as CSV or JSON.

import { useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store.js';
import { definedSearchParams } from '../lib/search-params.js';
import { downloadFailure } from '../lib/audit-unavailable.js';
import { saveBlob } from '../lib/download.js';

const BASE_URL = '/api/v1';

export interface EventExportParams {
  readonly format: 'csv' | 'json';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly level?: string;
  readonly name?: string;
  readonly outcome?: string;
  readonly maxRows?: number;
  /** Why the export is taken: required, recorded in the audit log and the file's header. */
  readonly reason: string;
}

interface EventExportState {
  readonly isExporting: boolean;
  readonly error: string | null;
  readonly exportEvents: (params: EventExportParams) => Promise<void>;
}

/** The export endpoint URL for the format and the filters that are set. Exported for testing. */
export function buildExportUrl(params: EventExportParams): string {
  const searchParams = definedSearchParams({
    format: params.format,
    startDate: params.startDate,
    endDate: params.endDate,
    level: params.level,
    name: params.name,
    outcome: params.outcome,
    maxRows: params.maxRows,
    reason: params.reason,
  });
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
        setError(await downloadFailure(response));
        return;
      }

      const contentDisposition = response.headers.get('Content-Disposition') ?? '';
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition);
      const filename = filenameMatch?.[1] ?? `events-export.${params.format}`;

      saveBlob(filename, await response.blob());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setError(message);
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { isExporting, error, exportEvents };
}
