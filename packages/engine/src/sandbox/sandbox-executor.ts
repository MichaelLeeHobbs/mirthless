// ===========================================
// Sandbox Executor
// ===========================================
// Interface for safe JavaScript execution and a Node.js vm-based implementation.
//
// SECURITY MODEL (see ./README.md):
// node:vm is NOT a hard security boundary, but the classic escape
// (`someHostFn.constructor('return process')()`) only works when a user script
// can reach a *host-realm* function or object. This executor therefore exposes
// NOTHING from the host realm to user code:
//   * All data (msg, tmp, maps, sourceMap, configMap) is injected by serializing
//     it to JSON and re-parsing it INSIDE the vm context, so every object/array
//     the script can touch has the sandbox realm's prototype chain.
//   * All bridge functions (logger, parseHL7, createACK, $, $r, $g, $gc, IO
//     bridges, destinationSet, HL7 message proxy) are re-implemented as
//     sandbox-realm functions in a bootstrap script; they call a single host
//     dispatch function that is captured in a closure and then deleted from the
//     global scope, so it is never reachable as a property from user code.
// Result: `logger.info.constructor`, `({}).constructor.constructor`,
// `this.constructor.constructor`, `msg.get.constructor`, etc. all resolve to the
// sandbox realm's Function, which — when invoked — runs in a context with no
// `process`, `require`, `module`, or `globalThis`-host access.
//
// The boundary is closed in BOTH directions:
//   * Script -> host: every bridge wrapper turns its arguments into primitives
//     (String(), Number(), or a JSON string) INSIDE the sandbox, and the host
//     dispatch refuses anything that is not a primitive. Host code therefore
//     never calls a method on an object a script built, which would hand the
//     script a host-realm argument (`value.replace(hostRegExp)`).
//   * Host <- script: the return value, `msg` and the maps are serialised to one
//     JSON string inside the sandbox, under the script timeout, and parsed on the
//     host. The host never walks a sandbox object, so a `toJSON`, getter or
//     `toString` a script wrote cannot run outside the time limit.

import * as vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import type { Result } from '@galvaniflow/core-util';
import { tryCatch } from '@galvaniflow/core-util';
import type { SandboxContext, LogEntry } from './sandbox-context.js';
import { createBridgeFunctions, type BridgeDependencies, type BridgeFunctions, type Hl7MessageProxy, type HttpFetchOptions, type CollectionScalar, type CollectionStoreOptions, type CollectionFindOptions, type CollectionUpdateChanges } from './bridge-functions.js';
import { isHl7MessageProxy } from '../pipeline/data-type-handler.js';

// ----- Types -----

/** A compiled script ready for execution. */
export interface CompiledScript {
  readonly code: string;
  readonly sourceMap?: string;
}

/** Options for script execution. */
export interface ExecutionOptions {
  /** Wall-clock timeout in milliseconds for both synchronous and async work. */
  readonly timeout: number;
  /** Optional abort signal. A fresh signal is created from `timeout` if omitted. */
  readonly signal?: AbortSignal | undefined;
}

/** Result of executing a script in the sandbox. */
export interface ExecutionResult {
  readonly returnValue: unknown;
  /** The value of `msg` after script execution (used by transformers). */
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

/** Default execution options (signal created fresh per execution). */
export const DEFAULT_EXECUTION_OPTIONS: ExecutionOptions = {
  timeout: 30_000,
} as const;

// ----- Interface -----

/** Sandbox executor interface. Implementations provide script isolation. */
export interface SandboxExecutor {
  /** Execute a compiled script with the given context. */
  execute(
    script: CompiledScript,
    context: SandboxContext,
    options: ExecutionOptions,
  ): Promise<Result<ExecutionResult>>;

