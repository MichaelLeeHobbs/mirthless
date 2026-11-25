import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useApiKeys } from '../use-api-keys.js';
import { useSetAssignments } from '../use-assignments.js';
import { useUpdateRole } from '../use-roles.js';
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers } from '../use-users.js';

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

const keyReads = (): number => getMock.mock.calls.filter(([path]) => path === '/api-keys').length;

beforeEach(() => {
  getMock.mockReset();
  writeMock.mockReset();
  getMock.mockResolvedValue({ success: true, data: [] });
});

describe('a user change that is refused', () => {
  it('reads the users again, since another admin may have disabled the account', async () => {
    const reads = (): number => getMock.mock.calls.filter(([path]) => path === '/users').length;
    writeMock.mockResolvedValue({ success: false, error: { code: 'CONFLICT', message: 'Enable the account first.' } });
    const { result } = renderHook(() => ({ users: useUsers(), update: useUpdateUser() }), { wrapper });
    await waitFor(() => { expect(result.current.users.isSuccess).toBe(true); });
    expect(reads()).toBe(1);

    await expect(result.current.update.mutateAsync({ id: 'u1', input: { email: 'a@example.test' } })).rejects.toThrow('Enable the account first.');

    await waitFor(() => { expect(reads()).toBe(2); });
  });
});

describe('access changes and the API key list', () => {
  it('reloads API keys after a user is deleted, since their keys were disabled or taken over', async () => {
    writeMock.mockResolvedValue({ success: true, data: { takenOver: [] } });
    const { result } = renderHook(() => ({ keys: useApiKeys(), remove: useDeleteUser() }), { wrapper });
    await waitFor(() => { expect(result.current.keys.isSuccess).toBe(true); });
    expect(keyReads()).toBe(1);

    await result.current.remove.mutateAsync({ id: 'u1' });

    await waitFor(() => { expect(keyReads()).toBe(2); });
  });

  it.each([
    ['a user is updated', () => {
      const { mutateAsync } = useUpdateUser();
      return () => mutateAsync({ id: 'u1', input: { enabled: false } });
    }],
    ["a user's assignments change", () => {
      const { mutateAsync } = useSetAssignments();
      return () => mutateAsync({ id: 'u1', assignments: [] });
    }],
    ['a role is edited', () => {
      const { mutateAsync } = useUpdateRole();
      return () => mutateAsync({ id: 'r1', input: { permissions: [] } });
    }],
  ] as ReadonlyArray<readonly [string, () => () => Promise<unknown>]>)('reloads API keys after %s, since it can disable keys', async (_name, useChange) => {
    writeMock.mockResolvedValue({ success: true, data: [] });
    const { result } = renderHook(() => ({ keys: useApiKeys(), change: useChange() }), { wrapper });
    await waitFor(() => { expect(result.current.keys.isSuccess).toBe(true); });
    expect(keyReads()).toBe(1);

    await result.current.change();

    await waitFor(() => { expect(keyReads()).toBe(2); });
  });

  // The Users page shows a taken-over key's token, once, when the delete resolves.
  it('does not hold up a delete, or reload keys before the users list has reloaded', async () => {
    const order: string[] = [];
    getMock.mockImplementation((path: string) => {
      order.push(path);
      return path === '/api-keys' && order.filter((x) => x === path).length > 1
        ? new Promise(() => {})
        : Promise.resolve({ success: true, data: [] });
    });
    writeMock.mockResolvedValue({ success: true, data: { takenOver: [{ id: 'k1' }] } });
    const { result } = renderHook(() => ({ users: useUsers(), keys: useApiKeys(), remove: useDeleteUser() }), { wrapper });
    await waitFor(() => { expect(result.current.keys.isSuccess && result.current.users.isSuccess).toBe(true); });
    order.length = 0;
    order.push('/api-keys');

    expect(await result.current.remove.mutateAsync({ id: 'u1' })).toEqual([{ id: 'k1' }]);

    await waitFor(() => { expect(order.slice(1)).toEqual(['/users', '/api-keys']); });
  });

  it('leaves API keys alone after a user is created', async () => {
    writeMock.mockResolvedValue({ success: true, data: { id: 'u2' } });
    const { result } = renderHook(() => ({ keys: useApiKeys(), create: useCreateUser() }), { wrapper });
    await waitFor(() => { expect(result.current.keys.isSuccess).toBe(true); });

    await result.current.create.mutateAsync({ username: 'a' } as never);

    expect(keyReads()).toBe(1);
  });
});
