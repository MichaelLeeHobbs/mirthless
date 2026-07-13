# Transformer Scripting API

Filters and transformers are JavaScript (or TypeScript, compiled before execution) that
run inside a sandbox for each message. This reference documents the surface **actually
exposed** to your scripts, sourced from `packages/engine/src/sandbox/sandbox-executor.ts`,
`sandbox-context.ts`, and `bridge-functions.ts`.

> **Execution model.** Scripts run under `VmSandboxExecutor`, a `node:vm`-based sandbox.
> Your code is wrapped in a `'use strict'` IIFE and executed with a timeout. The value you
> `return` becomes the script result (a filter returns a boolean; a transformer typically
> mutates `msg`/`tmp` and the maps).
>
> Design doc `docs/design/04` predates this and still references `isolated-vm`. That is
> **stale** — the engine uses `node:vm` (`VmSandboxExecutor`). Treat this page as current.

## Message data

| Global | Type | Description |
|---|---|---|
| `msg` | object/string | The inbound message. HL7v2 is auto-parsed to an HL7 message object (see below); otherwise the parsed/raw value. Mutations persist to later stages. |
| `tmp` | object/string | The outbound message being built. Defaults to `msg`. |
| `rawData` | string | The original raw content string. |

## Maps

All maps are plain objects. Reads and writes on the read/write maps are captured and
carried to later pipeline stages.

| Global | Access | Scope |
|---|---|---|
| `sourceMap` | read-only | Set by the source connector for this message. |
| `channelMap` | read/write | Shared across all connectors for this message. |
| `connectorMap` | read/write | Per-destination scope. |
| `responseMap` | read/write | Response values (available in the postprocessor). |
| `globalChannelMap` | read-only in script | Per-channel, persists across messages within a deployment. |
| `globalMap` | read/write | Global across all channels; flushed to the database. |
| `configMap` | read-only (frozen) | Configuration values loaded at deploy time. Writing throws (strict mode). |

### Map shortcut functions

| Function | Behavior |
|---|---|
| `$(key)` | Looks up `key` across maps in order: `responseMap`, `connectorMap`, `channelMap`, `globalChannelMap`, `globalMap`, `configMap`, `sourceMap`. Returns the first defined value. |
| `$r(key)` / `$r(key, value)` | Get / set a `responseMap` entry. |
| `$g(key)` / `$g(key, value)` | Get / set a `globalMap` entry. |
| `$gc(key)` | Get a `configMap` entry. |

## Logging

`logger` writes structured log entries attached to the message; they appear in the
message browser and server logs.

```js
logger.info('message');
logger.warn('message');
logger.error('message');
logger.debug('message');
```

## HL7 helpers

### `parseHL7(raw)`
Parses an HL7v2 string into an HL7 message object. If passed an already-parsed HL7
object (e.g. `msg` on an HL7 channel), it is returned as-is.

The returned object exposes:

| Member | Description |
|---|---|
| `get(path)` | Read a field by path, e.g. `msg.get('PID.3.1')`. `get('MSH.9')` auto-resolves to the first subcomponent — use `get('MSH.9.2')` for the trigger event. |
| `set(path, value)` | Set a field by path. |
| `delete(path)` | Remove a field. |
| `toString()` | Serialize back to an HL7 string. |
| `messageType` | Message type (read-only). |
| `messageControlId` | MSH-10 control ID (read-only). |
| `getSegmentCount(name)` | Number of segments with the given name. |
| `getSegmentString(name, index?)` | Raw string of the Nth segment (default first). |

### `createACK(originalRaw, ackCode, textMessage?)`
Builds an HL7 ACK for the original message. `ackCode` is the acknowledgment code
(e.g. `AA`, `AE`, `AR`); `textMessage` is optional.

```js
const ack = createACK(rawData, 'AA');
$r('ack', ack); // expose it to the response
```

## Optional IO bridges

These globals exist **only when the host enables them** for the channel (they are absent
otherwise, so guard with `typeof`). They are `async` — `await` them. Outbound HTTP is
subject to SSRF protection: requests to private/loopback address ranges are blocked.

| Function | Signature | Description |
|---|---|---|
| `httpFetch` | `httpFetch(url, { method, headers, body, timeout }?)` → `{ status, statusText, headers, body }` | Outbound HTTP request. |
| `dbQuery` | `dbQuery(driver, connectionUrl, sql, params?)` → rows | Parameterized query. Never string-interpolate values into `sql`. |
| `routeMessage` | `routeMessage(channelName, rawData)` → `{ success, response? }` | Route a message to another channel. |
| `getResource` | `getResource(name)` → `string \| null` | Load a configured resource by name. |

## Code templates

`FUNCTION`-type code templates whose contexts match the current script stage are prepended
to your script before compilation, so their functions are callable directly by name.
`CODE_BLOCK` templates are editor snippets and are not injected.

## Examples

**Filter** — accept only ADT messages:

```js
return msg.get('MSH.9.1') === 'ADT';
```

**Transformer** — enrich the channel map and rewrite a field:

```js
channelMap.mrn = msg.get('PID.3.1');
msg.set('PID.8', 'U'); // normalize sex to Unknown
logger.info('Normalized message ' + msg.messageControlId);
```

**Async transformer** (requires `httpFetch` enabled):

```js
const res = await httpFetch('https://api.example.org/lookup?mrn=' + channelMap.mrn, {
  method: 'GET',
  timeout: 5000,
});
if (res.status === 200) {
  channelMap.enrichment = res.body;
}
```
