// ===========================================
// API Fixture
// ===========================================
// An admin API client for spec setup and cleanup: creating the rows a test
// needs and removing leftovers from an earlier, interrupted run. Every call
// fails the test on a non-2xx, so a broken setup step fails loudly instead of
// letting the UI steps run against data that isn't there.

import { expect, request, type APIRequestContext } from '@playwright/test';
import { ADMIN_USER } from './test-data.js';

export const API_BASE = 'http://localhost:3000/api/v1';

interface Envelope<T> { readonly success: boolean; readonly data: T }

/** Log in as the seeded admin and return a client that sends its token. Dispose it in afterAll. */
export async function adminApi(): Promise<APIRequestContext> {
  const loginCtx = await request.newContext();
  try {
    const res = await loginCtx.post(`${API_BASE}/auth/login`, { data: ADMIN_USER });
    expect(res.ok(), `Admin login failed: ${String(res.status())}`).toBeTruthy();
    const { accessToken } = (await res.json() as Envelope<{ accessToken: string }>).data;
    return await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` } });
  } finally {
    await loginCtx.dispose();
  }
}

/** GET an API path (relative to /api/v1) and return its `data`. */
export async function getData<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(`${API_BASE}${path}`);
  expect(res.ok(), `GET ${path} returned ${String(res.status())}: ${await res.text()}`).toBeTruthy();
  return (await res.json() as Envelope<T>).data;
}

/** POST to an API path and return its `data`. */
export async function postData<T>(api: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const res = await api.post(`${API_BASE}${path}`, { data: data ?? {} });
  expect(res.ok(), `POST ${path} returned ${String(res.status())}: ${await res.text()}`).toBeTruthy();
  return (await res.json() as Envelope<T>).data;
}

/** DELETE an API path. A 404 counts as done, since cleanup may race an earlier delete. */
export async function deleteOk(api: APIRequestContext, path: string): Promise<void> {
  const res = await api.delete(`${API_BASE}${path}`);
  expect(res.ok() || res.status() === 404, `DELETE ${path} returned ${String(res.status())}: ${await res.text()}`).toBeTruthy();
}

/** Stop, undeploy and delete a channel. Stop and undeploy may fail when it isn't running or deployed. */
export async function removeChannel(api: APIRequestContext, id: string): Promise<void> {
  await api.post(`${API_BASE}/channels/${id}/stop`);
  await api.post(`${API_BASE}/channels/${id}/undeploy`);
  await deleteOk(api, `/channels/${id}`);
}

/** Create an HL7 channel with an auto-ACKing TCP/MLLP source on 127.0.0.1:port and return its id. */
export async function createMllpChannel(
  api: APIRequestContext,
  fields: { readonly name: string; readonly port: number; readonly description?: string; readonly initialState?: string },
): Promise<string> {
  const { port, ...rest } = fields;
  const created = await postData<{ id: string }>(api, '/channels', {
    ...rest,
    enabled: true,
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: {
      host: '127.0.0.1',
      port,
      maxConnections: 10,
      responseMode: 'AUTO_ACK',
      charset: 'utf-8',
      maxFrameBytes: 52428800,
    },
  });
  return created.id;
}

/** Deploy a channel, start it if its initial state left it stopped, and wait until it reports STARTED. */
export async function deployAndStart(api: APIRequestContext, id: string): Promise<void> {
  const state = async (): Promise<string> => (await getData<{ state: string }>(api, `/channels/${id}/status`)).state;
  await postData(api, `/channels/${id}/deploy`);
  if (await state() !== 'STARTED') await postData(api, `/channels/${id}/start`);
  await expect.poll(state).toBe('STARTED');
}

/** Remove every channel with this exact name (leftovers from an interrupted run). */
export async function removeChannelsNamed(api: APIRequestContext, name: string): Promise<void> {
  const list = await getData<{ data: Array<{ id: string; name: string }> }>(api, '/channels?pageSize=100');
  for (const ch of list.data) {
    if (ch.name === name) await removeChannel(api, ch.id);
  }
}
