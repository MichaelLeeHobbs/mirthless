// A script that goes over its limit, or whose error leaves the sandbox, must cost only itself.
// Node writes `code` on the timeout error and can read `stack` on any other, and the host sorts
// what it catches: none of that may run a setter, getter or Proxy trap the script installed, since
// nothing would stop it, and a setter that throws there aborts the process (GHSA-wcf2-qg2x-jmff).
// A regression hangs or kills whatever runs the script, hence the child processes.

import { describe, it, expect, beforeAll } from 'vitest';
import type { HostileCase, HostileRun } from './support/hostile-script-child.js';
import { CHILD_HOOK_TIMEOUT_MS, runHostileScripts, type ChildRun } from './support/hostile-run.js';

const LOOP = 'for (;;) {}';
/** For scripts stopped by their limit. */
const LOOP_TIMEOUT = 300;
/** For scripts that must fail at once; only a hang reaches it. */
const FAR_TIMEOUT = 20_000;

interface Expected { readonly case: HostileCase; readonly error: RegExp }

function stopped(name: string, script: string, template?: string): Expected {
  return {
    case: { name, script: `${script} ${LOOP}`, timeout: LOOP_TIMEOUT, ...(template === undefined ? {} : { template }) },
    error: /^Script execution timed out after 300ms$/,
  };
}

function fails(name: string, script: string, error: RegExp): Expected {
  return { case: { name, script, timeout: FAR_TIMEOUT }, error };
}

/** Tries to install a property, carrying on if the sandbox refuses. */
function define(target: string, key: string, descriptor: string): string {
  return `try { Object.defineProperty(${target}, '${key}', ${descriptor}); } catch (ignored) {}`;
}

const LOOPING_SETTER = '{ set() { for (;;) {} } }';
const THROWING_SETTER = '{ set() { throw 1; } }';
const LOOPING_ACCESSOR = '{ get() { for (;;) {} }, set() { for (;;) {} } }';

const SETTER_CASES: readonly Expected[] = [
  fails("a script that defines its own setter for Error.prototype.code is told it can't", `Object.defineProperty(Error.prototype, 'code', ${THROWING_SETTER});`, /Cannot redefine property: code/),
  stopped('a looping setter on Error.prototype.code', define('Error.prototype', 'code', LOOPING_SETTER)),
  stopped('a throwing setter on Error.prototype.code', define('Error.prototype', 'code', THROWING_SETTER)),
  stopped('a looping setter on Object.prototype.code', define('Object.prototype', 'code', LOOPING_SETTER)),
  stopped('a throwing setter on Object.prototype.code', define('Object.prototype', 'code', THROWING_SETTER)),
];

/** Throws `evil` out of the sandbox: reading the result fails, then reporting that failure throws it. */
const THROW_OUT = "var reads = 0; Object.defineProperty(Object.prototype, 'toJSON', { get() { reads += 1; if (reads === 1) { throw 'first'; } throw evil; } }); return {};";

const SYNC_CASES: readonly Expected[] = [
  ...SETTER_CASES,
  stopped('a code setter after deleting the one on Error.prototype', `Reflect.deleteProperty(Error.prototype, 'code'); ${define('Error.prototype', 'code', THROWING_SETTER)}`),
  stopped('a code setter installed with Reflect.defineProperty', `Reflect.defineProperty(Error.prototype, 'code', ${THROWING_SETTER});`),
  stopped('a code setter installed with __defineSetter__', "try { Error.prototype.__defineSetter__('code', function () { throw 1; }); } catch (ignored) {}"),
  // Node's write then does nothing, so the timeout is not recognised and names the time the call had left.
  {
    ...stopped('a frozen Error.prototype', `Object.freeze(Error.prototype); ${define('Object.prototype', 'code', THROWING_SETTER)}`),
    error: /^Script execution timed out after \d+ms$/,
  },
  stopped('a replaced Error constructor', `${define('Object.prototype', 'code', THROWING_SETTER)} Error = class { set code(v) { throw 1; } };`),
  // These were never at risk: they pin that Node uses no other property of the timeout error.
  ...['message', 'stack', 'name', 'cause', 'constructor', 'toString', 'prepareStackTrace', 'stackTraceLimit'].map((key) =>
    stopped(`looping accessors for ${key} on every object in the error's chain`, [
      define('Error.prototype', key, LOOPING_ACCESSOR), define('Object.prototype', key, LOOPING_ACCESSOR), define('Error', key, LOOPING_ACCESSOR),
    ].join(' '))),
  stopped('a looping Error.prepareStackTrace', 'Error.prepareStackTrace = function () { for (;;) {} };'),
  stopped('a throwing code setter, stopped inside a promise callback', `${define('Object.prototype', 'code', THROWING_SETTER)} Promise.resolve().then(function () { for (;;) {} }); return;`),
  stopped('a throwing code setter, stopped while its result is read', `${define('Object.prototype', 'code', THROWING_SETTER)} return { toJSON() { for (;;) {} } };`),
  fails('an error with a looping stack getter', `var evil = new Error('e'); Object.defineProperty(evil, 'stack', ${LOOPING_ACCESSOR}); ${THROW_OUT}`, /^e$/),
  fails('an error with a looping stack setter', `var evil = new Error('e'); Object.defineProperty(evil, 'stack', { get() { return 's'; }, set() { for (;;) {} } }); ${THROW_OUT}`, /^e$/),
  fails('an error with a looping message getter', `var evil = new Error('e'); Object.defineProperty(evil, 'message', ${LOOPING_ACCESSOR}); ${THROW_OUT}`, /^Script failed$/),
  fails('an error thrown while Error.prepareStackTrace loops', `Error.prepareStackTrace = function () { for (;;) {} }; var evil = new Error('e'); ${THROW_OUT}`, /^e$/),
];

