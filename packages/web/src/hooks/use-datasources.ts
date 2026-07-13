// ===========================================
// Data Source API Hooks
// ===========================================
// TanStack Query hooks for data source CRUD + connection test.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateDataSourceInput, UpdateDataSourceInput, TestDataSourceInput } from '@mirthless/core-models';
import { api } from '../api/client.js';

// ----- Types (never include the password) -----

export interface DataSourceSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly driver: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly readOnly: boolean;
  readonly maxConnections: number;
  readonly statementTimeoutMs: number;
  readonly maxRows: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TestConnectionResult {
  readonly connected: boolean;
  readonly error?: string;
}

// ----- Query Keys -----

const DS_KEYS = {
  all: ['datasources'] as const,
  list: () => [...DS_KEYS.all, 'list'] as const,
} as const;

// ----- Hooks -----

export function useDataSources(): ReturnType<typeof useQuery<readonly DataSourceSummary[]>> {
  return useQuery({
    queryKey: DS_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly DataSourceSummary[]>('/datasources');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCreateDataSource(): ReturnType<typeof useMutation<DataSourceSummary, Error, CreateDataSourceInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDataSourceInput) => {
      const result = await api.post<DataSourceSummary>('/datasources', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: DS_KEYS.all }); },
  });
}

export function useUpdateDataSource(): ReturnType<typeof useMutation<DataSourceSummary, Error, { id: string; input: UpdateDataSourceInput }>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateDataSourceInput }) => {
      const result = await api.put<DataSourceSummary>(`/datasources/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: DS_KEYS.all }); },
  });
}

export function useDeleteDataSource(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/datasources/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: DS_KEYS.all }); },
  });
}

export function useTestDataSource(): ReturnType<typeof useMutation<TestConnectionResult, Error, TestDataSourceInput>> {
  return useMutation({
    mutationFn: async (input: TestDataSourceInput) => {
      const result = await api.post<TestConnectionResult>('/datasources/test', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}
