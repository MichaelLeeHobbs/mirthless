# Sandbox security model

User channel scripts (filters, transformers, pre/postprocessors, JS connectors) run
in `VmSandboxExecutor` (`sandbox-executor.ts`). This document explains why the
implementation looks the way it does.

## Threat

`node:vm` is **not** a hard security boundary. The classic escape is:

```js
logger.info.constructor('return process')()   // -> host process, process.env (DATABASE_URL, JWT_SECRET), process.binding, require, ...
```

This works whenever a user script can reach **any host-realm function or object**,
because `someHostFn.constructor` is the host realm's `Function`, and
`Function('return process')()` then runs with the host global scope in view.
`isolated-vm` (a real isolate boundary) did not build on Windows / Node 24 in this
project, so it is not used and is no longer a dependency.

## Defense: expose nothing from the host realm

The executor re-materializes **everything** the script can touch inside the vm
context, so every reachable object/function has the *sandbox* realm's prototype
chain (whose `Function` runs in a context with no `process`/`require`/`module`/
host-`globalThis`):

1. **Data** (`msg`, `tmp`, all maps, `sourceMap`, `configMap`) is injected by
   `JSON.stringify` on the host and `JSON.parse` **inside** the context. Plain data
   crosses as a string; the objects are rebuilt in-realm.
2. **Bridge functions** (`logger`, `parseHL7`, `createACK`, `$`, `$c`, `$co`, `$r`, `$g`, `$gc`, `$s`, `$cfg`,
   `httpFetch`/`dbQuery`/`routeMessage`/`getResource`, `destinationSet`, and the HL7
   message proxy) are re-implemented as sandbox-realm functions by a bootstrap
   script run with `vm.runInContext`. They call a single host `dispatch` closure
   that is passed as an argument and then **deleted from the global scope** before
   user code runs, so it is never reachable as a property.
3. **Return values** from `dispatch` are primitives (realm-agnostic) or JSON strings
   that the sandbox wrapper `JSON.parse`s. The host dispatch **never throws** into
   the sandbox: a host `Error` is a host-realm object, and
   `e.constructor.constructor('return process')()` on a caught one is a full escape.
   `makeNonThrowingDispatch` catches every host failure and returns a per-execution
   random token; the sandbox wrapper turns that into a **sandbox-realm** `Error`
   with the same message. This covers the synchronous bridges (`parseHL7`,
   `createACK`, the HL7 proxy methods, `destinationSet`) as well as the IO bridges.
4. The HL7 message proxy is exposed via opaque numeric handles; its methods dispatch
   to the host proxy and only return primitives.
5. **Arguments are primitives too.** A script-supplied object handed to host code is
   as dangerous as a host object handed to the script: host code that calls a method
   on it (`toString`, `toJSON`, `then`, a getter, pg's `toPostgres`) runs script code
   with host objects in reach. Every sandbox wrapper converts its arguments to
   strings, numbers or JSON text *inside* the sandbox, and the host dispatch refuses
   any argument that is not a primitive ("Bridge arguments must be primitive values").
6. **Results leave as JSON text.** The script's return value and its maps are
   serialized inside the sandbox (`__collect`) and parsed on the host, so the host
   never touches a sandbox object, getter or Proxy. A result JSON cannot hold is a
   script error. A thrown value is reduced to its message string in the sandbox;
   the host reads nothing from it but an own `message` data property.
7. **An error a script made is read without running its code.** Node writes `code` on the timeout error it makes in the sandbox realm, after the watchdog has stopped, so a setter for `code` on the error's prototype chain would run with nothing to stop it, and one that throws aborts the process, from a worker thread too. The bootstrap defines `Error.prototype.code` as a writable, non-configurable data property before any user code, so the write ends there. Timed calls pass `displayErrors: false`, because Node otherwise reads and writes `stack` on any other error that leaves the context. The host never uses `instanceof` on what it catches (a Proxy's `getPrototypeOf` trap). The server's unhandled-rejection handler reads only an own `message` of a reason that is not the host's (`isHostValue`, `thrownText` in `sandbox-value.ts`), and the Test run's worker reports what a script left unhandled as that text and ends. Covered by `__tests__/hostile-error-properties.test.ts`, which runs the scripts in child processes (D-329).

   What a script sees of this: `error.code` is `undefined` until something sets it, and setting it works as before on any error or subclass, but `'code' in error` is always true and `Error.prototype.code` can't be made a getter or setter. A script that freezes `Error.prototype`, or makes its `code` read-only, can no longer assign `code` to an error, and its own timeout then names the milliseconds its last call had left instead of the whole limit.

