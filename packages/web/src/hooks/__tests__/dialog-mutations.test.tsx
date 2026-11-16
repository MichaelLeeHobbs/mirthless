// ===========================================
// Dialog mutations finish with the write, not the list reload (#241)
// ===========================================
// The Certificates, Data Sources and Global Map dialogs close in the
// mutation's onSuccess and disable their buttons while it is pending. A
// mutation that awaited the list's refetch held the dialog open, its button
// disabled, for as long as that GET took: on a busy server, past the e2e
// waits. Each mutation must resolve once its own request succeeds, and still
// mark the list stale so it reloads.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useCertificates, useCreateCertificate, useUpdateCertificate, useDeleteCertificate } from '../use-certificates.js';
import { useDataSources, useCreateDataSource, useUpdateDataSource, useDeleteDataSource } from '../use-datasources.js';
import { useGlobalMap, useUpsertGlobalMapEntry, useDeleteGlobalMapEntry, useClearGlobalMap } from '../use-global-map.js';

const getMock = vi.fn();
const writeMock = vi.fn();

vi.mock('../../api/client.js', () => ({
  api: {
    get: (path: string) => getMock(path),
    post: (path: string, body: unknown) => writeMock('POST', path, body),
    put: (path: string, body: unknown) => writeMock('PUT', path, body),
    delete: (path: string) => writeMock('DELETE', path),
  },
  apiFetch: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

/** The first list load answers; every reload after it never does, like a stalled server. */
function stallListReloads(): void {
  getMock.mockResolvedValueOnce({ success: true, data: [] });
  getMock.mockReturnValue(new Promise(() => { /* never settles */ }));
}

beforeEach(() => {
  getMock.mockReset();
  writeMock.mockReset();
  writeMock.mockResolvedValue({ success: true, data: {} });
});

describe('dialog mutations resolve when their request does, while the list reload is still pending', () => {
  it('creating a certificate', async () => {
    stallListReloads();
    const { result } = renderHook(() => ({ list: useCertificates(), create: useCreateCertificate() }), { wrapper });
    await waitFor(() => { expect(result.current.list.isSuccess).toBe(true); });

    await result.current.create.mutateAsync({ name: 'c', type: 'CA', certificatePem: 'pem' } as never);

    expect(writeMock).toHaveBeenCalledWith('POST', '/certificates', expect.anything());
    await waitFor(() => { expect(result.current.list.isFetching).toBe(true); });
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('updating and deleting a certificate', async () => {
    stallListReloads();
    const { result } = renderHook(
      () => ({ list: useCertificates(), update: useUpdateCertificate(), remove: useDeleteCertificate() }),
      { wrapper },
    );
    await waitFor(() => { expect(result.current.list.isSuccess).toBe(true); });

    await result.current.update.mutateAsync({ id: 'id-1', input: { name: 'c2' } } as never);
    await result.current.remove.mutateAsync('id-1');

    expect(writeMock).toHaveBeenCalledWith('PUT', '/certificates/id-1', { name: 'c2' });
    expect(writeMock).toHaveBeenCalledWith('DELETE', '/certificates/id-1');
    await waitFor(() => { expect(result.current.list.isFetching).toBe(true); });
  });

  it('creating, updating and deleting a data source', async () => {
    stallListReloads();
    const { result } = renderHook(
      () => ({
        list: useDataSources(), create: useCreateDataSource(), update: useUpdateDataSource(), remove: useDeleteDataSource(),
      }),
      { wrapper },
    );
    await waitFor(() => { expect(result.current.list.isSuccess).toBe(true); });

    await result.current.create.mutateAsync({ name: 'd' } as never);
    await result.current.update.mutateAsync({ id: 'id-1', input: { name: 'd2' } } as never);
    await result.current.remove.mutateAsync('id-1');

    expect(writeMock).toHaveBeenCalledWith('PUT', '/datasources/id-1', { name: 'd2' });
    expect(writeMock).toHaveBeenCalledWith('DELETE', '/datasources/id-1');
    await waitFor(() => { expect(result.current.list.isFetching).toBe(true); });
  });

  it('saving, deleting and clearing global map entries', async () => {
    stallListReloads();
    const { result } = renderHook(
      () => ({
        list: useGlobalMap(), upsert: useUpsertGlobalMapEntry(), remove: useDeleteGlobalMapEntry(), clear: useClearGlobalMap(),
      }),
      { wrapper },
    );
    await waitFor(() => { expect(result.current.list.isSuccess).toBe(true); });

    await result.current.upsert.mutateAsync({ key: 'k', value: 'v' });
    await result.current.remove.mutateAsync('k');
    await result.current.clear.mutateAsync();

    expect(writeMock).toHaveBeenCalledWith('PUT', '/global-map/k', { value: 'v' });
    expect(writeMock).toHaveBeenCalledWith('DELETE', '/global-map/k');
    expect(writeMock).toHaveBeenCalledWith('DELETE', '/global-map');
    await waitFor(() => { expect(result.current.list.isFetching).toBe(true); });
  });
});
