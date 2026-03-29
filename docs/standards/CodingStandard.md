# TypeScript Coding Standard for Mission-Critical Systems

## 1. Introduction

This standard defines baseline rules for high-reliability TypeScript applications in mission-critical environments (aerospace, finance, healthcare, infrastructure). Safety, predictability, and verifiability take priority over convenience or brevity. Teams **shall** supplement with domain-specific rules. Compliance is enforced via CI/CD and periodic audits.

## 2. Levels of Compliance

* **Shall**: Mandatory. Non-compliance requires a formal waiver with risk assessment.
* **Should**: Strong recommendation. Deviation requires inline rationale and a review ticket.
* **May**: Permissible option. Use judiciously with documentation.

Assumes TypeScript 5.0+ and Node.js 20+.

---

## 3. Compiler, Environment, and Tooling Compliance

### Rule 3.1: Strict Compiler Configuration

The `tsconfig.json` **shall** enable maximum strictness. See [Reference Configs](ReferenceConfigs.md) for the full required `compilerOptions`.

Key flags: `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false`, `skipLibCheck: false`.

For TypeScript 5.8+: consider `erasableSyntaxOnly: true` to enforce erasable-only syntax.

### Rule 3.2: Zero Tolerance for `any`

The `any` type **shall not** be used. Use `unknown` + type guards for untyped inputs, generics for reusable utilities. Type assertions (`as`, `!`) **shall** be minimized and justified with comments.

### Rule 3.3: Automated Static Analysis

All code **shall** pass ESLint (`@typescript-eslint`) with `--max-warnings 0`. The build pipeline **must** fail on any issue. See [Reference Configs](ReferenceConfigs.md) for recommended ESLint rules.

Run `tsc --noEmit` in pre-commit hooks.

### Rule 3.4: Dependency Management

Dependencies **shall** be pinned to exact versions (e.g., `"lodash": "4.17.21"` — no `^` or `~`). Run `npm audit` in CI; fail on high-severity issues. Minimize third-party deps. All imports **shall** be static ESM — no dynamic `require`.

### Rule 3.5: Prohibition of Traditional Enums

Traditional `enum` declarations **shall not** be used. Use `as const` objects or string literal unions instead. **Why**: Enums generate non-erasable runtime code and create inconsistencies between string and numeric variants.

---

## 4. Asynchronous Execution & Promises

### Rule 4.1: No Floating Promises

All Promises **shall** be explicitly handled: `await`ed, chained (`.then/.catch`), or returned. Fire-and-forget is permitted only if provably safe and documented.

### Rule 4.2: Mandatory Timeouts and Cancellation

