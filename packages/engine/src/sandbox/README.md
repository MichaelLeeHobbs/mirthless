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
`isolated-vm` (a real isolate boundary) does not build on Windows / Node 24 in this
project, so we cannot rely on it.

## Defense: expose nothing from the host realm

The executor re-materializes **everything** the script can touch inside the vm
context, so every reachable object/function has the *sandbox* realm's prototype
chain (whose `Function` runs in a context with no `process`/`require`/`module`/
host-`globalThis`):

1. **Data** (`msg`, `tmp`, all maps, `sourceMap`, `configMap`) is injected by
   `JSON.stringify` on the host and `JSON.parse` **inside** the context. Plain data
   crosses as a string; the objects are rebuilt in-realm.
2. **Bridge functions** (`logger`, `parseHL7`, `createACK`, `$`, `$r`, `$g`, `$gc`,
   `httpFetch`/`dbQuery`/`routeMessage`/`getResource`, `destinationSet`, and the HL7
   message proxy) are re-implemented as sandbox-realm functions by a bootstrap
   script run with `vm.runInContext`. They call a single host `dispatch` closure
   that is passed as an argument and then **deleted from the global scope** before
   user code runs, so it is never reachable as a property.
3. **Return values** from `dispatch` are primitives (realm-agnostic) or JSON strings
   that the sandbox wrapper `JSON.parse`s. IO-bridge errors are re-thrown as
   **sandbox-realm** `Error`s so a caught error's `.constructor` cannot leak either.
4. The HL7 message proxy is exposed via opaque numeric handles; its methods dispatch
   to the host proxy and only return primitives.

Result: `logger.info.constructor`, `({}).constructor.constructor`,
`this.constructor.constructor`, `msg.get.constructor`, a caught IO error's
`.constructor`, etc. all resolve to the sandbox realm's `Function`, which sees no
`process`. Covered by the `escape prevention` tests in
`__tests__/sandbox-executor.test.ts`.

## Timeouts

`vm.runInContext({ timeout })` bounds only synchronous work. When IO bridges are
present, user scripts may `await`; the executor additionally races the resulting
promise against the abort signal for an async wall-clock timeout.

## Notes / limitations

- There is **no** `memoryLimit` knob — `node:vm` cannot enforce one, so it was
  removed rather than left as a dead security control.
- Data injection is a JSON round-trip per execution (deep-clones, drops functions/
  `Date`s in maps). This is intentional (correctness/security over microseconds).
  Revisit only if profiling shows it matters.
- If a genuine hard isolate is ever needed (fully untrusted multi-tenant scripts),
  move to `isolated-vm` or a `worker_thread` with a scrubbed `process`; the
  `SandboxExecutor` interface is designed to allow swapping the implementation.
