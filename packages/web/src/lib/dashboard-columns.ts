// ===========================================
// Dashboard Column Model
// ===========================================
// Shared definition of the configurable dashboard columns. Name (+tags) and State
// are always shown; everything here is toggleable per-user. Order here is the
// render order (config columns, then the stat counters).

export type DashboardColumnId =
  | 'source' | 'dataTypes' | 'rev' | 'updated'
  | 'received' | 'filtered' | 'sent' | 'errored' | 'queued';

export interface DashboardColumnDef {
  readonly id: DashboardColumnId;
  readonly label: string;
  readonly align: 'left' | 'right';
  /** Numeric stat counter (aggregated in group totals). */
  readonly numeric: boolean;
  readonly defaultVisible: boolean;
}

export const DASHBOARD_COLUMNS: readonly DashboardColumnDef[] = [
  { id: 'source', label: 'Source', align: 'left', numeric: false, defaultVisible: false },
  { id: 'dataTypes', label: 'Data Types', align: 'left', numeric: false, defaultVisible: false },
  { id: 'rev', label: 'Rev', align: 'right', numeric: false, defaultVisible: false },
  { id: 'updated', label: 'Updated', align: 'left', numeric: false, defaultVisible: false },
  { id: 'received', label: 'Received', align: 'right', numeric: true, defaultVisible: true },
  { id: 'filtered', label: 'Filtered', align: 'right', numeric: true, defaultVisible: true },
  { id: 'sent', label: 'Sent', align: 'right', numeric: true, defaultVisible: true },
  { id: 'errored', label: 'Errored', align: 'right', numeric: true, defaultVisible: true },
  { id: 'queued', label: 'Queued', align: 'right', numeric: true, defaultVisible: true },
];

export const DEFAULT_VISIBLE_COLUMNS: readonly DashboardColumnId[] =
  DASHBOARD_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

const CONNECTOR_TYPE_LABELS: Readonly<Record<string, string>> = {
  TCP_MLLP: 'TCP/MLLP', HTTP: 'HTTP', FILE: 'File', DATABASE: 'Database',
  JAVASCRIPT: 'JavaScript', CHANNEL: 'Channel', DICOM: 'DICOM', EMAIL: 'Email',
  FHIR: 'FHIR', SFTP: 'SFTP', SMTP: 'SMTP',
};

export function connectorLabel(type: string): string {
  return CONNECTOR_TYPE_LABELS[type] ?? type;
}