No async operation **shall** run without a timeout. Use `AbortController` + `Promise.race`. Default max 30 seconds unless justified.

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);
try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json();
} finally {
    clearTimeout(timeoutId);
}
```

### Rule 4.3: Bounded Parallelism

Parallelism (`Promise.all`) **shall** be bounded (e.g., max 5 concurrent via `p-limit`). Forbid unbounded `Promise.all` on user-controlled inputs. **Why**: Uncontrolled parallelism risks thread pool exhaustion and cascading failures.

### Rule 4.4: Async Iteration Safety

Use `for await...of` only on trusted iterables. Custom async iterators **shall** implement cancellation via `AbortSignal`.

---

## 5. Scope, Closures, and Memory Management

### Rule 5.1: Explicit Resource Disposal

Closures, listeners, timers, and streams that capture resources **shall** implement explicit disposal (TypeScript 5.2+ `Disposable` or custom `dispose()`). Always pair `on` with `off`. Clear timers in `finally` or disposal hooks.

### Rule 5.2: Scoped Variables Only

`var` **shall not** be used. Prefer `const`; use `let` only when reassignment is needed. No global variables — use modules with lazy initialization.

### Rule 5.3: Safe `this` Binding

Use arrow functions in callbacks to capture lexical `this`. If dynamic `this` is unavoidable, declare explicitly: `function method(this: MyClass)` and `.bind(this)`.

---

## 6. Error Handling

### Rule 6.1: Reserved Use of Exceptions

`throw` **shall** be reserved for unrecoverable panics (assertion failures, OOM, bad config). Never use for control flow or expected failures.

### Rule 6.2: Result Pattern for Recoverable Errors

Functions that can fail **shall** return `Result<T, E>`:

```typescript
type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E extends Error ? E : Error };
```

Always check `if (!result.ok)` before accessing `value`. See [Reference Configs](ReferenceConfigs.md) for `tryCatch` and `tryCatchSync` utilities.

### Rule 6.3: Comprehensive Logging

All errors **shall** be logged using structured JSON with context (correlation ID, operation, actor) and no sensitive data. See the [Logging Standard](LoggingStandard.md) for levels, correlation, audit trails, and inter-system traceability.

Integrate with monitoring (e.g., Sentry, DataDog) for alerts on panics.

---

## 7. Defensive Coding & Data Integrity

### Rule 7.1: Immutability by Default

Use `readonly` for interfaces, `ReadonlyArray<T>`, `ReadonlyMap<K,V>`, and `DeepReadonly<T>` for nested structures. Functions **shall** accept `const` parameters where possible. Use `Object.freeze` in critical paths.

### Rule 7.2: Runtime Validation at Boundaries

All external inputs (APIs, files, env vars, user data) **shall** be validated using schema libraries (Zod preferred; alternatives: Valibot, ArkType). No raw type assertions — use type guards. Sanitize outputs to prevent injection.

```typescript
const UserSchema = z.object({
    id: z.number().positive(),
    name: z.string().min(1).max(100),
});
type User = z.infer<typeof UserSchema>;

function parseUser(input: unknown): Result<User> {
    const parsed = UserSchema.safeParse(input);
    return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, error: new Error(`Invalid user: ${parsed.error.message}`) };
}
```

### Rule 7.3: Branded Types for Domain Primitives

Avoid raw primitives for domain types. Use branded types for nominal distinction:

```typescript
declare const __brand: unique symbol;
type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };

type UserId = Brand<string, 'UserId'>;
type Email = Brand<string, 'Email'>;
```

Factory functions **shall** validate before branding and return `Result<T>`.

### Rule 7.4: Security Hardening

* Use prepared statements / parameterized queries — no SQL concatenation
* Never hardcode secrets — use env vars or vaults
* Use audited crypto libraries (Node.js `crypto`, `libsodium.js`) — no custom implementations
* Set security headers (CSP, HSTS, X-Frame-Options) in HTTP responses

---

## 8. Control Flow & Structure

### Rule 8.1: Bounded Loops

All loops **shall** have an upper bound, documented with rationale. If `while(true)` is used, add a counter with a bail-out.

### Rule 8.2: No Recursion

Recursion **shall not** be used. Rewrite as iterative with explicit stacks. **Why**: JS lacks tail-call optimization — deep recursion causes stack overflows.

### Rule 8.3: Exhaustive Pattern Matching

All `switch` statements and union checks **shall** be exhaustive via `default: assertUnreachable(x)`.

```typescript
function assertUnreachable(x: never): never {
    throw new Error(`Exhaustive check failed: ${JSON.stringify(x)}`);
}

// Prefer as-const objects over traditional enums
const Status = { LOADING: 'LOADING', SUCCESS: 'SUCCESS', ERROR: 'ERROR' } as const;
type StatusValue = typeof Status[keyof typeof Status];

