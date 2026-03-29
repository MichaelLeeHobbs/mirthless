# Logging Standard for Mission-Critical Systems

Companion to the TypeScript Coding Standard. Covers structured logging, correlation, audit trails, and inter-system traceability.

---

## 1. Philosophy

Logs are infrastructure, not afterthoughts. They cost money, generate noise, and rot fast. Every log line must justify its existence by answering a question someone will actually ask during an incident, audit, or debugging session.

**Golden rule**: Log what you'd need at 3 AM to diagnose a production issue you've never seen before — nothing more, nothing less.

---

## 2. Structured Logging

All logs **shall** be structured JSON. No `console.log` with string concatenation.

```typescript
// Wrong
console.log(`User ${userId} failed login from ${ip}`);

// Right
authLog.warn({ userId, ip, reason: 'invalid_credentials' }, 'Login failed');
```

**Rules:**
- Object-first, message-second pattern: `logger.level(context, message)`
- Field names **shall** be consistent across the codebase (e.g., always `errMsg`, never sometimes `error` and sometimes `err`)
- Messages **shall** be static strings (searchable), context goes in the object (filterable)
- No sensitive data in logs: no passwords, tokens, PII beyond identifiers. Mask or omit.

**Library**: Use Pino, Winston, or similar structured logger. Chronicler is an option for typed event-driven logging with built-in correlation management.

---

## 3. Log Levels

Use levels consistently. Every level has a contract:

| Level | When | Example |
|-------|------|---------|
| **fatal** | Process cannot continue. Auto-exit imminent. | Uncaught exception, missing critical config |
| **error** | Operation failed. Needs attention. | DB write failed, external API returned 500 |
| **warn** | Unexpected but handled. May degrade. | Retry succeeded, rate limit approaching, fallback used |
| **info** | Normal operations worth recording. | Service started, request completed, job finished |
| **debug** | Diagnostic detail for development. | Query parameters, cache hit/miss, routing decisions |
| **trace** | Step-by-step execution detail. | Function entry/exit, loop iterations, protocol negotiation |

**Rules:**
- **fatal** and **error** **shall** include stack traces
- **info** is the default production level. Design your info logs to tell the story of what the system is doing without reading debug
- The **audit** level (between warn and info) is recommended for compliance-sensitive operations — see Section 6
- Configure level via environment variable (e.g., `LOG_LEVEL=info`)

---

## 4. Timestamps

All timestamps **shall** be ISO 8601 in UTC with millisecond precision:

```
2025-03-27T15:23:45.123Z
```

**Rules:**
- Use the logger's built-in timestamp (e.g., `pino.stdTimeFunctions.isoTime`)
- Never use local time. UTC only. This is non-negotiable for cross-system correlation.
- For duration measurements, log both `startedAt` / `completedAt` ISO strings and `durationMs` as a number
- Synchronize clocks via NTP across all systems

---

## 5. Correlation and Traceability

Every operation that spans multiple steps or systems **shall** carry a correlation ID.

### 5.1 Request-Level Correlation

```typescript
// Accept or generate a correlation ID at the boundary
const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();

// Include in every log within this request
httpLog.info({ requestId, method, path, status, durationMs }, 'Request completed');
```

- Accept incoming `X-Request-ID` (or `X-Correlation-ID`) from callers
- Generate a UUID if none provided
- Propagate in outbound requests to downstream services
- Return in response headers

### 5.2 Inter-System Tracing

**All communication between systems shall be logged on both sides.**

The goal: trace any event from origin through every intermediate system to its final destination.

```typescript
// System A sends to System B
log.info({ correlationId, targetSystem: 'B', messageType: 'order.created', orderId }, 'Sent message');

// System B receives from System A
log.info({ correlationId, sourceSystem: 'A', messageType: 'order.created', orderId }, 'Received message');

// System B sends to System C
log.info({ correlationId, targetSystem: 'C', messageType: 'order.dispatched', orderId }, 'Sent message');
```

**Rules:**
- Log on send: destination, message type, correlation ID, key identifiers
- Log on receive: source, message type, correlation ID, key identifiers
- Use the same correlation ID across the entire chain
- Include enough identifiers (order ID, study UID, accession, etc.) to join logs even if correlation IDs are lost

### 5.3 Typed Correlation Groups (recommended)

For complex workflows, define correlation scopes with explicit lifecycles:

