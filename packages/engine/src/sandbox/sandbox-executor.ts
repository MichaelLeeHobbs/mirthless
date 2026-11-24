// Security model (./README.md): no host-realm object or function ever reaches user code, and
// host code never touches a sandbox object. Data enters as JSON parsed inside the context;
// bridges are sandbox-realm wrappers around one host dispatch that takes and returns only
// primitives; results leave as one JSON string made inside the sandbox, under the timeout.

import * as vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import type { Result } from '@galvanigraph/core-util';
import { tryCatch } from '@galvanigraph/core-util';
import type { SandboxContext, LogEntry } from './sandbox-context.js';
import { createBridgeFunctions, type BridgeDependencies, type BridgeFunctions, type Hl7MessageProxy, type HttpFetchOptions, type CollectionScalar, type CollectionStoreOptions, type CollectionFindOptions, type CollectionUpdateChanges } from './bridge-functions.js';
import { isHl7MessageProxy, isX12MessageProxy, type X12MessageProxy } from '../pipeline/data-type-handler.js';
import { ESCAPED_IMPORT, withoutDynamicImport } from './dynamic-import.js';
import { ownString, thrownText } from './sandbox-value.js';

export interface CompiledScript {
  readonly code: string;
  readonly sourceMap?: string;
}

export interface ExecutionOptions {
  /** Wall-clock milliseconds, covering synchronous and async work. */
  readonly timeout: number;
  readonly signal?: AbortSignal | undefined;
}

export interface ExecutionResult {
  readonly returnValue: unknown;
  readonly msg: unknown;
  readonly mapUpdates: {
    readonly channelMap: Readonly<Record<string, unknown>>;
    readonly connectorMap: Readonly<Record<string, unknown>>;
    readonly globalChannelMap: Readonly<Record<string, unknown>>;
    readonly globalMap: Readonly<Record<string, unknown>>;
    readonly responseMap: Readonly<Record<string, unknown>>;
  };
  readonly logs: readonly LogEntry[];
}

export const DEFAULT_EXECUTION_OPTIONS: ExecutionOptions = {
  timeout: 30_000,
} as const;

export interface SandboxExecutor {
  execute(
    script: CompiledScript,
    context: SandboxContext,
    options: ExecutionOptions,
  ): Promise<Result<ExecutionResult>>;

  dispose(): void;
}

interface HostBridgeState {
  readonly logs: LogEntry[];
  readonly bridges: BridgeFunctions;
  readonly hl7Handles: Map<number, Hl7MessageProxy>;
  readonly x12Handles: Map<number, X12MessageProxy>;
  readonly destSet: Record<string, unknown> | undefined;
  nextHandle: number;
  /** Set from inside the sandbox; the host never reads the value a script threw. */
  failure: string | undefined;
}

/** Sandbox wrappers already convert; this is the host's own check. */
function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Bridge argument must be a string');
  return value;
}

function optStr(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : str(value);
}

function fromJson(value: unknown): unknown {
  return JSON.parse(str(value)) as unknown;
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = fromJson(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Bridge argument must be an object');
  }
  return parsed as Record<string, unknown>;
}

function jsonArray(value: unknown): readonly unknown[] {
  const parsed = fromJson(value);
  if (!Array.isArray(parsed)) throw new Error('Bridge argument must be an array');
  return parsed as readonly unknown[];
}

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

function registerHl7(state: HostBridgeState, proxy: Hl7MessageProxy): number {
  const id = state.nextHandle;
  state.nextHandle += 1;
  state.hl7Handles.set(id, proxy);
  return id;
}

function getHl7(state: HostBridgeState, id: unknown): Hl7MessageProxy {
  const proxy = state.hl7Handles.get(id as number);
  if (!proxy) throw new Error('Invalid HL7 handle');
  return proxy;
}

function hl7Op(state: HostBridgeState, op: string, args: readonly unknown[]): unknown {
  const proxy = getHl7(state, args[0]);
  switch (op) {
    case 'hl7.get': return proxy.get(str(args[1]));
    case 'hl7.getRaw': return proxy.getRaw(str(args[1]));
    case 'hl7.getText': return proxy.getText(str(args[1]));
    case 'hl7.set': proxy.set(str(args[1]), str(args[2])); return undefined;
    case 'hl7.setText': proxy.setText(str(args[1]), str(args[2])); return undefined;
    case 'hl7.delete': proxy.delete(str(args[1])); return undefined;
    case 'hl7.toString': return proxy.toString();
    case 'hl7.messageType': return proxy.messageType;
    case 'hl7.controlId': return proxy.messageControlId;
    case 'hl7.segCount': return proxy.getSegmentCount(str(args[1]));
    case 'hl7.segString': return proxy.getSegmentString(str(args[1]), typeof args[2] === 'number' ? args[2] : undefined);
    default: return undefined;
  }
}