  /** Release all resources held by this executor. */
  dispose(): void;
}

// ----- Host bridge state -----

/** Per-execution host-side state backing the sandbox's bridge functions. */
interface HostBridgeState {
  readonly logs: LogEntry[];
  readonly bridges: BridgeFunctions;
  readonly hl7Handles: Map<number, Hl7MessageProxy>;
  readonly destSet: Record<string, unknown> | undefined;
  nextHandle: number;
  /** Message of the error the script threw, reported from inside the sandbox. */
  failure: string | undefined;
}

/** A bridge argument that must be a string. Sandbox wrappers already convert; this is the host's own check. */
function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Bridge argument must be a string');
  return value;
}

/** A bridge argument that is a string or absent. */
function optStr(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : str(value);
}

/** Parse a JSON-encoded bridge argument into a host-realm value. */
function fromJson(value: unknown): unknown {
  return JSON.parse(str(value)) as unknown;
}

/** Parse a JSON-encoded bridge argument that must be a plain object. */
function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = fromJson(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Bridge argument must be an object');
  }
  return parsed as Record<string, unknown>;
}

/** Parse a JSON-encoded bridge argument that must be an array. */
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

/** Dispatch HL7 message-proxy method calls to the host-side proxy. */
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

/** Dispatch destinationSet method calls to the host-side proxy. Object/array results are JSON-encoded. */
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

