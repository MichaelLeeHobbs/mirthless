import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import {
  FhirDispatcher,
  buildFhirUrl,
  buildHeaders,
  extractResourceId,
  type FhirDispatcherConfig,
} from '../fhir-dispatcher.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

function makeConfig(overrides?: Partial<FhirDispatcherConfig>): FhirDispatcherConfig {
  return {
    baseUrl: 'https://fhir.example.com/r4',
    resourceType: 'Patient',
    method: 'POST',
    authType: 'NONE',
    authConfig: {},
    format: 'json',
    timeout: 30_000,
    headers: {},
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: 'ch-1',
    messageId: 1,
    metaDataId: 1,
    content: '{"resourceType":"Patient","name":[{"family":"Doe"}]}',
    dataType: 'FHIR',
    ...overrides,
  };
}

function makeSignal(aborted = false): AbortSignal {
  if (aborted) return AbortSignal.abort();
  return new AbortController().signal;
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildFhirUrl', () => {
  it('builds URL with resource type', () => {
    expect(buildFhirUrl('https://fhir.example.com/r4', 'Patient')).toBe('https://fhir.example.com/r4/Patient');
  });

  it('strips trailing slash from base URL', () => {
    expect(buildFhirUrl('https://fhir.example.com/r4/', 'Observation')).toBe('https://fhir.example.com/r4/Observation');
  });

  it('appends the resource id for instance-level operations', () => {
    expect(buildFhirUrl('https://fhir.example.com/r4', 'Patient', 'p1')).toBe('https://fhir.example.com/r4/Patient/p1');
  });

  it('rejects a resource id that would rewrite the request path', () => {
    expect(() => buildFhirUrl('https://fhir.example.com/r4', 'Patient', '../../admin')).toThrow(/Invalid FHIR resource id/);
    expect(() => buildFhirUrl('https://fhir.example.com/r4', 'Patient', 'p1?evil=1')).toThrow(/Invalid FHIR resource id/);
    expect(() => buildFhirUrl('https://fhir.example.com/r4', 'Patient', 'a/b')).toThrow(/Invalid FHIR resource id/);
  });
});

describe('extractResourceId', () => {
  it('reads id from a JSON resource', () => {
    expect(extractResourceId('{"resourceType":"Patient","id":"abc"}', 'json')).toBe('abc');
  });

  it('returns undefined for JSON without an id', () => {
    expect(extractResourceId('{"resourceType":"Patient"}', 'json')).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(extractResourceId('not json', 'json')).toBeUndefined();
  });

  it('reads id from an XML resource', () => {
    expect(extractResourceId('<Patient><id value="xyz"/></Patient>', 'xml')).toBe('xyz');
  });

  it('returns undefined for XML without an id', () => {
    expect(extractResourceId('<Patient><name>Doe</name></Patient>', 'xml')).toBeUndefined();
  });
});

