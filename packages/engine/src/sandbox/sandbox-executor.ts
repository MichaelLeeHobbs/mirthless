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

import * as vm from 'node:vm';
import type { Result } from '@mirthless/core-util';
import { tryCatch } from '@mirthless/core-util';
import type { SandboxContext, LogEntry } from './sandbox-context.js';
import { createBridgeFunctions, type BridgeDependencies, type BridgeFunctions, type Hl7MessageProxy, type HttpFetchOptions, type CollectionScalar, type CollectionStoreOptions, type CollectionFindOptions } from './bridge-functions.js';
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
    case 'hl7.get': return proxy.get(args[1] as string);
    case 'hl7.set': proxy.set(args[1] as string, args[2] as string); return undefined;
    case 'hl7.delete': proxy.delete(args[1] as string); return undefined;
    case 'hl7.toString': return proxy.toString();
    case 'hl7.messageType': return proxy.messageType;
    case 'hl7.controlId': return proxy.messageControlId;
    case 'hl7.segCount': return proxy.getSegmentCount(args[1] as string);
    case 'hl7.segString': return proxy.getSegmentString(args[1] as string, args[2] as number | undefined);
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
    case 'ds.remove': call('remove', args[0]); return undefined;
    case 'ds.removeAllExcept': call('removeAllExcept', args[0]); return undefined;
    case 'ds.add': call('add', args[0]); return undefined;
    case 'ds.contains': return call('contains', args[0]);
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
      case 'parseHL7': return registerHl7(state, bridges.parseHL7(args[0] as string));
      case 'createACK': return bridges.createACK(args[0] as string, args[1] as string, args[2] as string | undefined);
      case 'httpFetch': return ioDispatch(() => bridges.httpFetch!(args[0] as string, args[1] as HttpFetchOptions));
      case 'dbQuery': return ioDispatch(() => bridges.dbQuery!(args[0] as string, args[1] as string, args[2] as readonly unknown[]));
      case 'routeMessage': return ioDispatch(() => bridges.routeMessage!(args[0] as string, args[1] as string));
      case 'getResource': return ioDispatch(() => bridges.getResource!(args[0] as string));
      case 'collectionStore': return ioDispatch(() => bridges.collections!.store(
        args[0] as string,
        args[1] as Record<string, CollectionScalar>,
        args[2] as string,
        args[3] as CollectionStoreOptions,
      ));
      case 'collectionFind': return ioDispatch(() => bridges.collections!.find(
        args[0] as string,
        args[1] as Record<string, CollectionScalar>,
        args[2] as CollectionFindOptions,
      ));
      default: return undefined;
    }
  };
}

// ----- Payload -----