/** Run an async IO bridge and encode success/failure as a JSON string so no host object crosses the boundary. */
async function ioDispatch(fn: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify({ ok: true, v: await fn() });
  } catch (e) {
    return JSON.stringify({ ok: false, e: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Make a dispatch function that can never throw into the sandbox.
 *
 * An Error thrown by host code is a host-realm object: a script that catches it can
 * reach the host `Function` through `e.constructor.constructor` and from there
 * `process`. So a failure is recorded on the host and reported as `errToken`, a
 * random string only this execution knows. The sandbox wrapper sees the token, asks
 * for the message with `err.take`, and throws a sandbox-realm Error.
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

/** Build the single host dispatch function invoked by every sandbox bridge. */
function makeHostDispatch(state: HostBridgeState): (op: string, ...args: unknown[]) => unknown {
  const { bridges } = state;
  return (op: string, ...args: unknown[]): unknown => {
    if (op.startsWith('hl7.')) return hl7Op(state, op, args);
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

// ----- Payload -----

/** Serializable payload injected into the sandbox and rebuilt in-realm by the bootstrap. */
interface SandboxPayload {
  /** Value the host dispatch returns in place of throwing (see makeNonThrowingDispatch). */
  readonly errToken: string;
  readonly rawData: string;
  readonly msgKind: 'hl7' | 'data';
  readonly msgVal: unknown;
  readonly tmpKind: 'hl7' | 'data';
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
  const msgIsHl7 = isHl7MessageProxy(context.msg);
  const tmpIsHl7 = isHl7MessageProxy(context.tmp);
  const extrasData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context.extras ?? {})) {
    if (k !== 'destinationSet') extrasData[k] = v;
  }
  return {
    errToken,
    rawData: context.rawData,
    msgKind: msgIsHl7 ? 'hl7' : 'data',
    msgVal: msgIsHl7 ? registerHl7(state, context.msg as Hl7MessageProxy) : context.msg,
    tmpKind: tmpIsHl7 ? 'hl7' : 'data',
    tmpVal: tmpIsHl7 ? registerHl7(state, context.tmp as Hl7MessageProxy) : context.tmp,
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

// ----- Bootstrap (runs INSIDE the vm context; every function it defines is sandbox-realm) -----

const BOOTSTRAP_SRC = `'use strict';
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
  function dispatch() {
    var out = hostDispatch.apply(null, arguments);
    if (out === errToken) { throw new Error(hostDispatch('err.take')); }
    return out;
  }
  // IO bridges: the host returns a ticket id synchronously and later settles it by
  // running __settle() in this context. Awaiting a sandbox-realm promise keeps every
  // continuation on this context's microtask queue, which only drains inside a
  // timed runInContext call, so post-await code is bounded by the script timeout.
  var pendingIo = {};
  function io() {
    var id = dispatch.apply(null, arguments);
    return new Promise(function (resolve) { pendingIo[id] = resolve; });
  }
  Object.defineProperty(globalThis, '__settle', { value: function () {
    var t = JSON.parse(dispatch('io.next'));
    var resolve = pendingIo[t[0]];
    delete pendingIo[t[0]];
    if (resolve) { resolve(t[1]); }
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
  globalThis.rawData = payload.rawData;
  globalThis.channelMap = payload.channelMap;
  globalThis.connectorMap = payload.connectorMap;
  globalThis.globalChannelMap = payload.globalChannelMap;
  globalThis.globalMap = payload.globalMap;
  globalThis.responseMap = payload.responseMap;
  globalThis.sourceMap = payload.sourceMap;
  globalThis.configMap = Object.freeze(payload.configMap);
  globalThis.msg = payload.msgKind === 'hl7' ? makeHl7(payload.msgVal) : payload.msgVal;
  globalThis.tmp = payload.tmpKind === 'hl7' ? makeHl7(payload.tmpVal) : payload.tmpVal;
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

// ----- Helpers -----

/** One value handed back by `__collect`: undefined, an HL7 handle, or JSON data. */
interface Collected { readonly k: 'u' | 'h' | 'j'; readonly v?: unknown }

/** Everything `__collect` returns, already parsed into host-realm objects. */
interface CollectedResult {
  readonly err?: string;
  readonly r: Collected;
  readonly m: Collected;
  readonly maps: ExecutionResult['mapUpdates'];
}

/** Turn a collected value back into what host code expects (HL7 handle -> host proxy). */
function restore(state: HostBridgeState, c: Collected): unknown {
  if (c.k === 'u') return undefined;
  if (c.k === 'h') return state.hl7Handles.get(c.v as number);
  return c.v;
}

/**
 * Convert something thrown out of `vm.runInContext` into a host Error.
 *
 * Script code runs inside sandbox-side try/catch blocks, so what reaches here was
 * made by V8 (a timeout, a syntax error) or by the bootstrap. It is still a
 * sandbox-realm object, so only its own `message` data property is read: no
 * getter, prototype lookup or `toString` a script could have replaced.
 */
function toHostError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e);
  if (e !== null && typeof e === 'object' && !types.isProxy(e)) {
    const message = Object.getOwnPropertyDescriptor(e, 'message')?.value as unknown;
    if (typeof message === 'string') return new Error(message);
  }
  return new Error('Script failed');
}

/** Resolve a promise, rejecting early if the abort signal fires (async wall-clock timeout). */
function awaitWithSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Script execution timed out')); return; }
    const onAbort = (): void => reject(new Error('Script execution timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(toHostError(e)); },
    );
  });
}

/**
 * Drives one async script run. The vm context uses `microtaskMode: 'afterEvaluate'`,
 * so sandbox microtasks only run inside a timed `runInContext` call: the initial
 * evaluation, or a `__settle()` call made when an IO bridge completes. Code after an
 * `await` is therefore bounded by the timeout and cannot block the host event loop,
 * and once the run is finished no further sandbox code is ever resumed.
 */
class AsyncRun {
  private readonly ioResults: Array<[number, string]> = [];
  private nextTicket = 1;
  private finished = false;
  private resolveDone!: () => void;
  private rejectDone!: (e: unknown) => void;
  readonly done = new Promise<void>((resolve, reject) => { this.resolveDone = resolve; this.rejectDone = reject; });

  constructor(private readonly contextObj: vm.Context, private readonly deadline: number) {}

  /** Wrap the host dispatch so IO bridge promises become ticket ids settled in-context. */
  wrap(dispatch: (op: string, ...args: unknown[]) => unknown): (op: string, ...args: unknown[]) => unknown {
    return (op: string, ...args: unknown[]): unknown => {
      if (op === 'io.next') return JSON.stringify(this.ioResults.shift() ?? [0, '']);
      if (op === 'io.done') { this.finish(args[0] === true ? undefined : new Error(String(args[1])), args[0] === true); return undefined; }
      const out = dispatch(op, ...args);
      if (!(out instanceof Promise)) return out;
      if (this.finished) throw new Error('Script execution has already finished');
      const ticket = this.nextTicket++;
      void (out as Promise<string>).then((json) => this.settle(ticket, json));
      return ticket;
    };
  }

  /** Mark the run finished; later IO completions are discarded and never resume the script. */
  finish(error: unknown, ok: boolean): void {
    if (this.finished) return;
    this.finished = true;
    if (ok) this.resolveDone(); else this.rejectDone(error);
  }

  private settle(ticket: number, json: string): void {
    if (this.finished) return;
    this.ioResults.push([ticket, json]);
    try {
      vm.runInContext('__settle()', this.contextObj, { timeout: Math.max(1, this.deadline - Date.now()) });
    } catch (e) {
      this.finish(toHostError(e), false);
    }
  }
}

/** Run code in the sandbox context under a time limit; anything thrown becomes a host Error. */
function runTimed(code: string, contextObj: vm.Context, timeout: number): unknown {
  try {
    return vm.runInContext(code, contextObj, { timeout: Math.max(1, timeout) }) as unknown;
  } catch (e) {
    throw toHostError(e);
  }
}

/** Serialise the script's result inside the sandbox (still under the deadline) and parse it on the host. */
function collect(contextObj: vm.Context, deadline: number): CollectedResult {
  const out = runTimed('__collect()', contextObj, deadline - Date.now());
  if (typeof out !== 'string') throw new Error('Script result could not be read');
  const parsed = JSON.parse(out) as CollectedResult;
  if (parsed.err !== undefined) throw new Error(parsed.err);
  return parsed;
}

// ----- VM Implementation -----

/**
 * Node.js vm-based sandbox executor.
 *
 * All host data and functions are re-materialized inside the vm context so user
 * scripts cannot reach the host realm (see the security model at the top of this
 * file and ./README.md). isolated-vm is not used (it did not build on
 * Windows/Node 24 in this project); this executor hardens node:vm instead.
 */
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
      // Each script gets its own wall-clock limit. A caller's signal can cancel
      // it sooner, but can never let it run longer than `timeout`.
      const limit = AbortSignal.timeout(options.timeout);
      const signal = options.signal ? AbortSignal.any([options.signal, limit]) : limit;
      if (signal.aborted) {
        throw new Error('Execution aborted before start');
      }

      const state: HostBridgeState = {
        logs: [],
        bridges: createBridgeFunctions(this.deps),
        hl7Handles: new Map(),
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
      const contextObj: Record<string, unknown> = vm.createContext({}, { microtaskMode: 'afterEvaluate' });
      const deadline = Date.now() + options.timeout;
      const run = new AsyncRun(contextObj, deadline);
      contextObj['__dispatch'] = makeNonThrowingDispatch(run.wrap(dispatch), errToken);
      contextObj['__payloadJson'] = JSON.stringify(payload);
      vm.runInContext(BOOTSTRAP_SRC, contextObj, { timeout: options.timeout });
      vm.runInContext(INVOKE_SRC, contextObj, { timeout: options.timeout });

      const wrappedCode = hasAsyncBridges
        ? `'use strict'; __watch((async function() {\n${script.code}\n})());`
        : `'use strict'; __run(function() {\n${script.code}\n});`;

      try {
        runTimed(wrappedCode, contextObj, options.timeout);
        if (state.failure !== undefined) throw new Error(state.failure);
        if (hasAsyncBridges) {
          // Wait for the script to settle, enforcing the wall-clock timeout via the signal.
          await awaitWithSignal(run.done, signal);
        }
      } finally {
        run.finish(undefined, true);
      }

      const collected = collect(contextObj, deadline);
      return {
        returnValue: restore(state, collected.r),
        msg: restore(state, collected.m),
        mapUpdates: collected.maps,
        logs: state.logs,
      };
    });
  }

  dispose(): void {
    // No resources to release for vm-based executor.
  }
}