const AFTER_AWAIT = "await getResource('a');";
const EVIL_STACK = `var evil = new Error('e'); Object.defineProperty(evil, 'stack', ${LOOPING_ACCESSOR});`;

const ASYNC_CASES: readonly Expected[] = [
  ...SETTER_CASES.map((c): Expected => ({ ...c, case: { ...c.case, script: `${AFTER_AWAIT} ${c.case.script}` } })),
  stopped('a throwing code setter, stopped before the first await', define('Object.prototype', 'code', THROWING_SETTER)),
  fails('an error with a looping stack getter thrown by a replaced Promise.prototype.then', `${EVIL_STACK} Promise.prototype.then = function () { throw evil; };`, /^e$/),
  fails('an error with a looping stack getter thrown by a replaced JSON.parse', `${EVIL_STACK} JSON.parse = function () { throw evil; }; ${AFTER_AWAIT}`, /^e$/),
];

/** Keeps the script going until its unhandled rejection has been seen; a Test run refuses the reads. */
const OUTLIVE = "for (let i = 0; i < 3; i++) { await getResource('x').catch(() => 0); }";

/** Long enough to finish on a loaded machine, short enough that a looping case ends inside the child's deadline. */
const UNHANDLED_TIMEOUT = 3_000;

function unhandled(name: string, reason: string, error: RegExp): Expected {
  return { case: { name, script: `${reason} void Promise.reject(evil); ${OUTLIVE}`, timeout: UNHANDLED_TIMEOUT }, error };
}

// In the worker, a value the script left unhandled is reported to the main thread.
const ISOLATED_CASES: readonly Expected[] = [
  ...SETTER_CASES,
  unhandled('an unhandled error with a looping stack getter', `const evil = new Error('e'); Object.defineProperty(evil, 'stack', ${LOOPING_ACCESSOR});`, /^The test run failed: e$/),
  unhandled('an unhandled object with a looping inspect method', "const evil = { stack: 's', message: 'e', [Symbol.for('nodejs.util.inspect.custom')]() { for (;;) {} } };", /^The test run failed: e$/),
  unhandled('an unhandled error whose message is not text', "const evil: any = new Error('e'); evil.message = { toString: 1, valueOf: 1 };", /^The test run failed: Unreadable error value$/),
  unhandled('an unhandled null', 'const evil = null;', /^The test run failed: Unreadable error value$/),
  unhandled('an unhandled string', "const evil = 'plain text';", /^The test run failed: plain text$/),
  unhandled('an unhandled error that claims to be out of memory', "const evil = Object.assign(new Error('e'), { code: 'ERR_WORKER_OUT_OF_MEMORY' });", /^The test run failed: e$/),
  stopped('a throwing code setter installed by a code template', 'install();', `function install() { ${define('Error.prototype', 'code', THROWING_SETTER)} ${define('Object.prototype', 'code', THROWING_SETTER)} }`),
];

describe.each<[HostileRun['mode'], readonly Expected[]]>([
  ['sync', SYNC_CASES],
  ['async', ASYNC_CASES],
  ['isolated', ISOLATED_CASES],
])('a hostile script in a %s run', (mode, expected) => {
  let child: ChildRun;

  beforeAll(async () => { child = await runHostileScripts(mode, expected.map((e) => e.case)); }, CHILD_HOOK_TIMEOUT_MS);

  it.each(expected.map((e): [string, RegExp] => [e.case.name, e.error]))('%s', (name, error) => {
    const outcome = child.outcomes.get(name);

    expect(outcome === undefined ? `no outcome: the process ${child.end}` : outcome.error).toEqual(expect.stringMatching(error));
  });

  it('leaves the process running', () => {
    expect(child.end).toBe('exited normally');
  });
});