/** Serializable payload injected into the sandbox and rebuilt in-realm by the bootstrap. */
interface SandboxPayload {
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

function buildPayload(state: HostBridgeState, context: SandboxContext, deps: BridgeDependencies | undefined): SandboxPayload {
  const msgIsHl7 = isHl7MessageProxy(context.msg);
  const tmpIsHl7 = isHl7MessageProxy(context.tmp);
  const extrasData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context.extras ?? {})) {
    if (k !== 'destinationSet') extrasData[k] = v;
  }
  return {
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
globalThis.__build = function (dispatch, payload) {
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
      function (e) { dispatch('io.done', false, e); }
    );
  } });
  function makeHl7(handle) {
    return {
      __hl7Proxy: true,
      __handle: handle,
      get: function (p) { return dispatch('hl7.get', handle, p); },
      set: function (p, v) { dispatch('hl7.set', handle, p, v); },
      delete: function (p) { dispatch('hl7.delete', handle, p); },
      toString: function () { return dispatch('hl7.toString', handle); },
      messageType: dispatch('hl7.messageType', handle),
      messageControlId: dispatch('hl7.controlId', handle),
      getSegmentCount: function (n) { return dispatch('hl7.segCount', handle, n); },
      getSegmentString: function (n, i) { return dispatch('hl7.segString', handle, n, i); }
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
    info: function (m) { dispatch('log', 'INFO', String(m)); },
    warn: function (m) { dispatch('log', 'WARN', String(m)); },
    error: function (m) { dispatch('log', 'ERROR', String(m)); },
    debug: function (m) { dispatch('log', 'DEBUG', String(m)); }
  };
  globalThis.parseHL7 = function (raw) {
    if (raw && typeof raw === 'object' && raw.__hl7Proxy === true) { return raw; }
    return makeHl7(dispatch('parseHL7', raw));
  };
  globalThis.createACK = function (originalRaw, ackCode, textMessage) {
    return dispatch('createACK', originalRaw, ackCode, textMessage);
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
      var r = JSON.parse(await io('httpFetch', url, options || {}));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.dbQuery) {
    globalThis.dbQuery = async function (dataSourceName, sqlText, params) {
      var r = JSON.parse(await io('dbQuery', dataSourceName, sqlText, params || []));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.routeMessage) {
    globalThis.routeMessage = async function (channelName, data) {
      var r = JSON.parse(await io('routeMessage', channelName, data));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.getResource) {
    globalThis.getResource = async function (name) {
      var r = JSON.parse(await io('getResource', name));
      if (!r.ok) { throw new Error(r.e); }
      return r.v;
    };
  }
  if (payload.bridges.getCollection) {
    globalThis.getCollection = function (name) {
      return {
        store: async function (fields, payload, options) {
          var r = JSON.parse(await io('collectionStore', name, fields || {}, String(payload == null ? '' : payload), options || {}));
          if (!r.ok) { throw new Error(r.e); }
          return r.v;
        },
        find: async function (match, options) {
          var r = JSON.parse(await io('collectionFind', name, match || {}, options || {}));
          if (!r.ok) { throw new Error(r.e); }
          return r.v;
        }
      };
    };
  }
  if (payload.hasDestinationSet) {
    globalThis.destinationSet = {
      removeAll: function () { dispatch('ds.removeAll'); },
      remove: function (n) { dispatch('ds.remove', n); },
      removeAllExcept: function (n) { dispatch('ds.removeAllExcept', n); },
      add: function (n) { dispatch('ds.add', n); },
      contains: function (n) { return dispatch('ds.contains', n); },
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

/** Convert a returned sandbox HL7 wrapper back to the host proxy (so serialization/host code works). */
function unwrap(state: HostBridgeState, value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (rec['__hl7Proxy'] === true && typeof rec['__handle'] === 'number') {
      return state.hl7Handles.get(rec['__handle']) ?? value;
    }
  }
  return value;
}

/** Resolve a promise, rejecting early if the abort signal fires (async wall-clock timeout). */
function awaitWithSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Script execution timed out')); return; }
    const onAbort = (): void => reject(new Error('Script execution timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e instanceof Error ? e : new Error(String(e))); },
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
      if (op === 'io.done') { this.finish(args[0] === true ? undefined : args[1], args[0] === true); return undefined; }
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
      this.finish(e, false);
    }
  }
}

// ----- VM Implementation -----

/**
 * Node.js vm-based sandbox executor.
 *
 * All host data and functions are re-materialized inside the vm context so user
 * scripts cannot reach the host realm (see the security model at the top of this
 * file and ./README.md). isolated-vm is not used because it does not build on
 * Windows/Node 24 in this project; this executor hardens node:vm instead.
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
      const signal = options.signal ?? AbortSignal.timeout(options.timeout);
      if (signal.aborted) {
        throw new Error('Execution aborted before start');
      }

      const state: HostBridgeState = {
        logs: [],
        bridges: createBridgeFunctions(this.deps),
        hl7Handles: new Map(),
        destSet: context.extras?.['destinationSet'] as Record<string, unknown> | undefined,
        nextHandle: 1,
      };
      const dispatch = makeHostDispatch(state);
      const payload = buildPayload(state, context, this.deps);

      const hasAsyncBridges = Boolean(
        this.deps?.httpFetch || this.deps?.dbQuery || this.deps?.routeMessage || this.deps?.getResource || this.deps?.collections,
      );
      const contextObj: Record<string, unknown> = vm.createContext({}, { microtaskMode: 'afterEvaluate' });
      const run = new AsyncRun(contextObj, Date.now() + options.timeout);
      contextObj['__dispatch'] = run.wrap(dispatch);
      contextObj['__payloadJson'] = JSON.stringify(payload);
      vm.runInContext(BOOTSTRAP_SRC, contextObj, { timeout: options.timeout });
      vm.runInContext(INVOKE_SRC, contextObj, { timeout: options.timeout });

      const wrappedCode = hasAsyncBridges
        ? `'use strict'; __watch((async function() {\n${script.code}\n})());`
        : `'use strict'; __result = (function() {\n${script.code}\n})();`;

      try {
        vm.runInContext(wrappedCode, contextObj, { timeout: options.timeout });
        if (hasAsyncBridges) {
          // Wait for the script to settle, enforcing the wall-clock timeout via the signal.
          await awaitWithSignal(run.done, signal);
        }
      } finally {
        run.finish(undefined, true);
      }

      return {
        returnValue: unwrap(state, contextObj['__result']),
        msg: unwrap(state, contextObj['msg']),
        mapUpdates: {
          channelMap: (contextObj['channelMap'] as Record<string, unknown>) ?? {},
          connectorMap: (contextObj['connectorMap'] as Record<string, unknown>) ?? {},
          globalChannelMap: (contextObj['globalChannelMap'] as Record<string, unknown>) ?? {},
          globalMap: (contextObj['globalMap'] as Record<string, unknown>) ?? {},
        },
        logs: state.logs,
      };
    });
  }

  dispose(): void {
    // No resources to release for vm-based executor.
  }
}
