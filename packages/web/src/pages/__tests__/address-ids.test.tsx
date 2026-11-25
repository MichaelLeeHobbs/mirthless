// The server takes an id in either case and answers with it in lower case, so a page opened
// at an address typed in capitals must not compare, send, link or cache the id as typed (#406, D-349).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { ReactElement } from 'react';
import { PERMISSIONS } from '@galvanigraph/core-models';
import { lightTheme } from '../../styles/theme.js';
import { useAuthStore } from '../../stores/auth.store.js';
import { HeaderBreadcrumbs } from '../../components/layout/HeaderBreadcrumbs.js';
import { TestConnectionButton } from '../../components/common/TestConnectionButton.js';
import { AlertEditorPage } from '../AlertEditorPage.js';
import { ChannelEditorPage } from '../ChannelEditorPage.js';
import { CollectionRecordsPage } from '../CollectionRecordsPage.js';
import { MessageBrowserPage } from '../MessageBrowserPage.js';
import { RoleEditorPage } from '../RoleEditorPage.js';

const socketEmit = vi.hoisted(() => vi.fn());
vi.mock('../../lib/socket.js', () => ({
  getSocket: () => ({ emit: socketEmit, on: vi.fn(), off: vi.fn() }),
}));

const ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const TYPED = ID.toUpperCase();
const AT = '2026-11-25T12:00:00Z';

const CHANNEL = {
  id: ID, name: 'ADT in', description: '', enabled: true, revision: 3, inboundDataType: 'RAW', outboundDataType: 'RAW',
  sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];' }, createdAt: AT, updatedAt: AT,
  responseMode: 'AUTO_AFTER_DESTINATIONS', responseConnectorName: null, initialState: 'STOPPED', messageStorageMode: 'DEVELOPMENT',
  encryptData: false, removeContentOnCompletion: false, removeAttachmentsOnCompletion: false, pruningEnabled: false,
  pruningMaxAgeDays: null, pruningArchiveEnabled: false, scriptTimeoutSeconds: 30,
  scripts: [], destinations: [], metadataColumns: [], tags: [], filters: [], transformers: [],
};
const ALERT = {
  id: ID, name: 'Errors', description: '', enabled: true, revision: 1, channelIds: [], actions: [],
  trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null, windowMinutes: null },
  subjectTemplate: null, bodyTemplate: null, reAlertIntervalMs: null, maxAlerts: null,
};
const ROLE = { id: ID, name: 'Night shift', description: '', builtIn: false, admin: false, permissions: ['channels:read'], holders: 0, createdAt: AT, updatedAt: AT };
const COLLECTION = { id: ID, name: 'orders', description: '', indexedFields: ['accession'], defaultTtlSeconds: null, createdAt: AT, updatedAt: AT };
const MESSAGE = { messageId: 7, correlationId: 'c', receivedAt: AT, processed: true, processedAt: AT, connectors: [] };

const ANSWERS: Readonly<Record<string, unknown>> = {
  [`/channels/${ID}`]: CHANNEL,
  '/channel-groups': [{ id: 'g1', name: 'Lab' }, { id: 'g2', name: 'Radiology' }],
  '/channel-groups/memberships': [{ channelGroupId: 'g1', channelId: ID }, { channelGroupId: 'g2', channelId: ID }],
  '/channels/statistics': [{ channelId: ID, errored: 4 }],
  '/channels/status': [{ channelId: ID, state: 'STARTED' }],
  [`/channels/${ID}/messages`]: { items: [MESSAGE], total: 1, limit: 25, offset: 0 },
  [`/alerts/${ID}`]: ALERT,
  '/channels': { data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } },
  '/roles': [ROLE],
  [`/collections/${ID}`]: COLLECTION,
  [`/collections/${ID}/records`]: { items: [], total: 0 },
  '/connectors/test': { success: true, message: 'HTTP 200 OK', latencyMs: 5 },
};

interface Sent { readonly method: string; readonly path: string; readonly body: string }
let sent: Sent[] = [];

function answer(input: string, init?: RequestInit): Promise<Response> {
  const path = input.replace('/api/v1', '');
  sent.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? init.body : '' });
  const data = ANSWERS[path.toLowerCase().split('?')[0] ?? ''];
  return Promise.resolve(data === undefined
    ? Response.json({ success: false, error: { code: 'NOT_FOUND', message: `No ${path}` } }, { status: 404 })
    : Response.json({ success: true, data }));
}

function open(route: string, address: string, element: ReactElement): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [{ path: route, element: <><HeaderBreadcrumbs compact={false} />{element}</> }, { path: '*', element: null }],
    { initialEntries: [address] },
  );
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={lightTheme}><RouterProvider router={router} /></ThemeProvider>
    </QueryClientProvider>,
  );
  return client;
}

