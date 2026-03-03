// ===========================================
// Bridge IO Functions Tests
// ===========================================
// Tests for httpFetch, dbQuery, routeMessage, getResource bridge functions.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS, type ExecutionOptions, type CompiledScript } from '../sandbox-executor.js';
import { createSandboxContext, type SandboxContext } from '../sandbox-context.js';


// ----- Helpers -----

function makeScript(code: string): CompiledScript {
  return { code };
}

function makeOptions(overrides?: Partial<ExecutionOptions>): ExecutionOptions {
  return { ...DEFAULT_EXECUTION_OPTIONS, ...overrides };
}

function makeContext(overrides?: Partial<SandboxContext>): SandboxContext {
  const base = createSandboxContext('test msg', 'raw data');
  return { ...base, ...overrides };
}

// ----- Tests -----

describe('Bridge IO Functions', () => {
  describe('httpFetch', () => {
    let executor: VmSandboxExecutor;
    const mockHttpFetch = vi.fn();

    beforeEach(() => {
      mockHttpFetch.mockReset();
      executor = new VmSandboxExecutor({ httpFetch: mockHttpFetch });
    });

    afterEach(() => {
      executor.dispose();
    });

    it('calls httpFetch with URL and options', async () => {
      mockHttpFetch.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"result": true}',
      });

      const script = makeScript('return await httpFetch("https://api.example.com/data", { method: "GET" });');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const fetched = result.value.returnValue as Record<string, unknown>;
      expect(fetched['status']).toBe(200);
      expect(fetched['body']).toBe('{"result": true}');
    });

    it('blocks requests to private IP ranges (127.x)', async () => {
      const script = makeScript('return await httpFetch("http://127.0.0.1:8080/api");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(false);
    });

    it('blocks requests to private IP ranges (10.x)', async () => {
      const script = makeScript('return await httpFetch("http://10.0.0.1/api");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(false);
    });

    it('blocks requests to private IP ranges (192.168.x)', async () => {
      const script = makeScript('return await httpFetch("http://192.168.1.1/api");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(false);
    });

    it('blocks requests to localhost', async () => {
      const script = makeScript('return await httpFetch("http://localhost:3000/api");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(false);
    });

    it('allows requests to public IPs', async () => {
      mockHttpFetch.mockResolvedValue({
        status: 200, statusText: 'OK', headers: {}, body: 'ok',
      });

      const script = makeScript('return await httpFetch("https://api.example.com/data");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      expect(mockHttpFetch).toHaveBeenCalledWith('https://api.example.com/data', {});
    });

    it('passes default empty options when none provided', async () => {
      mockHttpFetch.mockResolvedValue({
        status: 200, statusText: 'OK', headers: {}, body: '',
      });

      const script = makeScript('return await httpFetch("https://example.com");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      expect(mockHttpFetch).toHaveBeenCalledWith('https://example.com', {});
    });
  });

  describe('dbQuery', () => {
    let executor: VmSandboxExecutor;
    const mockDbQuery = vi.fn();

    beforeEach(() => {
      mockDbQuery.mockReset();
      executor = new VmSandboxExecutor({ dbQuery: mockDbQuery });
    });

    afterEach(() => {
      executor.dispose();
    });

    it('executes parameterized query and returns rows', async () => {
      mockDbQuery.mockResolvedValue([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);

      const script = makeScript('return await dbQuery("postgresql", "postgres://localhost/test", "SELECT * FROM users WHERE id = $1", [1]);');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.value.returnValue as readonly Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      expect(rows[0]!['name']).toBe('Alice');
    });

    it('passes empty params when none provided', async () => {
      mockDbQuery.mockResolvedValue([]);

      const script = makeScript('return await dbQuery("postgresql", "postgres://localhost/test", "SELECT 1");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      expect(mockDbQuery).toHaveBeenCalledWith('postgresql', 'postgres://localhost/test', 'SELECT 1', []);
    });

    it('propagates query errors', async () => {
      mockDbQuery.mockRejectedValue(new Error('Connection refused'));

      const script = makeScript('return await dbQuery("postgresql", "postgres://bad-host/test", "SELECT 1");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(false);
    });
  });

  describe('routeMessage', () => {
    let executor: VmSandboxExecutor;
    const mockRouteMessage = vi.fn();

    beforeEach(() => {
      mockRouteMessage.mockReset();
      executor = new VmSandboxExecutor({ routeMessage: mockRouteMessage });
    });

    afterEach(() => {
      executor.dispose();
    });

    it('routes message to channel by name', async () => {
      mockRouteMessage.mockResolvedValue({ success: true, response: 'ACK' });

      const script = makeScript('return await routeMessage("Lab Results", "MSH|^~\\\\&|test");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const routeResult = result.value.returnValue as Record<string, unknown>;
      expect(routeResult['success']).toBe(true);
      expect(routeResult['response']).toBe('ACK');
    });

    it('returns failure when channel not found', async () => {
      mockRouteMessage.mockResolvedValue({ success: false });

      const script = makeScript('return await routeMessage("Nonexistent", "data");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const routeResult = result.value.returnValue as Record<string, unknown>;
      expect(routeResult['success']).toBe(false);
    });
  });

  describe('getResource', () => {
    let executor: VmSandboxExecutor;
    const mockGetResource = vi.fn();

    beforeEach(() => {
      mockGetResource.mockReset();
      executor = new VmSandboxExecutor({ getResource: mockGetResource });
    });

    afterEach(() => {
      executor.dispose();
    });

    it('returns resource content by name', async () => {
      mockGetResource.mockResolvedValue('resource content here');

      const script = makeScript('return await getResource("my-template");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('resource content here');
      expect(mockGetResource).toHaveBeenCalledWith('my-template');
    });

    it('returns null when resource not found', async () => {
      mockGetResource.mockResolvedValue(null);

      const script = makeScript('return await getResource("nonexistent");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBeNull();
    });
  });

  describe('no deps provided', () => {
    let executor: VmSandboxExecutor;

    beforeEach(() => {
      executor = new VmSandboxExecutor();
    });

    afterEach(() => {
      executor.dispose();
    });

    it('does not expose httpFetch when no deps provided', async () => {
      const script = makeScript('return typeof httpFetch;');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
    });

    it('does not expose dbQuery when no deps provided', async () => {
      const script = makeScript('return typeof dbQuery;');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
    });

    it('does not expose routeMessage when no deps provided', async () => {
      const script = makeScript('return typeof routeMessage;');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
    });

    it('does not expose getResource when no deps provided', async () => {
      const script = makeScript('return typeof getResource;');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
    });
  });

  describe('selective deps', () => {
    it('exposes only provided deps', async () => {
      const executor = new VmSandboxExecutor({
        getResource: vi.fn().mockResolvedValue('content'),
      });

      const script = makeScript('return { http: typeof httpFetch, resource: typeof getResource };');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const returned = result.value.returnValue as Record<string, unknown>;
      expect(returned['http']).toBe('undefined');
      expect(returned['resource']).toBe('function');

      executor.dispose();
    });
  });
});