function registerX12(state: HostBridgeState, proxy: X12MessageProxy): number {
  const id = state.nextHandle;
  state.nextHandle += 1;
  state.x12Handles.set(id, proxy);
  return id;
}

function x12Op(state: HostBridgeState, op: string, args: readonly unknown[]): unknown {
  const proxy = state.x12Handles.get(args[0] as number);
  if (!proxy) throw new Error('Invalid X12 handle');
  switch (op) {
    case 'x12.get': return proxy.get(str(args[1]));
    case 'x12.set': proxy.set(str(args[1]), str(args[2])); return undefined;
    case 'x12.delete': proxy.delete(str(args[1])); return undefined;
    case 'x12.toString': return proxy.toString();
    case 'x12.segCount': return proxy.getSegmentCount(str(args[1]));
    default: return undefined;
  }
}

function messageKind(value: unknown): 'hl7' | 'x12' | 'data' {
  if (isHl7MessageProxy(value)) return 'hl7';
  return isX12MessageProxy(value) ? 'x12' : 'data';
}

function messageValue(state: HostBridgeState, value: unknown): unknown {
  if (isHl7MessageProxy(value)) return registerHl7(state, value);
  return isX12MessageProxy(value) ? registerX12(state, value) : value;
}

function dsOp(state: HostBridgeState, op: string, args: readonly unknown[]): unknown {
  const set = state.destSet;
  if (!set) return undefined;
  const call = (name: string, ...a: unknown[]): unknown =>
    (set[name] as (...x: unknown[]) => unknown)(...a);
  switch (op) {
    case 'ds.removeAll': call('removeAll'); return undefined;
    case 'ds.remove': call('remove', fromJson(args[0])); return undefined;
    case 'ds.removeAllExcept': call('removeAllExcept', fromJson(args[0])); return undefined;
    case 'ds.add': call('add', fromJson(args[0])); return undefined;
    case 'ds.contains': return call('contains', fromJson(args[0]));
    case 'ds.getConnectorNames': return JSON.stringify(call('getConnectorNames'));
    default: return undefined;
  }
}

