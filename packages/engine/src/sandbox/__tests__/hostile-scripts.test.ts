// What a script does near the stack limit must not hand it a server-realm error, and nothing it
// leaves behind may run or fail outside its own timed calls (D-333).
// A regression hangs or kills whatever runs the script, hence the child processes.

import { describe, it, expect, beforeAll } from 'vitest';
import type { HostileCase, HostileRun } from './support/hostile-script-child.js';
import { CHILD_HOOK_TIMEOUT_MS, runHostileScripts, type ChildRun } from './support/hostile-run.js';

/** For scripts that must finish; only a hang reaches it. */
const FAR_TIMEOUT = 15_000;
const LOOP_TIMEOUT = 300;

interface Expected {
  readonly case: HostileCase;
  /** Exactly the script's outcome: its error text, or `returned: <value>`. */
  readonly outcome: string | RegExp;
}

function returns(name: string, script: string, value: string): Expected {
  return { case: { name, script, timeout: FAR_TIMEOUT, aftermath: true }, outcome: `returned: ${value}` };
}

function fails(name: string, script: string, error: string | RegExp, timeout = FAR_TIMEOUT): Expected {
  return { case: { name, script, timeout, aftermath: true }, outcome: error };
}

/** Calls `body` at every depth down to the stack limit; returns 'sandbox', or what a foreign error gives away. */
function atEveryDepth(body: string): string {
  return `
    var seen = 'sandbox';
    function look(e) {
      if (e instanceof Error) { return; }
      try { seen = 'FOREIGN ' + e.constructor.constructor('return typeof process')(); } catch (x) { seen = 'FOREIGN'; }
    }
    function dive() {
      try { dive(); } catch (e) { look(e); }
      try { ${body} } catch (e) { look(e); }
    }
    dive();
    return seen;`;
}

const STACK_CASES: readonly Expected[] = [
  ['a log call', "logger.info('x');"],
  ['parseHL7', "parseHL7('MSH|^~\\\\&|A|B|C|D|1||ADT^A01|1|P|2.5');"],
  ['a refused bridge argument', 'parseHL7(123);'],
  ['a bridge call through a replaced apply', "Function.prototype.apply = function () { seen = 'LEAKED'; }; logger.info('x');"],
  ['an error stack', "new Error('x').stack;"],
  ['the stack of an engine error', 'try { null.x; } catch (e) { e.stack; }'],
  ['a captured stack', 'var o = {}; Error.captureStackTrace(o); o.stack;'],
  ['a raised stack trace limit', "try { Error.stackTraceLimit = 5; } catch (e) { look(e); } new Error('x').stack;"],
  ['a redefined stack trace limit', "try { Object.defineProperty(Error, 'stackTraceLimit', { value: 5 }); } catch (e) { look(e); } new Error('x').stack;"],
  ['a deleted stack trace limit', "try { delete Error.stackTraceLimit; Error.stackTraceLimit = 5; } catch (e) { look(e); } new Error('x').stack;"],
  ['an inherited stack trace limit', "Function.prototype.stackTraceLimit = 5; Object.prototype.stackTraceLimit = 5; new Error('x').stack;"],
  ['a subclass error stack', "class Sub extends Error {} Sub.stackTraceLimit = 5; new Sub('x').stack;"],
  ['a rejected promise', 'Promise.reject(1).catch(function () {});'],
  ['a failed compile', "try { new Function('x'); } catch (e) { look(e); }"],
].map(([name, body]): Expected => ({
  case: { name: `at the stack limit: ${String(name)}`, script: atEveryDepth(String(body)), timeout: FAR_TIMEOUT },
  outcome: 'returned: sandbox',
}));

/** Makes the engine call the script's own function as a job, if a promise may choose its derived promise. */
function ownJob(thrown: string): string {
  return `
    function Own(executor) { var f = function () { throw ${thrown}; }; executor(f, f); }
    var p = Promise.resolve(1);
    p.constructor = { [Symbol.species]: Own };
    try { p.then(function () { return 1; }); } catch (ignored) {}`;
}

const LOOPING_TEXT = '{ toString() { for (;;) {} } }';
const LOOPING_JOB = 'Promise.resolve().then(function () {}).then(function () { for (;;) {} });';

const REMOVED = ['Proxy', 'WebAssembly', 'FinalizationRegistry', 'console'];

const LATE_CASES: readonly Expected[] = [
  ...REMOVED.map((name) => returns(`there is no ${name}`, `return typeof ${name} + ',' + typeof globalThis.${name};`, 'undefined,undefined')),
  fails('a compile that finishes after the script', "Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { for (;;) {} } }); WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return 1;", /WebAssembly is not defined$/),
  fails('a rejected promise under a looping object', 'var p = Promise.reject(1); Object.setPrototypeOf(p, new Proxy({}, { get() { for (;;) {} } })); return 1;', /Proxy is not defined$/),
  returns('a rejected promise whose named properties loop', "var p = Promise.reject(1); var loop = { get() { for (;;) {} } }; ['then', 'constructor', 'domain', 'message', 'stack', 'toString'].forEach(function (k) { Object.defineProperty(p, k, loop); }); return 1;", '1'),
  returns('a rejected promise whose well-known symbols loop', "var p = Promise.reject(1); Reflect.ownKeys(Symbol).forEach(function (k) { if (typeof Symbol[k] === 'symbol') { Object.defineProperty(p, Symbol[k], { get() { for (;;) {} } }); } }); return 1;", '1'),
  returns('a wait that ends after the script', "Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { for (;;) {} } }); Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20).value; return 1;", '1'),
  fails('a wait that never ends', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); return 1;', /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('a loop while a value is described, then a second loop', `try { console.log(${LOOPING_TEXT}); } catch (e) { throw new Error(e.message); } for (;;) {}`, /console is not defined$/),
];