describe('buildHeaders', () => {
  it('sets FHIR JSON content type', () => {
    const headers = buildHeaders(makeConfig({ format: 'json' }));
    expect(headers['Content-Type']).toBe('application/fhir+json');
    expect(headers['Accept']).toBe('application/fhir+json');
  });

  it('sets FHIR XML content type', () => {
    const headers = buildHeaders(makeConfig({ format: 'xml' }));
    expect(headers['Content-Type']).toBe('application/fhir+xml');
    expect(headers['Accept']).toBe('application/fhir+xml');
  });

  it('adds Basic auth header', () => {
    const headers = buildHeaders(makeConfig({
      authType: 'BASIC',
      authConfig: { username: 'user', password: 'pass' },
    }));
    expect(headers['Authorization']).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('adds Bearer auth header', () => {
    const headers = buildHeaders(makeConfig({
      authType: 'BEARER',
      authConfig: { token: 'my-token' },
    }));
    expect(headers['Authorization']).toBe('Bearer my-token');
  });

  it('adds API key header', () => {
    const headers = buildHeaders(makeConfig({
      authType: 'API_KEY',
      authConfig: { headerName: 'X-Api-Key', apiKey: 'secret123' },
    }));
    expect(headers['X-Api-Key']).toBe('secret123');
  });

  it('includes custom headers', () => {
    const headers = buildHeaders(makeConfig({ headers: { 'X-Custom': 'value' } }));
    expect(headers['X-Custom']).toBe('value');
  });

  it('does not add auth header for NONE', () => {
    const headers = buildHeaders(makeConfig({ authType: 'NONE' }));
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('FhirDispatcher.onDeploy', () => {
  it('succeeds with valid config', async () => {
    const dispatcher = new FhirDispatcher(makeConfig());
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when baseUrl is empty', async () => {
    const dispatcher = new FhirDispatcher(makeConfig({ baseUrl: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when baseUrl is invalid', async () => {
    const dispatcher = new FhirDispatcher(makeConfig({ baseUrl: 'not-a-url' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('does not quote a URL that is not one', async () => {
    const result = await new FhirDispatcher(makeConfig({ baseUrl: 'https://svc:hunter2/@fhir.example.com/r4' })).onDeploy();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('hunter2');
  });

  it('fails when resourceType is empty', async () => {
    const dispatcher = new FhirDispatcher(makeConfig({ resourceType: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when basic auth missing credentials', async () => {
    const dispatcher = new FhirDispatcher(makeConfig({
      authType: 'BASIC',
      authConfig: { username: 'user' },
    }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when bearer auth missing token', async () => {
    const dispatcher = new FhirDispatcher(makeConfig({
      authType: 'BEARER',
      authConfig: {},
    }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when API key auth missing fields', async () => {
    const dispatcher = new FhirDispatcher(makeConfig({
      authType: 'API_KEY',
      authConfig: { headerName: 'X-Key' },
    }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });
});

describe('FhirDispatcher lifecycle', () => {
  it('starts successfully', async () => {
    const dispatcher = new FhirDispatcher(makeConfig());
    const result = await dispatcher.onStart();
    expect(result.ok).toBe(true);
  });

  it('stops successfully', async () => {
    const dispatcher = new FhirDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onStop();
    expect(result.ok).toBe(true);
  });

  it('halts successfully', async () => {
    const dispatcher = new FhirDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onHalt();
    expect(result.ok).toBe(true);
  });

  it('undeploys successfully', async () => {
    const dispatcher = new FhirDispatcher(makeConfig());
    const result = await dispatcher.onUndeploy();
    expect(result.ok).toBe(true);
  });
});

describe('FhirDispatcher.send', () => {
  it('sends FHIR resource and returns SENT on success', async () => {
    mockFetch.mockResolvedValue(new Response('{"id":"123"}', { status: 201, statusText: 'Created' }));

    const dispatcher = new FhirDispatcher(makeConfig());
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toBe('{"id":"123"}');
    }
  });

  it('calls fetch with correct URL and method', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 201, statusText: 'Created' }));

    const dispatcher = new FhirDispatcher(makeConfig({
      baseUrl: 'https://fhir.test.com/r4',
      resourceType: 'Observation',
      method: 'POST',
    }));
    await dispatcher.onStart();
    await dispatcher.send(makeMessage(), makeSignal());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://fhir.test.com/r4/Observation');
    expect(opts.method).toBe('POST');
  });

  it.each([
    ['a URL that holds a password', { baseUrl: 'https://svc:hunter2@fhir.test.com/r4' }],
    ['a token that holds a line break', { authType: 'BEARER' as const, authConfig: { token: 'hunter2\nline2' } }],
  ])('deploys, and fails each send without quoting %s', async (_what, config) => {
    const dispatcher = new FhirDispatcher(makeConfig(config));
    expect((await dispatcher.onDeploy()).ok).toBe(true);
    await dispatcher.onStart();
    const result = await dispatcher.send(makeMessage(), makeSignal());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('hunter2');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns ERROR on non-OK response', async () => {
    mockFetch.mockResolvedValue(new Response('{"issue":[{"severity":"error"}]}', { status: 422, statusText: 'Unprocessable Entity' }));

    const dispatcher = new FhirDispatcher(makeConfig());
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ERROR');
      expect(result.value.errorMessage).toContain('422');
    }
  });

  it('reads an answer in the charset it declares (#415)', async () => {
    mockFetch.mockResolvedValue(new Response(Buffer.from([0x4d, 0xfc, 0x6c]), { status: 201, headers: { 'Content-Type': 'application/fhir+xml; charset=ISO-8859-1' } }));
    const { logger, warnings } = makeMockLogger();
    const dispatcher = new FhirDispatcher(makeConfig(), logger);
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());

    expect(result.value).toEqual({ status: 'SENT', content: 'M\u00fcl' });
    expect(warnings).toEqual([]);
  });

  it('logs an answer it cannot read, without the answer (#415)', async () => {
    mockFetch.mockResolvedValue(new Response(Buffer.from([0x4d, 0xfc, 0x6c]), { status: 201 }));
    const { logger, warnings } = makeMockLogger();
    const dispatcher = new FhirDispatcher(makeConfig(), logger);
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());

    expect(result.value).toEqual({ status: 'SENT', content: 'M\ufffdl' });
    expect(warnings).toEqual([{
      obj: { channelId: 'ch-1', messageId: 1, metaDataId: 1, status: 201, contentType: null, problem: 'it is not valid utf-8' },
      msg: expect.stringContaining('U+FFFD') as string,
    }]);
  });

  it('fails when not started', async () => {
    const dispatcher = new FhirDispatcher(makeConfig());
    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('fails when signal is aborted', async () => {
    const dispatcher = new FhirDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.send(makeMessage(), makeSignal(true));
    expect(result.ok).toBe(false);
  });

  it('sends with Bearer auth headers', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }));

    const dispatcher = new FhirDispatcher(makeConfig({
      authType: 'BEARER',
      authConfig: { token: 'my-jwt-token' },
    }));
    await dispatcher.onStart();
    await dispatcher.send(makeMessage(), makeSignal());

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('uses PUT method against the instance URL (id from body) when configured', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }));

    const dispatcher = new FhirDispatcher(makeConfig({ method: 'PUT' }));
    await dispatcher.onStart();
    const body = '{"resourceType":"Patient","id":"pat-42","name":[{"family":"Doe"}]}';
    await dispatcher.send(makeMessage({ content: body }), makeSignal());

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PUT');
    expect(url).toContain('/Patient/pat-42');
  });

  it('errors on PUT when the resource body has no id', async () => {
    const dispatcher = new FhirDispatcher(makeConfig({ method: 'PUT' }));
    await dispatcher.onStart();
    const result = await dispatcher.send(makeMessage(), makeSignal());

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// #163
describe('FhirDispatcher redirects', () => {
  let server: http.Server | undefined;
  let requests: Array<{ method: string; url: string }> = [];

  async function startRedirectingServer(status: number): Promise<string> {
    requests = [];
    const created = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        requests.push({ method: req.method ?? '', url: req.url ?? '' });
        if (req.url === '/moved') { res.writeHead(200); res.end('{"resourceType":"Bundle"}'); return; }
        res.writeHead(status, { Location: '/moved' });
        res.end();
      });
    });
    server = created;
    await new Promise<void>((resolve) => { created.listen(0, '127.0.0.1', resolve); });
    const address = created.address() as AddressInfo;
    return `http://127.0.0.1:${String(address.port)}/fhir`;
  }

  beforeEach(() => {
    // These tests talk to a real server, so they use the real fetch.
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running) await new Promise<void>((resolve) => { running.close(() => { resolve(); }); });
  });

  it.each([301, 302, 303, 307, 308])('reports a %i redirect as an error naming the target and does not follow it', async (status) => {
    const baseUrl = await startRedirectingServer(status);
    const dispatcher = new FhirDispatcher(makeConfig({ baseUrl }));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.errorMessage).toContain(String(status));
    expect(result.value.errorMessage).toContain('/moved');
    expect(requests).toEqual([{ method: 'POST', url: '/fhir/Patient' }]);
  });
});