// Or use string literal unions for simple cases
type Direction = 'north' | 'south' | 'east' | 'west';
```

### Rule 8.4: Modular Function Design

* **Should** be ≤ 40 lines
* ≤ 4 parameters — use an options object for more
* Single responsibility, pure where possible
* Early returns for guards — max 3 levels of nesting

---

## 9. Testing, Verification, and Observability

### Rule 9.1: Comprehensive Test Coverage

All code **shall** have ≥95% branch coverage (Jest or Vitest). Use property-based testing (`fast-check`) for algorithms. Prefer contract / integration tests over heavy mocking. Tests **shall** cover edge cases: empty inputs, nulls, boundary values, concurrent access.

### Rule 9.2: Fuzzing and Chaos Testing

Critical paths (auth, payments, persistence) **shall** undergo fuzzing (`@fast-check/jest`) and chaos engineering (fault injection, network failure simulation). Run fuzzing nightly in CI.

### Rule 9.3: Observability and Monitoring

Instrument with metrics (Prometheus, StatsD) for latency, error rates, and resource usage. Emit traces (OpenTelemetry) and structured logs. Define SLOs for critical endpoints. Implement `/health` and `/ready` endpoints.

### Rule 9.4: Type Testing

Use `tsd` or `expect-type` to verify complex generics and type transformations behave correctly.

---

## 10. Documentation and Code Organization

### Rule 10.1: Inline Documentation

All public APIs **shall** have TSDoc with `@param`, `@returns`, `@throws`, and examples for complex functions.

### Rule 10.2: Architecture Decision Records

Significant design decisions **shall** be documented in ADRs in `docs/adr/`. **Why**: Provides historical context for maintainers and regulatory audits.

### Rule 10.3: Modular Architecture

Organize into modules with clear boundaries. Use barrel exports sparingly. Core domain logic **shall not** depend on infrastructure (Dependency Inversion).

---

## 11. Performance and Resource Management

### Rule 11.1: Profile Before Optimizing

Optimizations **shall** be justified with profiling data (`clinic.js`, Chrome DevTools). Document baseline and target. Correctness first, performance second.

### Rule 11.2: Memory Leak Detection

Run memory profilers on long-running processes in dev/staging. Set `--max-old-space-size` in production and monitor for growth.

### Rule 11.3: Efficient Data Structures

Use `Map`/`Set` for lookups, typed arrays for binary data, streaming for large files. Use structural sharing (Immer) if immutability + large objects.

---

## 12. Deployment and Runtime

### Rule 12.1: Environment Parity

Dev, staging, and production **shall** match (same Node.js version, OS, deps). Use containers or reproducible builds.

### Rule 12.2: Graceful Shutdown

Handle `SIGTERM`/`SIGINT`: drain connections, release resources, then exit.

```typescript
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, starting graceful shutdown');
    await server.close();
    await database.disconnect();
    process.exit(0);
});
```

### Rule 12.3: Feature Flags

Use feature flags for gradual rollouts. Flags **shall** be temporary — remove after stabilization.

---

## 13. Compliance and Audit Trail

### Rule 13.1: Code Reviews

All changes **shall** be reviewed by at least one qualified engineer. Critical modules (auth, encryption) require two reviewers.

### Rule 13.2: Audit Logging

Security-sensitive operations **shall** be logged immutably with timestamp, actor, and operation details. Logs **shall** be tamper-evident. See [Logging Standard](LoggingStandard.md) Section 6.

### Rule 13.3: Versioning and Traceability

All releases **shall** be tagged with semantic versioning. Maintain a CHANGELOG linking commits to issues.

---

## Appendix: Glossary

* **Discriminated Union**: Union type where each variant has a literal discriminant enabling exhaustive narrowing.
* **Branded Type**: Intersection types creating nominally distinct types from primitives.
* **Result Type**: Success-or-failure union avoiding exceptions for recoverable errors.
* **Const Assertion**: `as const` syntax inferring narrowest literal types and marking objects readonly.

---

## Revision History

| Version | Date       | Changes |
|---------|------------|---------|
| 1.0     | 2025-11-21 | Initial release |
| 1.1     | 2025-11-21 | Added enum prohibition, const assertions, observability, deployment |
| 2.0     | 2026-03-27 | Condensed for clarity. Extracted logging to LoggingStandard.md, configs/utilities to ReferenceConfigs.md |

---

**Living standard — reviewed quarterly.**