function idsAsTyped(client: QueryClient): string[] {
  return [
    ...sent.map((s) => `${s.method} ${s.path} ${s.body}`),
    ...client.getQueryCache().getAll().map((q) => `key ${JSON.stringify(q.queryKey)}`),
    ...socketEmit.mock.calls.map((call) => `socket ${JSON.stringify(call)}`),
    ...[...document.querySelectorAll('a')].map((a) => `link ${a.getAttribute('href') ?? ''}`),
  ].filter((text) => text.includes(TYPED));
}

beforeEach(() => {
  sent = [];
  socketEmit.mockClear();
  vi.stubGlobal('fetch', vi.fn(answer));
  useAuthStore.setState({
    user: { id: 'u1', username: 'admin', email: 'admin@example.org', role: 'admin', permissions: Object.values(PERMISSIONS) },
    accessToken: 'token', isAuthenticated: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false });
});

describe('the channel editor at an address in capitals', () => {
  it('shows the groups the channel is in, and says a choice keeps only one', async () => {
    open('/channels/:id', `/channels/${TYPED}`, <ChannelEditorPage />);

    expect(await screen.findByText('In 2 groups: Lab, Radiology. Saving keeps only the group you choose.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Channel Group' }).textContent).toBe('Lab');
  });

  it('shows the state and the failed messages', async () => {
    open('/channels/:id', `/channels/${TYPED}`, <ChannelEditorPage />);

    const failed = await screen.findByRole('link', { name: 'View 4 failed messages' });
    expect(failed.getAttribute('href')).toBe(`/channels/${ID}/messages?status=ERROR`);
    expect(await screen.findByText('Started')).toBeTruthy();
  });

  it('sends, links and caches the id as the server writes it', async () => {
    const client = open('/channels/:id', `/channels/${TYPED}`, <ChannelEditorPage />);

    await screen.findByText(/^In 2 groups: Lab, Radiology/);
    expect((screen.getByLabelText('Channel ID') as HTMLInputElement).value).toBe(ID);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Channel Group' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Radiology' }));
    await waitFor(() => {
      expect(sent).toContainEqual({ method: 'PUT', path: `/channels/${ID}/groups`, body: JSON.stringify({ groupIds: ['g2'] }) });
    });

    expect(idsAsTyped(client)).toEqual([]);
  });

  it('tests a connection as the stored channel', async () => {
    const client = open('/channels/:id', `/channels/${TYPED}`, <TestConnectionButton connectorType="HTTP" mode="DESTINATION" properties={{}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText('HTTP 200 OK (5ms)');

    expect(JSON.parse(sent.find((s) => s.path === '/connectors/test')?.body ?? '{}')).toMatchObject({ channelId: ID });
    expect(idsAsTyped(client)).toEqual([]);
  });
});

describe('the other pages at an address in capitals', () => {
  it('message browser: searches, listens to and links the stored channel', async () => {
    const client = open('/channels/:id/messages', `/channels/${TYPED}/messages`, <MessageBrowserPage />);

    await screen.findByRole('heading', { name: 'ADT in messages' });
    await waitFor(() => { expect(sent.some((s) => s.path.startsWith(`/channels/${ID}/messages?`))).toBe(true); });
    expect(socketEmit).toHaveBeenCalledWith('join:channel', ID);
    expect(screen.getByRole('link', { name: 'ADT in' }).getAttribute('href')).toBe(`/channels/${ID}`);
    expect(idsAsTyped(client)).toEqual([]);
  });

  it('role editor: finds the role to edit', async () => {
    const client = open('/roles/:id', `/roles/${TYPED}`, <RoleEditorPage />);

    expect(await screen.findByRole('heading', { name: 'Edit role: Night shift' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Day shift' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => { expect(sent.some((s) => s.method === 'PUT' && s.path === `/roles/${ID}`)).toBe(true); });
    expect(idsAsTyped(client)).toEqual([]);
  });

  it('role editor: finds the role to clone', async () => {
    open('/roles/new', `/roles/new?from=${TYPED}`, <RoleEditorPage />);
    expect(await screen.findByRole('heading', { name: 'Clone role: Night shift' })).toBeTruthy();
  });

  it('alert editor: loads and saves the stored alert', async () => {
    const client = open('/alerts/:id', `/alerts/${TYPED}`, <AlertEditorPage />);

    await screen.findByRole('heading', { name: 'Errors' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'All errors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(sent.some((s) => s.method === 'PUT' && s.path === `/alerts/${ID}`)).toBe(true); });
    expect(idsAsTyped(client)).toEqual([]);
  });

  it('collection records: reads the stored collection', async () => {
    const client = open('/collections/:id/records', `/collections/${TYPED}/records`, <CollectionRecordsPage />);

    await screen.findByRole('heading', { name: 'orders' });
    expect(idsAsTyped(client)).toEqual([]);
  });
});
