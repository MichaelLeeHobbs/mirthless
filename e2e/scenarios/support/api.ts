// ===========================================
// Scenario suite: API client
// ===========================================
// Thin wrapper over the real REST API. Every call fails the scenario loudly on a
// non-2xx, with the response body, so a failing scenario says why.

import { expect, request, type APIRequestContext } from '@playwright/test';

export const API_BASE = 'http://localhost:3100/api/v1';
export const ADMIN = { username: 'admin', password: 'Admin123!' } as const;

interface Envelope<T> { readonly success: boolean; readonly data: T }

export interface ConnectorSummary {
  readonly metaDataId: number;
  readonly connectorName: string | null;
  readonly status: string;
  readonly sendAttempts: number;
}

export interface MessageSummary {
  readonly messageId: number;
  readonly processed: boolean;
  readonly connectors: readonly ConnectorSummary[];
}

export interface ConnectorDetail extends ConnectorSummary {
  readonly content: Readonly<Record<string, string | undefined>>;
}

export interface MessageDetail {
  readonly messageId: number;
  readonly connectors: readonly ConnectorDetail[];
}

export interface ImportResult {
  readonly convertResult: { readonly channels: ReadonlyArray<{ readonly id: string; readonly name: string }>; readonly warnings: readonly string[] };
  readonly importResult: { readonly created: number; readonly updated: number; readonly skipped: number; readonly errors: readonly unknown[] };
}

/** An authenticated client for one scenario. */
export class Api {
  private constructor(readonly ctx: APIRequestContext) {}

  static async login(): Promise<Api> {
    const loginCtx = await request.newContext();
    const res = await loginCtx.post(`${API_BASE}/auth/login`, { data: ADMIN });
    expect(res.ok(), `admin login failed: ${String(res.status())}`).toBeTruthy();
    const { accessToken } = (await res.json() as Envelope<{ accessToken: string }>).data;
    await loginCtx.dispose();
    const ctx = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` } });
    return new Api(ctx);
  }

  private readonly touched = new Set<string>();

  /** Undeploy every channel this client deployed, freeing its ports, then close. */
  async dispose(): Promise<void> {
    for (const id of this.touched) await this.undeploy(id);
    await this.ctx.dispose();
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.ctx.get(`${API_BASE}${path}`);
    expect(res.ok(), `GET ${path} -> ${String(res.status())}: ${await res.text()}`).toBeTruthy();
    return (await res.json() as Envelope<T>).data;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const res = await this.ctx.post(`${API_BASE}${path}`, { data: data ?? {} });
    expect(res.ok(), `POST ${path} -> ${String(res.status())}: ${await res.text()}`).toBeTruthy();
    return (await res.json() as Envelope<T>).data;
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const res = await this.ctx.put(`${API_BASE}${path}`, { data });
    expect(res.ok(), `PUT ${path} -> ${String(res.status())}: ${await res.text()}`).toBeTruthy();
    return (await res.json() as Envelope<T>).data;
  }

  /**
   * Import a Mirth Connect export (one channel, a channel list or a full server
   * backup) the way an operator would, overwriting an earlier run's copy.
   */
  async importMirth(xml: string): Promise<ImportResult> {
    const result = await this.post<ImportResult>('/channels/import/mirth', { xml, collisionMode: 'OVERWRITE', dryRun: false });
    expect(result.importResult.errors, `import errors: ${JSON.stringify(result.importResult.errors)}`).toHaveLength(0);
    return result;
  }

  /** The id of the channel with this name. */
  async channelId(name: string): Promise<string> {
    const list = await this.get<{ data: Array<{ id: string; name: string }> }>('/channels?pageSize=100');
    const found = list.data.find((c) => c.name === name);
    expect(found, `channel "${name}" not found after import`).toBeTruthy();
    return found!.id;
  }

  /** Deploy and start a channel, waiting until it reports STARTED. */
  async deployAndStart(channelId: string): Promise<void> {
    this.touched.add(channelId);
    await this.post(`/channels/${channelId}/deploy`);
    const status = await this.get<{ state: string }>(`/channels/${channelId}/status`);
    if (status.state !== 'STARTED') await this.post(`/channels/${channelId}/start`);
    await expect.poll(async () => (await this.get<{ state: string }>(`/channels/${channelId}/status`)).state, { timeout: 15_000 })
      .toBe('STARTED');
  }

  /** Import, then deploy and start every named channel in the given order. */
  async importAndDeploy(xml: string, names: readonly string[]): Promise<Record<string, string>> {
    await this.importMirth(xml);
    const ids: Record<string, string> = {};
    for (const name of names) {
      const id = await this.channelId(name);
      await this.undeploy(id);
      ids[name] = id;
    }
    for (const name of names) await this.deployAndStart(ids[name]!);
    return ids;
  }

  /** Stop and undeploy, ignoring a channel that is not deployed. */
  async undeploy(channelId: string): Promise<void> {
    await this.ctx.post(`${API_BASE}/channels/${channelId}/stop`);
    await this.ctx.post(`${API_BASE}/channels/${channelId}/undeploy`);
  }

  async messages(channelId: string, query = ''): Promise<{ items: MessageSummary[]; total: number }> {
    return this.get(`/channels/${channelId}/messages?pageSize=100${query}`);
  }

  async message(channelId: string, messageId: number): Promise<MessageDetail> {
    return this.get(`/channels/${channelId}/messages/${String(messageId)}`);
  }

  async setConfig(category: string, name: string, value: string): Promise<void> {
    await this.put(`/config-map/${encodeURIComponent(category)}/${encodeURIComponent(name)}`, { value });
  }
}
