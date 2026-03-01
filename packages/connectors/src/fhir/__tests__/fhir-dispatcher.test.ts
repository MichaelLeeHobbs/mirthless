// ===========================================
// FHIR R4 Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import {
  FhirDispatcher,
  buildFhirUrl,
  buildHeaders,
  type FhirDispatcherConfig,
} from '../fhir-dispatcher.js';

// ----- Helpers -----

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

// ----- Mock fetch -----

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ----- buildFhirUrl -----

describe('buildFhirUrl', () => {
  it('builds URL with resource type', () => {
    expect(buildFhirUrl('https://fhir.example.com/r4', 'Patient')).toBe('https://fhir.example.com/r4/Patient');
  });

  it('strips trailing slash from base URL', () => {
    expect(buildFhirUrl('https://fhir.example.com/r4/', 'Observation')).toBe('https://fhir.example.com/r4/Observation');
  });
});

// ----- buildHeaders -----

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

// ----- onDeploy -----

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

// ----- Lifecycle -----

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

// ----- send -----

describe('FhirDispatcher.send', () => {
  it('sends FHIR resource and returns SENT on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => '{"id":"123"}',
    });

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
    mockFetch.mockResolvedValue({
      ok: true, status: 201, statusText: 'Created',
      text: async () => '{}',
    });

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

  it('returns ERROR on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => '{"issue":[{"severity":"error"}]}',
    });

    const dispatcher = new FhirDispatcher(makeConfig());
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ERROR');
      expect(result.value.errorMessage).toContain('422');
    }
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
    mockFetch.mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: async () => '{}',
    });

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

  it('uses PUT method when configured', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: async () => '{}',
    });

    const dispatcher = new FhirDispatcher(makeConfig({ method: 'PUT' }));
    await dispatcher.onStart();
    await dispatcher.send(makeMessage(), makeSignal());

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PUT');
  });
});