8. **The global is not a host object.** The context is made with `vm.constants.DONT_CONTEXTIFY`. A contextified one looks a missing global up on the host object it was made from, and so on the host's `Object.prototype`.
9. **No host-realm error reaches a script.** The wrapper around `dispatch` catches whatever the call throws and throws a sandbox error in its place: near the stack limit, entering a host function fails before the host's own `try` (point 3) is entered. Node's stack formatter is host code a script could enter at any depth too, and its error comes out of reading `stack`, so `Error.stackTraceLimit` is fixed at `undefined`: V8 then captures no stack and never calls the formatter. `error.stack` is `undefined` in a script. `Error.prepareStackTrace` is never called.
10. **A script can't run `import()`.** Node rejects one with a host-realm error, also when it is given an `importModuleDynamically` callback (without `--experimental-vm-modules` it refuses the callback with a host-realm error too). The executor escapes the `m` of every `import` in a script (`dynamic-import.ts`). Wherever the text is read for its meaning the two are the same, except as the keyword, where the escape is a syntax error. Raw text shows it, so the sandbox's `String.raw` takes it out again; `regex.source`, a function's own text and the raw strings of a script's own tag keep it. The context compiles no code from strings (`codeGeneration.strings: false`), so a script can't build the keyword at run time: `eval` and the function constructors throw an `EvalError`. `compileScript` refuses a script with an `import()`, so deploy and the editor name the reason.
11. **Nothing of a script runs outside its timed calls.** V8 and Node run some script code from tasks of their own, with no time limit. Scripts have no `FinalizationRegistry` (callbacks at garbage collection), no `WebAssembly` (a compile settles from a V8 task, and `compileStreaming` rejects with a host-realm error) and no `Proxy` (Node reads a private symbol of every rejected promise that nothing handled, which only a Proxy on its prototype chain can observe).
12. **The known ways to use up the stop are closed.** Node stops a script that is over its limit once. V8 and Node catch that stop in native code in a few places, and the script then runs on with nothing left to stop it. Scripts have no `console` (V8's inspector converts its arguments). `Promise.prototype.then` in the sandbox always derives a plain promise: otherwise the engine calls the resolve function of a script's own constructor as a job, what that throws is uncaught in the server, and V8 converts it to text in such a place.

Result: `logger.info.constructor`, `({}).constructor.constructor`,
`this.constructor.constructor`, `msg.get.constructor`, a caught IO error's
`.constructor`, etc. all resolve to the sandbox realm's `Function`, which sees no
`process` and compiles no text. Covered by the `escape prevention` tests in
`__tests__/sandbox-executor.test.ts`, for arguments and results by
`__tests__/sandbox-boundary.test.ts`, and for points 9, 11 and 12 by
`__tests__/hostile-scripts.test.ts`, in child processes (D-339).

## Timeouts

`vm.runInContext({ timeout })` bounds only synchronous work. When IO bridges are
present, user scripts may `await`; the executor additionally races the resulting
promise against the abort signal for an async wall-clock timeout.

The script's code and its IO settles share one deadline that starts when the script does. Building the sandbox's globals and collecting the script's result are not counted against it: each has a limit of its own, as long as the script's, so a script that finished in time is never reported as timed out because a busy host reached its result late (D-323). One execution can therefore take the setup time, the limit, and the collection time; a toJSON or getter in the result that loops is stopped by the collection's limit. A worker test run is terminated 5 s after both limits. IO results that are ready are settled together in one timed call, one result at a time inside it, because each timed call starts a watchdog thread that a busy machine is slow to schedule (D-300). A timeout always names the whole limit.

The limit does not stop every script. Each timed call is shown in shared memory while it runs (`script-watch.ts`), and a thread of the server ends the process when one is still running a minute past its limit; the supervisor restarts the server and the script's channel stays undeployed (D-340, [operations](../../../../docs/ops/resource-and-observability.md#a-script-that-hangs-the-server)). A Test run's worker is not watched.

## Notes / limitations

- There is **no** `memoryLimit` knob — `node:vm` cannot enforce one, so it was
  removed rather than left as a dead security control.
- Data injection is a JSON round-trip per execution (deep-clones, drops functions/
  `Date`s in maps). This is intentional (correctness/security over microseconds).
  Revisit only if profiling shows it matters.
- A time limit is not a guarantee against a hostile script, or a very unlucky one: some native code of V8 and Node never sees the stop, or can lose it (point 12), and the sandbox has no say over it. In the server the watchdog above then ends the process. Terminating a test run's worker does not help there either: the caller gets its answer, but the thread runs on.
- Run the server without source maps (`--enable-source-maps`): they add host code to what a script can reach.
- The removals are part of the defense: before returning one to scripts, find what it is listed for above.
- If a genuine hard isolate is ever needed (fully untrusted multi-tenant scripts),
  move to `isolated-vm` or a `worker_thread` with a scrubbed `process`; the
  `SandboxExecutor` interface is designed to allow swapping the implementation.