```typescript
// Start correlation at workflow boundary
const correlation = logger.startCorrelation('dicom.association', {
  callingAE, calledAE, source: clientIp
});

// Enrich as you learn more
correlation.addContext({ accession, facility, patientId });

// Events within this correlation automatically tagged
correlation.info({ sopInstanceUID, modality }, 'Instance received');
correlation.info({ destination, fileName }, 'Forwarded to PACS');

// Close explicitly with summary metrics
correlation.complete({ instanceCount, transferBytes, durationMs });
```

---

## 6. Audit Logging

Security-sensitive and compliance-relevant operations **shall** be logged to an audit trail.

**What to audit:**
- Authentication: login, logout, failed attempts, token generation/revocation
- Authorization: permission changes, role assignments, access denials
- Data mutations: creates, updates, deletes on protected resources
- Data access: reads of sensitive records (healthcare, financial, PII)
- Configuration changes: system settings, feature flags, routing rules
- Data transformations: any modification to data in transit (normalization, enrichment)

**Audit event structure:**

```typescript
interface AuditEvent {
  readonly action: string;      // 'LOGIN' | 'DATA_MODIFIED' | 'RECORD_ACCESSED' | ...
  readonly actor: string;       // User ID, service account, or system identifier
  readonly resource: string;    // What was acted upon
  readonly ip: string;          // Source IP
  readonly timestamp: string;   // ISO 8601 UTC
  readonly status: number;      // Outcome (HTTP status or success/failure code)
  readonly requestId?: string;  // Correlation ID
  readonly detail?: string;     // Before/after for mutations
}
```

**Rules:**
- Audit logs **shall** be immutable — append-only storage or cryptographically signed
- Audit logs **shall** be separate from operational logs (distinct logger instance or stream)
- Include both successful and failed actions (failed login attempts are as important as successful ones)
- Log the before and after state for data mutations when feasible
- Never log the content of secrets, even in audit logs — log that a secret was rotated, not the secret itself

---

## 7. Child Loggers and Context

Use child loggers to tag related log entries with shared context:

```typescript
const root = pino({ /* config */ });

// Stream-based children
const httpLog    = root.child({ stream: 'http' });
const storageLog = root.child({ stream: 'storage' });
const authLog    = root.child({ stream: 'auth' });

// Request-scoped child
const reqLog = httpLog.child({ requestId, userId });
reqLog.info({ path, method }, 'Request started');  // requestId and userId automatic
```

This avoids repeating context in every log call and enables filtering by stream in log aggregation tools.

---

## 8. Error Logging

Errors **shall** be logged with enough context to reproduce and diagnose without access to the running system.

```typescript
// Wrong - useless in production
log.error('Something went wrong');

// Right - actionable
log.error({
  errMsg: error.message,
  stack: error.stack,
  requestId,
  operation: 'createOrder',
  orderId,
  userId,
}, 'Order creation failed');
```

**Rules:**
- Include the operation that failed, who triggered it, and what input was involved
- Use `errMsg` (or a consistent field name) for the error message — not the raw error object
- Include stack traces for error and fatal levels
- Log at the decision point, not at every rethrow. One log per error, at the layer that handles it.
- Use Result types for expected failures — only log unexpected failures at error level

---

## 9. Performance and Cost

Logs are not free. Storage, indexing, and query costs scale linearly.

**Rules:**
- Set production default to `info`. Use `debug`/`trace` only when actively diagnosing.
- Do not log inside tight loops. Log the summary after the loop.
- Do not log the full payload of large objects. Log identifiers and sizes.
- Do not log successful health checks at info level — use debug or omit entirely
- Batch client-side logs before shipping to the server (e.g., flush every 5s or every 10 entries)
- Set retention policies per log stream. Audit logs keep longer than debug logs.
- Review log volume periodically. If you can't find the signal, you have too much noise.

---

## 10. Configuration

Logging configuration **shall** be environment-driven, not hardcoded.

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOG_LEVEL` | Minimum log level | `info`, `debug` |
| `NODE_ENV` | Controls formatting | `production` = JSON, else pretty-print |
| Log group/stream | Aggregation target | CloudWatch group, file path |

**Rules:**
- Pretty-print in development (e.g., `pino-pretty`), structured JSON in production
- No log configuration in application code beyond the logger initialization module
- One logger module per service, re-exported as named child loggers

---

## Quick Reference

```
DO                                    DON'T
---                                   -----
Structured JSON                       String concatenation
Static messages + context objects     Dynamic interpolated strings
Correlate with IDs across systems     Log without traceability
Log at decision points                Log at every function call
ISO 8601 UTC timestamps               Local time or epoch-only
Separate audit from operational       Mix compliance and debug logs
Review log volume regularly           Set and forget
```