/** JSON-encoded so no host object, not even an Error, crosses the boundary. */
async function ioDispatch(fn: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify({ ok: true, v: await fn() });
  } catch (e) {
    return JSON.stringify({ ok: false, e: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Never throws into the sandbox: a script that catches a host Error reaches the host `Function`
 * through `e.constructor.constructor`, and from there `process`. A failure is kept here and
 * reported as `errToken`, a random string only this execution knows; the sandbox wrapper
 * fetches the message with `err.take` and throws a sandbox-realm Error.
 */
function makeNonThrowingDispatch(
  dispatch: (op: string, ...args: unknown[]) => unknown,
  errToken: string,
): (op: string, ...args: unknown[]) => unknown {
  let lastError = '';
  return (op: string, ...args: unknown[]): unknown => {
    if (op === 'err.take') {
      const message = lastError;
      lastError = '';
      return message;
    }
    // Checked before any host code sees the arguments: an object or function from
    // the sandbox must never be touched on the host (see the security model).
    if (typeof op !== 'string' || !args.every(isPrimitive)) {
      lastError = 'Bridge arguments must be primitive values';
      return errToken;
    }
    try {
      return dispatch(op, ...args);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return errToken;
    }
  };
}

function makeHostDispatch(state: HostBridgeState): (op: string, ...args: unknown[]) => unknown {
  const { bridges } = state;
  return (op: string, ...args: unknown[]): unknown => {
    if (op.startsWith('hl7.')) return hl7Op(state, op, args);
    if (op.startsWith('x12.')) return x12Op(state, op, args);
    if (op.startsWith('ds.')) return dsOp(state, op, args);
    switch (op) {
      case 'log':
        state.logs.push({ level: args[0] as LogEntry['level'], message: String(args[1] ?? ''), timestamp: new Date() });
        return undefined;
      case 'fail': state.failure = String(args[0] ?? ''); return undefined;
      case 'parseHL7': return registerHl7(state, bridges.parseHL7(args[0] as string));
      case 'createACK': return bridges.createACK(str(args[0]), str(args[1]), optStr(args[2]));
      case 'httpFetch': return ioDispatch(async () => bridges.httpFetch!(str(args[0]), jsonObject(args[1]) as HttpFetchOptions));
      case 'dbQuery': return ioDispatch(async () => bridges.dbQuery!(str(args[0]), str(args[1]), jsonArray(args[2])));
      case 'routeMessage': return ioDispatch(async () => bridges.routeMessage!(str(args[0]), str(args[1])));
      case 'getResource': return ioDispatch(async () => bridges.getResource!(str(args[0])));
      case 'collectionStore': return ioDispatch(async () => bridges.collections!.store(
        str(args[0]),
        jsonObject(args[1]) as Record<string, CollectionScalar>,
        str(args[2]),
        jsonObject(args[3]) as CollectionStoreOptions,
      ));
      case 'collectionFind': return ioDispatch(async () => bridges.collections!.find(
        str(args[0]),
        jsonObject(args[1]) as Record<string, CollectionScalar>,
        jsonObject(args[2]) as CollectionFindOptions,
      ));
      case 'collectionUpdate': return ioDispatch(async () => bridges.collections!.update(
        str(args[0]),
        str(args[1]),
        jsonObject(args[2]) as CollectionUpdateChanges,
      ));
      case 'collectionDelete': return ioDispatch(async () => bridges.collections!.delete(str(args[0]), str(args[1])));
      default: return undefined;
    }
  };
}

interface SandboxPayload {
  readonly errToken: string;
  readonly rawData: string;
  readonly msgKind: 'hl7' | 'x12' | 'data';
  readonly msgVal: unknown;
  readonly tmpKind: 'hl7' | 'x12' | 'data';
  readonly tmpVal: unknown;
  readonly channelMap: Record<string, unknown>;
  readonly connectorMap: Record<string, unknown>;
  readonly globalChannelMap: Record<string, unknown>;
  readonly globalMap: Record<string, unknown>;
  readonly responseMap: Record<string, unknown>;
  readonly sourceMap: Record<string, unknown>;
  readonly configMap: Record<string, unknown>;
  readonly extrasData: Record<string, unknown>;
  readonly hasDestinationSet: boolean;
  readonly bridges: { httpFetch: boolean; dbQuery: boolean; routeMessage: boolean; getResource: boolean; getCollection: boolean };
}

function buildPayload(
  state: HostBridgeState,
  context: SandboxContext,
  deps: BridgeDependencies | undefined,
  errToken: string,
): SandboxPayload {
  const extrasData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context.extras ?? {})) {
    if (k !== 'destinationSet') extrasData[k] = v;
  }
  return {
    errToken,
    rawData: context.rawData,
    msgKind: messageKind(context.msg),
    msgVal: messageValue(state, context.msg),
    tmpKind: messageKind(context.tmp),
    tmpVal: messageValue(state, context.tmp),
    channelMap: { ...context.channelMap },
    connectorMap: { ...context.connectorMap },
    globalChannelMap: { ...(context.globalChannelMap ?? {}) },
    globalMap: { ...(context.globalMap ?? {}) },
    responseMap: { ...context.responseMap },
    sourceMap: { ...context.sourceMap },
    configMap: { ...(context.configMap ?? {}) },
    extrasData,
    hasDestinationSet: Boolean(context.extras && 'destinationSet' in context.extras),
    bridges: {
      httpFetch: Boolean(deps?.httpFetch),
      dbQuery: Boolean(deps?.dbQuery),
      routeMessage: Boolean(deps?.routeMessage),
      getResource: Boolean(deps?.getResource),
      getCollection: Boolean(deps?.collections),
    },
  };
}

// Runs inside the vm context, so every function it defines is sandbox-realm.
const BOOTSTRAP_SRC = `'use strict';
// Node assigns \`code\` to the timeout error it makes in this realm, with no time limit. This stops
// the assignment at Error.prototype: without it, a setter the script put there or further up the
// chain would run, and one that throws aborts the process. Writable, so that the assignment (and a
// script's own) succeeds; not configurable, so that a script can't turn it into an accessor.
Object.defineProperty(Error.prototype, 'code', { value: undefined, writable: true, enumerable: false, configurable: false });
// Without a numeric limit V8 captures no stack. Reading a captured one calls Node's formatter, and
// near the stack limit that call fails with a host-realm error.
Object.defineProperty(Error, 'stackTraceLimit', { value: undefined, writable: false, enumerable: false, configurable: false });
// V8 runs a registry's callbacks and settles a compile from tasks of its own, with no time limit.
// Node reads a private symbol of a rejected promise, also with none, and only a Proxy can catch that.
delete globalThis.FinalizationRegistry;
delete globalThis.WebAssembly;
delete globalThis.Proxy;
// Its methods convert their arguments in V8's inspector, which loses the stop of a script that
// goes over its limit there.
delete globalThis.console;
// The engine calls a derived promise's resolve function as a job of its own. A script's own
// function can throw out of that job: Node takes it for the server's own uncaught exception, and
// V8, describing what was thrown, can lose the stop of a script that goes over its limit there.
// So then() derives a plain promise whatever the promise says its constructor is.
(function () {
  var RealPromise = Promise;
  var realThen = Promise.prototype.then;
  var define = Object.defineProperty;
  var apply = Reflect.apply;
  var own = { __proto__: null, value: RealPromise, writable: false, enumerable: false, configurable: false };
  define(RealPromise, Symbol.species, own);
  define(RealPromise.prototype, 'then', {
    __proto__: null, writable: true, enumerable: false, configurable: true,
    value: function then(onFulfilled, onRejected) {
      define(this, 'constructor', own);
      return apply(realThen, this, [onFulfilled, onRejected]);
    }
  });
  // The script's text says import with an escape, which only raw text shows.
  var realRaw = String.raw;
  define(String, 'raw', {
    __proto__: null, writable: true, enumerable: false, configurable: true,
    value: function raw(strings) {
      var parts = [];
      for (var i = 0; i < strings.raw.length; i += 1) { parts[i] = ''.concat(strings.raw[i]).replaceAll(${JSON.stringify(ESCAPED_IMPORT)}, 'import'); }
      arguments[0] = { raw: parts };
      return apply(realRaw, this, arguments);
    }
  });
})();
globalThis.__build = function (hostDispatch, payload) {
  // The host never throws across the boundary (a host Error would hand the script the
  // host realm's Function). It returns errToken instead; the Error is created here,
  // in the sandbox realm.
  var errToken = payload.errToken;
  // Captured before any user code runs, so a script that replaces the globals
  // cannot change how values cross the boundary.
  var S = String;
  var N = Number;
  var stringify = JSON.stringify;
  var apply = Reflect.apply;
  // Every value handed to the host is converted here, in the sandbox, to a string,
  // a number or a JSON string. The host refuses anything else.
  function text(v) { return v == null ? '' : S(v); }
  function json(v, fallback) {
    var out = stringify(v === undefined || v === null ? fallback : v);
    if (typeof out !== 'string') { throw new TypeError('Value cannot be converted to JSON'); }
    return out;
  }
  function describe(e, asText) {
    try {
      if (asText) { return S(e); }
      return (e !== null && typeof e === 'object' && 'message' in e) ? S(e.message) : S(e);
    } catch (ignored) { return 'Script threw a value that could not be read'; }
  }
  // Near the stack limit a call into the host fails before the host's own try is entered, and the
  // error is a host-realm one: it must not leave this catch.
  function callHost() {
    try { return apply(hostDispatch, null, arguments); } catch (ignored) { throw new Error('Maximum call stack size exceeded'); }
  }
  function dispatch() {
    var out = apply(callHost, null, arguments);
    if (out === errToken) { throw new Error(callHost('err.take')); }
    return out;
  }
  // IO bridges: the host returns a ticket id synchronously and later settles the
  // tickets that are ready, all at once, by running __settle() in this context.
  // Awaiting a sandbox-realm promise keeps every continuation on this context's
  // microtask queue, which only drains inside a timed runInContext call, so
  // post-await code is bounded by the script timeout.
  var pendingIo = {};
  function io() {
    var id = apply(dispatch, null, arguments);
    return new Promise(function (resolve) { pendingIo[id] = resolve; });
  }
  // One result at a time: many large results in one string could pass V8's
  // string limit. An empty string means none is left.
  Object.defineProperty(globalThis, '__settle', { value: function () {
    for (;;) {
      var next = dispatch('io.next');
      if (next === '') { return; }
      var t = JSON.parse(next);
      var resolve = pendingIo[t[0]];
      delete pendingIo[t[0]];
      if (resolve) { resolve(t[1]); }
    }
  } });
  Object.defineProperty(globalThis, '__watch', { value: function (p) {
    p.then(
      function (v) { globalThis.__result = v; dispatch('io.done', true); },
      function (e) { dispatch('io.done', false, describe(e, true)); }
    );
  } });
  // Runs a synchronous script. Whatever it throws is described here, under the
  // timeout, so the host never reads a property of a thrown value.
  Object.defineProperty(globalThis, '__run', { value: function (f) {
    try { globalThis.__result = f(); } catch (e) { dispatch('fail', describe(e, false)); }
  } });
  // Hands the result, msg and maps to the host as one JSON string.
  function enc(v) {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') { return { k: 'u' }; }
    if (v !== null && typeof v === 'object' && v.__hl7Proxy === true && typeof v.__handle === 'number') {
      return { k: 'h', v: v.__handle };
    }
    if (v !== null && typeof v === 'object' && v.__x12Proxy === true && typeof v.__handle === 'number') {
      return { k: 'x', v: v.__handle };
    }
    return { k: 'j', v: v };
  }
  Object.defineProperty(globalThis, '__collect', { value: function () {
    try {
      return stringify({
        r: enc(globalThis.__result),
        m: enc(globalThis.msg),
        maps: {
          channelMap: globalThis.channelMap || {},
          connectorMap: globalThis.connectorMap || {},
          globalChannelMap: globalThis.globalChannelMap || {},
          globalMap: globalThis.globalMap || {},
          responseMap: globalThis.responseMap || {}
        }
      });
    } catch (e) {
      return stringify({ err: 'Script result cannot be converted to JSON: ' + describe(e, false) });
    }
  } });
  function makeHl7(handle) {
    return {
      __hl7Proxy: true,
      __handle: handle,
      get: function (p) { return dispatch('hl7.get', handle, text(p)); },
      getRaw: function (p) { return dispatch('hl7.getRaw', handle, text(p)); },
      getText: function (p) { return dispatch('hl7.getText', handle, text(p)); },
      set: function (p, v) { dispatch('hl7.set', handle, text(p), text(v)); },
      setText: function (p, v) { dispatch('hl7.setText', handle, text(p), text(v)); },
      delete: function (p) { dispatch('hl7.delete', handle, text(p)); },
      toString: function () { return dispatch('hl7.toString', handle); },
      // A message stored inside a map or another object is saved as its HL7 text.
      toJSON: function () { return dispatch('hl7.toString', handle); },
      get messageType() { return dispatch('hl7.messageType', handle); },
      get messageControlId() { return dispatch('hl7.controlId', handle); },
      getSegmentCount: function (n) { return dispatch('hl7.segCount', handle, text(n)); },
      getSegmentString: function (n, i) { return dispatch('hl7.segString', handle, text(n), i == null ? undefined : N(i)); }
    };
  }
  function makeX12(handle) {
    return {
      __x12Proxy: true,
      __handle: handle,
      get: function (p) { return dispatch('x12.get', handle, text(p)); },
      set: function (p, v) { dispatch('x12.set', handle, text(p), text(v)); },
      delete: function (p) { dispatch('x12.delete', handle, text(p)); },
      getSegmentCount: function (n) { return dispatch('x12.segCount', handle, text(n)); },
      toString: function () { return dispatch('x12.toString', handle); },
      toJSON: function () { return dispatch('x12.toString', handle); }
    };
  }
  function message(kind, value) {
    if (kind === 'hl7') { return makeHl7(value); }
    return kind === 'x12' ? makeX12(value) : value;
  }
  globalThis.rawData = payload.rawData;
  globalThis.channelMap = payload.channelMap;
  globalThis.connectorMap = payload.connectorMap;
  globalThis.globalChannelMap = payload.globalChannelMap;
  globalThis.globalMap = payload.globalMap;
  globalThis.responseMap = payload.responseMap;
  globalThis.sourceMap = payload.sourceMap;
  globalThis.configMap = Object.freeze(payload.configMap);
  globalThis.msg = message(payload.msgKind, payload.msgVal);
  globalThis.tmp = message(payload.tmpKind, payload.tmpVal);
  globalThis.logger = {
    info: function (m) { dispatch('log', 'INFO', S(m)); },
    warn: function (m) { dispatch('log', 'WARN', S(m)); },
    error: function (m) { dispatch('log', 'ERROR', S(m)); },
    debug: function (m) { dispatch('log', 'DEBUG', S(m)); }
  };
  globalThis.parseHL7 = function (raw) {
    if (raw && typeof raw === 'object' && raw.__hl7Proxy === true) { return raw; }
    // null, undefined and numbers reach the host as they are and are rejected there.
    return makeHl7(dispatch('parseHL7', (raw !== null && typeof raw === 'object') || typeof raw === 'function' ? S(raw) : raw));
  };
  globalThis.createACK = function (originalRaw, ackCode, textMessage) {
    return dispatch('createACK', text(originalRaw), text(ackCode), textMessage == null ? undefined : S(textMessage));
  };
  globalThis.$ = function (key) {
    var maps = [responseMap, connectorMap, channelMap, globalChannelMap, globalMap, configMap, sourceMap];
    for (var i = 0; i < maps.length; i++) { var v = maps[i][key]; if (v !== undefined) { return v; } }
    return undefined;
  };
  globalThis.$r = function (key, value) {
    if (arguments.length >= 2) { responseMap[key] = value; return undefined; }
    return responseMap[key];
  };
  globalThis.$g = function (key, value) {
    if (arguments.length >= 2) { globalMap[key] = value; return undefined; }
    return globalMap[key];
  };
  // Mirth-compatible shortcuts: $c channelMap, $co connectorMap, $s sourceMap,
  // $gc globalChannelMap, $cfg configMap.
  globalThis.$c = function (key, value) {
    if (arguments.length >= 2) { channelMap[key] = value; return undefined; }
    return channelMap[key];
  };
  globalThis.$co = function (key, value) {
    if (arguments.length >= 2) { connectorMap[key] = value; return undefined; }
    return connectorMap[key];
  };
  globalThis.$s = function (key) { return sourceMap[key]; };
  globalThis.$gc = function (key, value) {
    if (arguments.length >= 2) { globalChannelMap[key] = value; return undefined; }
    return globalChannelMap[key];
  };
  globalThis.$cfg = function (key) { return configMap[key]; };
  if (payload.bridges.httpFetch) {
    globalThis.httpFetch = async function (url, options) {
      var r = JSON.parse(await io('httpFetch', text(url), json(options, {})));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.dbQuery) {
    globalThis.dbQuery = async function (dataSourceName, sqlText, params) {
      var r = JSON.parse(await io('dbQuery', text(dataSourceName), text(sqlText), json(params, [])));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.routeMessage) {
    globalThis.routeMessage = async function (channelName, data) {
      var r = JSON.parse(await io('routeMessage', text(channelName), text(data)));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.getResource) {
    globalThis.getResource = async function (name) {
      var r = JSON.parse(await io('getResource', text(name)));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.getCollection) {
    globalThis.getCollection = function (collectionName) {
      var name = text(collectionName);
      return {
        store: async function (fields, payload, options) {
          var r = JSON.parse(await io('collectionStore', name, json(fields, {}), text(payload), json(options, {})));
          if (!r.ok) { throw new Error(r.e); }
          return r.v;
        },
        find: async function (match, options) {
          var r = JSON.parse(await io('collectionFind', name, json(match, {}), json(options, {})));
          if (!r.ok) { throw new Error(r.e); }
          return r.v;
        },
        update: async function (id, changes) {
          var r = JSON.parse(await io('collectionUpdate', name, text(id), json(changes, {})));
          if (!r.ok) { throw new Error(r.e); }
          return r.v;
        },
        delete: async function (id) {
          var r = JSON.parse(await io('collectionDelete', name, text(id)));
          if (!r.ok) { throw new Error(r.e); }
          return r.v;
        }
      };
    };
  }
  if (payload.hasDestinationSet) {
    globalThis.destinationSet = {
      removeAll: function () { dispatch('ds.removeAll'); },
      remove: function (n) { dispatch('ds.remove', json(n, null)); },
      removeAllExcept: function (n) { dispatch('ds.removeAllExcept', json(n, null)); },
      add: function (n) { dispatch('ds.add', json(n, null)); },
      contains: function (n) { return dispatch('ds.contains', json(n, null)); },
      getConnectorNames: function () { return JSON.parse(dispatch('ds.getConnectorNames')); }
    };
  }
  var extras = payload.extrasData || {};
  for (var k in extras) { if (Object.prototype.hasOwnProperty.call(extras, k)) { globalThis[k] = extras[k]; } }
  globalThis.__result = undefined;
};`;

const INVOKE_SRC =
  '__build(__dispatch, JSON.parse(__payloadJson));' +
  'delete globalThis.__build; delete globalThis.__dispatch; delete globalThis.__payloadJson;';

/** `k`: undefined, an HL7 handle, an X12 handle, or JSON data. */
interface Collected { readonly k: 'u' | 'h' | 'x' | 'j'; readonly v?: unknown }

interface CollectedResult {
  readonly err?: string;
  readonly r: Collected;
  readonly m: Collected;
  readonly maps: ExecutionResult['mapUpdates'];
}

function restore(state: HostBridgeState, c: Collected): unknown {
  if (c.k === 'u') return undefined;
  if (c.k === 'h') return state.hl7Handles.get(c.v as number);
  if (c.k === 'x') return state.x12Handles.get(c.v as number);
  return c.v;
}

/**
 * Script code runs inside sandbox-side try/catch blocks, but a script that replaces a built-in
 * those blocks use (`Promise.prototype.then`, `Object.prototype.toJSON`) can throw past them, so
 * `e` may be any value it made. Only its own `message` data property is read, and no `instanceof`:
 * that would run a Proxy's getPrototypeOf trap with nothing to stop it.
 */
function toHostError(e: unknown): Error {
  return new Error(thrownText(e, 'Script failed'));
}

interface TimeLimit {
  readonly deadline: number;
  readonly ms: number;
}

function timedOut(limit: TimeLimit): Error {
  return new Error(`Script execution timed out after ${String(limit.ms)}ms`);
}

function awaitWithSignal<T>(p: Promise<T>, signal: AbortSignal, aborted: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const onAbort = (): void => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/**
 * The context uses `microtaskMode: 'afterEvaluate'`, so sandbox microtasks run only inside a
 * timed `runInContext` call (the first evaluation or a `__settle()`): code after an `await` is
 * bounded by the timeout, and no sandbox code resumes once the run is finished.
 *
 * Every timed call starts and joins a watchdog thread, which on a busy machine waits to be
 * scheduled, so ready IO results are settled together on the next event-loop turn, not one
 * call each: a script with hundreds of reads must not spend its limit entering the sandbox (#188).
 */
class AsyncRun {
  private readonly ioResults: Array<[number, string]> = [];
  private nextTicket = 1;
  private finished = false;
  private settleScheduled = false;
  private resolveDone!: () => void;
  private rejectDone!: (e: unknown) => void;
  readonly done = new Promise<void>((resolve, reject) => { this.resolveDone = resolve; this.rejectDone = reject; });

  /** Set by `start`; no IO can complete before the script has started. */
  private limit: TimeLimit = { deadline: 0, ms: 0 };

  constructor(private readonly contextObj: vm.Context) {}

  start(limit: TimeLimit): void {
    this.limit = limit;
  }

  wrap(dispatch: (op: string, ...args: unknown[]) => unknown): (op: string, ...args: unknown[]) => unknown {
    return (op: string, ...args: unknown[]): unknown => {
      if (op === 'io.next') {
        const next = this.ioResults.shift();
        return next === undefined ? '' : JSON.stringify(next);
      }
      if (op === 'io.done') { this.finish(args[0] === true ? undefined : new Error(String(args[1])), args[0] === true); return undefined; }
      const out = dispatch(op, ...args);
      if (!(out instanceof Promise)) return out;
      if (this.finished) throw new Error('Script execution has already finished');
      const ticket = this.nextTicket++;
      void (out as Promise<string>).then((json) => this.settle(ticket, json));
      return ticket;
    };
  }

  finish(error: unknown, ok: boolean): void {
    if (this.finished) return;
    this.finished = true;
    if (ok) this.resolveDone(); else this.rejectDone(error);
  }

  private settle(ticket: number, json: string): void {
    if (this.finished) return;
    this.ioResults.push([ticket, json]);
    if (this.settleScheduled) return;
    this.settleScheduled = true;
    setImmediate(() => { this.settleReady(); });
  }

  private settleReady(): void {
    this.settleScheduled = false;
    if (this.finished) return;
    try {
      runTimed('__settle()', this.contextObj, this.limit);
    } catch (e) {
      this.finish(e, false);
    }
  }
}

/** node:vm makes its timeout error in the sandbox realm, so it is matched by its own `code`. */
function isVmTimeout(e: unknown): boolean {
  return ownString(e, 'code') === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
}

/**
 * A timeout names the whole limit, not the few milliseconds this call had left. With
 * `displayErrors`, Node would read and write the `stack` of an error after the limit stopped
 * counting, running the script's accessors for it.
 */
function runTimed(code: string, contextObj: vm.Context, limit: TimeLimit): unknown {
  const left = limit.deadline - Date.now();
  if (left <= 0) throw timedOut(limit);
  try {
    return vm.runInContext(code, contextObj, { timeout: left, displayErrors: false }) as unknown;
  } catch (e) {
    throw isVmTimeout(e) ? timedOut(limit) : toHostError(e);
  }
}

function limitFromNow(ms: number): TimeLimit {
  return { deadline: Date.now() + ms, ms };
}

/**
 * Has a limit of its own, so a script that finished in time is never reported as timed out
 * because a busy host reached its result late (D-323). The limit still stops a looping toJSON
 * or getter in the result.
 */
function collect(contextObj: vm.Context, ms: number): CollectedResult {
  const out = runTimed('__collect()', contextObj, limitFromNow(ms));
  if (typeof out !== 'string') throw new Error('Script result could not be read');
  const parsed = JSON.parse(out) as CollectedResult;
  if (parsed.err !== undefined) throw new Error(parsed.err);
  return parsed;
}

/**
 * Not contextified: node:vm would otherwise look a missing global up on a host object. Without code
 * from strings, the only code in the context is the bootstrap's and the script's own text, so what
 * the script may not contain cannot be built at run time either.
 */
function createSandboxGlobal(): vm.Context {
  return vm.createContext(vm.constants.DONT_CONTEXTIFY, {
    microtaskMode: 'afterEvaluate',
    codeGeneration: { strings: false, wasm: false },
  });
}

/** Hardened node:vm, not isolated-vm (D-018). */
export class VmSandboxExecutor implements SandboxExecutor {
  private readonly deps: BridgeDependencies | undefined;

  constructor(deps?: BridgeDependencies) {
    this.deps = deps;
  }

  async execute(
    script: CompiledScript,
    context: SandboxContext,
    options: ExecutionOptions,
  ): Promise<Result<ExecutionResult>> {
    return tryCatch(async () => {
      if (options.signal?.aborted) {
        throw new Error('Execution aborted before start');
      }

      const state: HostBridgeState = {
        logs: [],
        bridges: createBridgeFunctions(this.deps),
        hl7Handles: new Map(),
        x12Handles: new Map(),
        destSet: context.extras?.['destinationSet'] as Record<string, unknown> | undefined,
        nextHandle: 1,
        failure: undefined,
      };
      const dispatch = makeHostDispatch(state);
      const errToken = `__host_error_${randomUUID()}__`;
      const payload = buildPayload(state, context, this.deps, errToken);

      const hasAsyncBridges = Boolean(
        this.deps?.httpFetch || this.deps?.dbQuery || this.deps?.routeMessage || this.deps?.getResource || this.deps?.collections,
      );
      const contextObj = createSandboxGlobal();
      const run = new AsyncRun(contextObj);
      contextObj['__dispatch'] = makeNonThrowingDispatch(run.wrap(dispatch), errToken);
      contextObj['__payloadJson'] = JSON.stringify(payload);
      // Building the globals has a limit of its own and the script's starts when the
      // script does, so one execute can take the setup time plus the limit (D-300).
      const setup = limitFromNow(options.timeout);
      runTimed(BOOTSTRAP_SRC, contextObj, setup);
      runTimed(INVOKE_SRC, contextObj, setup);

      // Each script gets its own wall-clock limit. A caller's signal can cancel
      // it sooner, but can never let it run longer than `timeout`.
      const limit = limitFromNow(options.timeout);
      const expiry = AbortSignal.timeout(options.timeout);
      const signal = options.signal ? AbortSignal.any([options.signal, expiry]) : expiry;
      run.start(limit);

      const code = withoutDynamicImport(script.code);
      const wrappedCode = hasAsyncBridges
        ? `'use strict'; __watch((async function() {\n${code}\n})());`
        : `'use strict'; __run(function() {\n${code}\n});`;

      try {
        runTimed(wrappedCode, contextObj, limit);
        if (state.failure !== undefined) throw new Error(state.failure);
        if (hasAsyncBridges) {
          await awaitWithSignal(run.done, signal, () => (expiry.aborted ? timedOut(limit) : new Error('Script execution timed out')));
        }
      } finally {
        run.finish(undefined, true);
      }

      const collected = collect(contextObj, options.timeout);
      return {
        returnValue: restore(state, collected.r),
        msg: restore(state, collected.m),
        mapUpdates: collected.maps,
        logs: state.logs,
      };
    });
  }

  dispose(): void {}
}
