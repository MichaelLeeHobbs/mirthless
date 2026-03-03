// ===========================================
// Certificate API Hooks
// ===========================================
// TanStack Query hooks for certificate CRUD.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateCertificateInput, UpdateCertificateInput, CertificateListQuery } from '@mirthless/core-models';
import { api } from '../api/client.js';

// ----- Types -----

export interface CertificateSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly fingerprint: string;
  readonly issuer: string;
  readonly subject: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CertificateDetail extends CertificateSummary {
  readonly certificatePem: string;
  readonly privateKeyPem: string | null;
}

// ----- Query Keys -----

const CERT_KEYS = {
  all: ['certificates'] as const,
  list: (query?: CertificateListQuery) => [...CERT_KEYS.all, 'list', query] as const,
  detail: (id: string) => [...CERT_KEYS.all, 'detail', id] as const,
} as const;

// ----- Helpers -----

function buildQueryString(query?: CertificateListQuery): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.search) params.set('search', query.search);
  if (query.expiringSoon) params.set('expiringSoon', 'true');
  const str = params.toString();
  return str.length > 0 ? `?${str}` : '';
}

// ----- Hooks -----

export function useCertificates(query?: CertificateListQuery): ReturnType<typeof useQuery<readonly CertificateSummary[]>> {
  return useQuery({
    queryKey: CERT_KEYS.list(query),
    queryFn: async () => {
      const qs = buildQueryString(query);
      const result = await api.get<readonly CertificateSummary[]>(`/certificates${qs}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCertificate(id: string): ReturnType<typeof useQuery<CertificateDetail>> {
  return useQuery({
    queryKey: CERT_KEYS.detail(id),
    queryFn: async () => {
      const result = await api.get<CertificateDetail>(`/certificates/${id}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id.length > 0,
  });
}

export function useCreateCertificate(): ReturnType<typeof useMutation<CertificateDetail, Error, CreateCertificateInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCertificateInput) => {
      const result = await api.post<CertificateDetail>('/certificates', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CERT_KEYS.all });
    },
  });
}

export function useUpdateCertificate(): ReturnType<typeof useMutation<CertificateDetail, Error, { id: string; input: UpdateCertificateInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCertificateInput }) => {
      const result = await api.put<CertificateDetail>(`/certificates/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CERT_KEYS.all });
    },
  });
}

export function useDeleteCertificate(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/certificates/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CERT_KEYS.all });
    },
  });
}