const JOB_CASES: readonly Expected[] = [
  ...["new Error('boom')", "'plain text'", 'undefined', LOOPING_TEXT].map((thrown) =>
    returns(`an own job that would throw ${thrown}`, `${ownJob(thrown)} return 1;`, '1')),
  fails('an own job and then a loop', `${ownJob(LOOPING_TEXT)} ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('an own job of a promise that can only be extended', `${ownJob(LOOPING_TEXT).replace('p.constructor =', "Object.defineProperty(p, 'constructor', { value: 1 }); var ignoredSpecies =")} ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('an own job behind an accessor', `${ownJob(LOOPING_TEXT).replace('p.constructor = { [Symbol.species]: Own };', "var reads = 0; Object.defineProperty(p, 'constructor', { configurable: true, get() { reads += 1; return reads === 1 ? Promise : { [Symbol.species]: Own }; } });")} ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('an own job behind an accessor with a setter', `${ownJob(LOOPING_TEXT).replace('p.constructor = { [Symbol.species]: Own };', "Object.defineProperty(p, 'constructor', { configurable: true, get() { return { [Symbol.species]: Own }; }, set(v) {} });")} ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('an own job of a subclass', `class Own extends Promise { constructor(executor) { super(function (a, b) { executor(function () { throw ${LOOPING_TEXT}; }, function () { throw ${LOOPING_TEXT}; }); }); } } var p = Reflect.construct(Promise, [function (a) { a(1); }], Own); p.then(function () {}); p.finally(function () {}); p.catch(function () {}); ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('an own job through a changed species', `try { Object.defineProperty(Promise, Symbol.species, { get() { return function (executor) { var f = function () { throw ${LOOPING_TEXT}; }; executor(f, f); }; } }); } catch (ignored) {} Promise.resolve(1).then(function () {}); ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('an own job awaited', `${ownJob(LOOPING_TEXT)} (async function () { await p; })(); (async function () { for await (var x of [p]) {} })(); Promise.all([p]); ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
  fails('an own job after the descriptor keys are poisoned', `Object.defineProperty(Object.prototype, 'get', { configurable: true, value: 1 }); delete Object.prototype.get; Object.prototype.writable = true; Object.prototype.configurable = true; ${ownJob(LOOPING_TEXT)} ${LOOPING_JOB} return 1;`, /^Script execution timed out after 300ms$/, LOOP_TIMEOUT),
];

const AFTER_AWAIT = "await getResource('a');";
/** A script to be stopped must not have given its result before its jobs are, so it waits for nothing instead. */
function afterAwait(e: Expected): Expected {
  const script = e.outcome instanceof RegExp ? e.case.script.replace(/return 1;$/, 'await new Promise(function () {});') : e.case.script;
  return { ...e, case: { ...e.case, script: `${AFTER_AWAIT} ${script}` } };
}

const CASES: Readonly<Record<HostileRun['mode'], readonly Expected[]>> = {
  sync: [...STACK_CASES, ...LATE_CASES, ...JOB_CASES],
  async: [...STACK_CASES, ...LATE_CASES, ...JOB_CASES].map(afterAwait),
  // Each starts a worker, so only what differs there: its stack size, and Node's own copies in it.
  isolated: [...STACK_CASES, ...LATE_CASES, ...JOB_CASES].filter((e) => [
    'at the stack limit: a log call', 'at the stack limit: an error stack', 'at the stack limit: a captured stack',
    'a compile that finishes after the script', 'a rejected promise under a looping object', 'an own job and then a loop',
  ].includes(e.case.name)),
};

function shown(child: ChildRun, name: string): string {
  const outcome = child.outcomes.get(name);
  if (outcome === undefined) return `no outcome: the process ${child.end}`;
  return outcome.error ?? `returned: ${String(outcome.returned)}`;
}

describe.each(Object.entries(CASES) as Array<[HostileRun['mode'], readonly Expected[]]>)('a hostile script in a %s run', (mode, expected) => {
  let child: ChildRun;

  beforeAll(async () => { child = await runHostileScripts(mode, expected.map((e) => e.case)); }, CHILD_HOOK_TIMEOUT_MS);

  it.each(expected.map((e): [string, string | RegExp] => [e.case.name, e.outcome]))('%s', (name, outcome) => {
    if (typeof outcome === 'string') expect(shown(child, name)).toBe(outcome);
    else expect(shown(child, name)).toMatch(outcome);
  });

  it('leaves the process running', () => {
    expect(child.end).toBe('exited normally');
  });
});
