// ===========================================
// Audit Log API Hooks
// ===========================================
// The protected audit log (GET /audit), readable with audit:read (D-312).

import { useQuery } from '@tanstack/react-query';
import { api, type AuditListResult } from '../api/client.js';
import { definedSearchParams } from '../lib/search-params.js';

export interface AuditListParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly action?: string;
  readonly outcome?: string;
}

/** The `?...` suffix for the audit list, or '' when nothing is set. Exported for testing. */
export function buildAuditQueryString(params: AuditListParams): string {
  const qs = definedSearchParams({ page: params.page, pageSize: params.pageSize, action: params.action, outcome: params.outcome }).toString();
  return qs ? `?${qs}` : '';
}

/** A page of audit rows. Pass `enabled: false` for a caller without audit:read. */
export function useAuditRecords(params: AuditListParams, enabled = true): ReturnType<typeof useQuery<AuditListResult>> {
  return useQuery({
    queryKey: ['audit', 'list', params],
    queryFn: async () => {
      const result = await api.get<AuditListResult>(`/audit${buildAuditQueryString(params)}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled,
  });
}
