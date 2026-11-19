export interface MessageFilters {
  readonly status?: readonly string[];
  readonly receivedFrom?: string;
  readonly receivedTo?: string;
  readonly metaDataId?: number;
  readonly messageId?: number;
  readonly contentSearch?: string;
}

/** Empty strings are left out; a zero id is kept. */
export function messageFilterParts(filters: MessageFilters): string[] {
  const parts: string[] = [];
  for (const s of filters.status ?? []) parts.push(`status=${encodeURIComponent(s)}`);
  if (filters.receivedFrom) parts.push(`receivedFrom=${encodeURIComponent(filters.receivedFrom)}`);
  if (filters.receivedTo) parts.push(`receivedTo=${encodeURIComponent(filters.receivedTo)}`);
  if (filters.metaDataId !== undefined) parts.push(`metaDataId=${String(filters.metaDataId)}`);
  if (filters.messageId !== undefined) parts.push(`messageId=${String(filters.messageId)}`);
  if (filters.contentSearch) parts.push(`contentSearch=${encodeURIComponent(filters.contentSearch)}`);
  return parts;
}
