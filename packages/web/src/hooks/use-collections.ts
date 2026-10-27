// ===========================================
// Collection API Hooks
// ===========================================
// TanStack Query hooks for collection CRUD + record browsing.

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  CreateCollectionInput,
  UpdateCollectionInput,
  StoreRecordInput,
  UpdateRecordInput,
} from '@mirthless/core-models';
import { api } from '../api/client.js';
import type { RecordColumn } from '../lib/collections.js';

// ----- Types -----

export interface CollectionSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly indexedFields: readonly string[];
  readonly defaultTtlSeconds: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CollectionRecord {
  readonly id: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly payload: string | null;
  readonly expireAt: string | null;
  readonly createdAt: string;
}

export interface RecordPage {
  readonly items: readonly CollectionRecord[];
  readonly total: number;
}

/** What the records grid asks the server for. */
export interface RecordListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: RecordColumn;
  readonly order: 'asc' | 'desc';
  readonly q: string;
  /** Column to search; '' searches every field and the payload. */
  readonly in: RecordColumn | '';
}

// ----- Query Keys -----

const COL_KEYS = {
  all: ['collections'] as const,
  list: () => [...COL_KEYS.all, 'list'] as const,
  detail: (id: string) => [...COL_KEYS.all, 'detail', id] as const,
  records: (id: string) => [...COL_KEYS.all, 'records', id] as const,
  recordPage: (id: string, params: RecordListParams) => [...COL_KEYS.records(id), params] as const,
} as const;

// ----- Hooks -----

export function useCollections(enabled = true): ReturnType<typeof useQuery<readonly CollectionSummary[]>> {
  return useQuery({
    enabled,
    queryKey: COL_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly CollectionSummary[]>('/collections');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCollection(id: string): ReturnType<typeof useQuery<CollectionSummary>> {
  return useQuery({
    queryKey: COL_KEYS.detail(id),
    queryFn: async () => {
      const result = await api.get<CollectionSummary>(`/collections/${id}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id.length > 0,
  });
}

function recordQueryString(params: RecordListParams): string {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    sort: params.sort,
    order: params.order,
  });
  const q = params.q.trim();
  if (q !== '') search.set('q', q);
  if (q !== '' && params.in !== '') search.set('in', params.in);
  return search.toString();
}

/** One sorted, searched page of records. Keeps the last page on screen while the next loads. */
export function useCollectionRecords(id: string, params: RecordListParams): ReturnType<typeof useQuery<RecordPage>> {
  return useQuery({
    queryKey: COL_KEYS.recordPage(id, params),
    queryFn: async () => {
      const result = await api.get<RecordPage>(`/collections/${id}/records?${recordQueryString(params)}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useCreateRecord(collectionId: string): ReturnType<typeof useMutation<CollectionRecord, Error, StoreRecordInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoreRecordInput) => {
      const result = await api.post<CollectionRecord>(`/collections/${collectionId}/records`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.records(collectionId) });
    },
  });
}

export function useUpdateRecord(collectionId: string): ReturnType<typeof useMutation<CollectionRecord, Error, { recordId: string; input: UpdateRecordInput }>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, input }: { recordId: string; input: UpdateRecordInput }) => {
      const result = await api.put<CollectionRecord>(`/collections/${collectionId}/records/${recordId}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.records(collectionId) });
    },
  });
}

export function useDeleteRecord(collectionId: string): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const result = await api.delete<void>(`/collections/${collectionId}/records/${recordId}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.records(collectionId) });
    },
  });
}

export function useCreateCollection(): ReturnType<typeof useMutation<CollectionSummary, Error, CreateCollectionInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCollectionInput) => {
      const result = await api.post<CollectionSummary>('/collections', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.all });
    },
  });
}

export function useUpdateCollection(): ReturnType<typeof useMutation<CollectionSummary, Error, { id: string; input: UpdateCollectionInput }>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCollectionInput }) => {
      const result = await api.put<CollectionSummary>(`/collections/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.all });
    },
  });
}

export function useDeleteCollection(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/collections/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.all });
    },
  });
}
