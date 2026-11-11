// ===========================================
// Sandbox Boundary Tests
// ===========================================
// A script must not be able to make host code call into an object the script
// built, in either direction: bridge arguments going out, results coming back.

import { describe, it, expect } from 'vitest';
import { VmSandboxExecutor, type ExecutionResult } from '../sandbox-executor.js';
import { createSandboxContext } from '../sandbox-context.js';
import { createHl7Proxy } from '../../pipeline/data-type-handler.js';
import { Hl7Message } from '@galvaniflow/core-util';
import type { BridgeDependencies } from '../bridge-functions.js';

const HL7 = 'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5\rPID|1||111^^^MRN||DOE^JOHN';

/** Script prelude: `grab(x)` tries to reach the host `process` through any value it is given. */
const PRELUDE =
  "var got = 'safe';" +
  "function grab(x) { try { var p = x.constructor.constructor('return process')(); if (p && p.pid) { got = 'ESCAPED'; } } catch (e) {} }";

async function run(code: string, deps?: BridgeDependencies, timeout = 2_000): Promise<ExecutionResult> {
  const executor = new VmSandboxExecutor(deps);
  const msg = createHl7Proxy(Hl7Message.parse(HL7));
  const result = await executor.execute({ code: PRELUDE + code }, createSandboxContext(msg, HL7), { timeout });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function runError(code: string, deps?: BridgeDependencies, timeout = 300): Promise<string> {
  const executor = new VmSandboxExecutor(deps);
  const result = await executor.execute({ code }, createSandboxContext({}, ''), { timeout });
  return result.ok ? 'no error' : result.error.message;
}

describe('bridge arguments (script to host)', () => {
  it.each([
    ['msg.setText value', "msg.setText('PID.5', { replace: function (re) { grab(re); return ''; }, split: function (d) { grab(d); return []; }, toString: function () { return 'X'; } });"],
    ['msg.set value', "msg.set('PID.5', { split: function (d) { grab(d); return { join: function (j) { grab(j); return ''; } }; }, replace: function (re) { grab(re); return ''; }, toString: function () { return 'X'; } });"],
    ['msg.set path', "try { msg.set({ split: function (d) { grab(d); return []; }, match: function (r) { grab(r); return null; }, toString: function () { return 'PID.5'; } }, 'X'); } catch (e) {}"],
    ['msg.get path', "try { msg.get({ match: function (r) { grab(r); return null; }, split: function (d) { grab(d); return []; }, toString: function () { return 'PID.5'; } }); } catch (e) {}"],
    ['createACK text', "try { createACK(rawData, 'AA', { replace: function (re) { grab(re); return ''; }, split: function (d) { grab(d); return []; }, toString: function () { return 'ok'; } }); } catch (e) {}"],
    ['createACK code', "try { createACK(rawData, { toString: function () { return 'AA'; }, replace: function (re) { grab(re); return ''; } }); } catch (e) {}"],
    ['parseHL7 input', "try { parseHL7({ split: function (d) { grab(d); return []; }, replace: function (re) { grab(re); return ''; }, toString: function () { return rawData; } }); } catch (e) {}"],
  ])('%s cannot hand the script a host object', async (_name, body) => {
    const value = await run(`${body} return got;`);

    expect(value.returnValue).toBe('safe');
  });

  it('converts an object passed as an HL7 value to text inside the sandbox', async () => {
    const value = await run("msg.setText('PID.5', { toString: function () { return 'A&B'; } }); return msg.get('PID.5');");

    expect(value.returnValue).toBe('A\\T\\B');
  });

  it('dbQuery parameters reach the host as plain host-realm data', async () => {
    const seen: unknown[] = [];
    const deps: BridgeDependencies = {
      dbQuery: async (_name, _sql, params) => { seen.push(params); return []; },
    };

    const value = await run(
      "var evil = { toPostgres: function (f) { grab(f); return 'x'; }, map: function (f) { grab(f); return []; }, n: 1 };" +
      "await dbQuery('ds', 'SELECT 1', [evil, 'a', 2]); return got;",
      deps,
    );

    expect(value.returnValue).toBe('safe');
    expect(seen[0]).toEqual([{ n: 1 }, 'a', 2]);
    expect(Array.isArray(seen[0])).toBe(true);
    expect(Object.getPrototypeOf((seen[0] as unknown[])[0])).toBe(Object.prototype);
  });

  it('rejects dbQuery parameters that are not an array', async () => {
    const deps: BridgeDependencies = { dbQuery: async () => [] };

    const message = await runError("await dbQuery('ds', 'SELECT 1', { map: function () { return []; } });", deps);

    expect(message).toContain('must be an array');
  });

  it('httpFetch options reach the host as plain host-realm data', async () => {
    const seen: unknown[] = [];
    const deps: BridgeDependencies = {
      httpFetch: async (_url, options) => { seen.push(options); return { status: 200, statusText: 'OK', headers: {}, body: '' }; },
    };

    const value = await run(
      "var headers = { a: 'b' }; Object.defineProperty(headers, 'evil', { enumerable: true, get: function () { return function () {}; } });" +
      "await httpFetch('https://example.com/', { method: 'POST', headers: headers, toString: function () { return 'x'; } }); return got;",
      deps,
    );

    expect(value.returnValue).toBe('safe');
    expect(seen[0]).toEqual({ method: 'POST', headers: { a: 'b' } });
    expect(Object.getPrototypeOf(seen[0])).toBe(Object.prototype);
  });

  it('collection arguments reach the host as plain host-realm data', async () => {
    const seen: unknown[] = [];
    const record = { id: '1', fields: {}, payload: null, expireAt: null, createdAt: '' };
    const deps: BridgeDependencies = {
      collections: {
        store: async (name, fields, payload, options) => { seen.push([name, fields, payload, options]); return record; },
        find: async (name, match, options) => { seen.push([name, match, options]); return []; },
        update: async (name, id, changes) => { seen.push([name, id, changes]); return record; },
        delete: async (name, id) => { seen.push([name, id]); return true; },
      },
    };

    await run(
      "var c = getCollection({ toString: function () { return 'visits'; } });" +
      "await c.store({ mrn: '1' }, { toString: function () { return 'P'; } }); await c.find({ mrn: '1' }, { limit: 1 });" +
      "await c.update(7, { payload: 'Q' }); await c.delete(7);",
      deps,
    );

    expect(seen).toEqual([
      ['visits', { mrn: '1' }, 'P', {}],
      ['visits', { mrn: '1' }, { limit: 1 }],
      ['visits', '7', { payload: 'Q' }],
      ['visits', '7'],
    ]);
  });
});

describe('results (host from script)', () => {
  it('a looping toJSON in the return value is stopped by the timeout', async () => {
    const message = await runError('return { toJSON: function () { for (;;) {} } };');

    expect(message).toContain('timed out');
  });

  it('a looping getter in a map value is stopped by the timeout', async () => {
    const message = await runError("channelMap.x = { get y() { for (;;) {} } }; return 1;");

    expect(message).toContain('timed out');
  });

  it('a thrown value with a looping message getter is stopped by the timeout', async () => {
    const message = await runError('throw { get message() { for (;;) {} } };');

    expect(message).toContain('timed out');
  });

  it('a looping name getter on Error.prototype cannot hang the host', async () => {
    const message = await runError("Object.defineProperty(Error.prototype, 'name', { get: function () { for (;;) {} } }); throw new Error('boom');");

    expect(message).toBe('boom');
  });

  it('a rejected value with a looping toString is stopped by the timeout', async () => {
    const deps: BridgeDependencies = { getResource: async () => 'r' };

    const message = await runError("await getResource('a'); throw { toString: function () { for (;;) {} } };", deps);

    expect(message).toContain('timed out');
  });

  it('reports a result that cannot be converted to JSON as a script error', async () => {
    const circular = await runError('var a = {}; a.self = a; return a;');
    const bigint = await runError('return { n: 10n };');

    expect(circular).toContain('cannot be converted to JSON');
    expect(bigint).toContain('cannot be converted to JSON');
  });

  it('returns host-realm data for the result and the maps', async () => {
    const value = await run("channelMap.a = { b: [1, 2] }; return { ok: true };");

    expect(value.returnValue).toEqual({ ok: true });
    expect(Object.getPrototypeOf(value.returnValue)).toBe(Object.prototype);
    expect(value.mapUpdates.channelMap).toEqual({ a: { b: [1, 2] } });
    expect(Object.getPrototypeOf(value.mapUpdates.channelMap['a'])).toBe(Object.prototype);
  });

  it('a script cannot change how results are read by replacing JSON or String', async () => {
    const value = await run("JSON.stringify = function () { return { evil: true }; }; String = function () { return {}; }; return 'fine';");

    expect(value.returnValue).toBe('fine');
  });

  it('stores an HL7 message placed in a map as its text', async () => {
    const value = await run("channelMap.original = msg; return undefined;");

    expect(value.mapUpdates.channelMap['original']).toBe(HL7);
    expect(value.returnValue).toBeUndefined();
  });

  it('still returns the HL7 message itself as a usable proxy', async () => {
    const value = await run("msg.set('PID.1', '2'); return msg;");

    expect((value.returnValue as { get(p: string): string }).get('PID.1')).toBe('2');
    expect((value.msg as { get(p: string): string }).get('PID.1')).toBe('2');
  });
});
