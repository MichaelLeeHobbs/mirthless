# Reinvention audit

```
Reinvention audit: mirthless (GalvaniFlow) whole repo  commit 7d1f6dd  2026-11-15
Catalog: .claude/reinvention/   Work folder: C:\Users\mhobb\AppData\Local\Temp\claude\4ffe9e8ffe05b031\8e5bb138-39f8-448e-90f9-860cc11ac1b2\scratchpad\fr
Since last run: 1768 reused, 146 changed, 159 added, 164 removed
Coverage: 0.9962 over 561 files (0 adjusted)   PASS
Rows: 2073 (utility 818, method 448, framework-bound 291, handler 215, component 161, override 140; 636 private)   Excluded: 3411 (anonymous callback 1931, test 999, object-literal property 439, constructor 42)
Slices: 10 done, 0 blocked
Groups: 402 units, none cut: 257 reused from the last run's verdicts, 145 judged; residuals judged 64 of 64 (26 second-level residual groups, 148 members, not judged)
Spend: $57.17 of no cap (estimated from subagent tokens at list price; excludes the coordinator)
Canaries: 4 of 4 behaved as planted   PASS
Executed: 10 of 10 top groups   Network off: no
Jobs implemented 2+ times: 186 (last run: 190), of which 13 match only through a delegating wrapper
```

Every check passed: the 30 tool fixtures, `verify` at each step, coverage, calibration (two fresh judges matched all 5 known answers), and all 4 canaries. The run covered 49 members in 15 groups: 46 CONFIRMED and 3 REFUTED. The REFUTED cells: `redactChannelDetail` throws on an undefined detail where the judge predicted an object; `formatBytes` returns `"—"` for a `Uint8Array` (the negative canary's input), not `"0 B"`; and one hex-dump cell of the negative canary. None changes a verdict.

Since the last run, 43 of its 190 copy groups are gone. 23 are the copies PRs #73 to #80 removed: the controller error helpers, `isPlainObject`, `escapeCsvField`, certificate expiry, the connector-form getters, `formatBytes`, the empty-timestamp formatters, and the fatal-handler `describe`. The other 20 went because other work changed their members (the MySQL pool, the importer, deployment) or a fresh judge split them. 31 copy groups are new and touch rows added since then. About half are in the X12, Delimited, MySQL and research-script code; the rest are the shared helpers' new homes pairing with variants that were left alone (`getStr` with `requireString`, `mapErrorToStatus` with `userErrorStatus`). The net is 190 to 186. Both lists are in `appendix.md`.

## Decision list

1. **Placeholder substitution, six copies (G0251).** `connectors/src/base.ts:114 fillVariables` (2026-11-13) trims the name, writes objects as JSON and throws on a bigint. `file-dispatcher.ts:34 resolveOutputFilename`, which PR #74 rewrote a day after `fillVariables` existed, leaves `${ x }` as written and writes objects as `[object Object]`. `config-references.ts:50 replace` trims but writes `[object Object]`; `action-dispatcher.ts:145 substituteAlertTemplate` fills only its six alert names and leaves padded names. Run: `'${ x }'` with x `'v'` gives `"v"` from four copies and `"${ x }"` from two; x `10n` throws in `fillVariables` and `substituteTemplate`.
   Default: `fillVariables`' rules (trim, JSON), with bigint written as a string. The File, SFTP and alert templates keep their own built-in names and look the rest up through it.
2. **A number read from connector properties (G0012, G0363).** `connectors/src/registry.ts:36 num` coerces: `'5432'` gives 5432, `' '` gives 0, `true` gives 1, `'0x10'` gives 16. Web `connector-properties.ts:18 getNum` takes numbers only and passes `NaN` and `Infinity` through. `connection-test.service.ts:146 requireNumber` throws `INVALID_INPUT` for anything but a finite number.
   Default: finite numbers only, so `getNum` gives the fallback for `NaN`/`Infinity`, and `num` stops reading `' '` as 0 and `true` as 1. Keep numeric strings in `num` only if imported Mirth channels store them (check the importer before changing it).
3. **TLS settings from a property bag (G0013).** `getTls` and `readTlsBag` return `{}` for a non-object and return an array as is; `readTlsClientOptions` turns `'abc'`, `[]` or `{}` into an object of undefined fields; `readTlsServerOptions` returns undefined unless cert and key are both non-empty.
   Default: `readTlsServerOptions`' rule (undefined unless usable) for both server-side readers. The web getters only feed form fields and can stay.
4. **A missing time on screen, remaining copies (G0144).** `LogViewer.tsx:41 formatTimestamp` shows `"19:00:00.000"` (epoch in New York) for null and `"NaN:NaN:NaN.NaN"` for an unparseable value; `ChannelColumnCells.tsx:41 formatUpdated` shows `"12/31/1969"` for null. Both inputs are typed `string`, so this needs malformed data.
   Default: `lib/format.ts:20 formatTimestamp`'s rule ("—" for missing, the value as received when unparseable) in the log viewer's own clock format.

## Top 10 groups

Run in the bare runtime, `en-US`; zones America/New_York and UTC for G0144. `run` cells come from the harness in the work folder.

```
G0070  error object -> failed Result          2 run, 1 SAME (4 DIFFERENT members regrouped)
  engine.ts:235 fail [canonical: shared shape]   dcmjs-dimse-adapter.ts:41 fail   identical on 15 inputs (run)
G0070.R  error of unknown shape -> record     errorInfo (14 importers) [canonical] vs sandbox-executor.ts:646 toHostError, VARIANT
  null          {errMsg:"null"}           Error("Script failed")            run
  {message:'m'} {errMsg:"m"}              Error("m")                        run
  Different output types for different consumers (log record vs host Error); not a merge candidate.
G0013  connector property bag -> TLS record   23 members, 1 SAME, 2 VARIANT
  tls: 'abc'    getTls {} | readTlsBag {} | readTlsServerOptions undefined | readTlsClientOptions {cert:undefined,...}  run
  tls: {cert:'C'}  ... {cert:"C"} | undefined | {cert:"C",key:undefined,...}                                         run
G0013.R  database-receiver.ts:57 toPoolConfig vs database-dispatcher.ts:32 toPoolConfig, VARIANT
  Same mapping; the receiver adds statementTimeoutMs 30000 (run).
G0069  error -> HTTP status                   mapErrorToStatus (34 importers) [canonical] vs user.controller.ts:17 userErrorStatus
  INVALID_CREDENTIALS   401   400   run   (deliberate, D-263)
G0014  connector property bag -> text         getStr (19 importers) [canonical], 3 VARIANT
  {vendor:''}   getStr "" | databaseVendor "" | getTlsStr "" | requireString throws INVALID_INPUT   run
  {vendor:5}    "FB" | "postgresql" | "" | throws                                                   run
  databaseVendor is getStr with a fixed fallback; requireString is the server-side validator.
G0156  channel definition -> export record    channelToExportEntry, 2 VARIANT
  sourceConnectorProperties 'x'   throws TypeError | throws TypeError | redactChannelDetail returns the record   run
  null description                 null | "" (buildCloneInput) | null                                          run
G0012  property -> number                     requireNumber vs getNum   (decision 2)
  '5432'  throws INVALID_INPUT | -1 (fallback)   NaN  throws | NaN   run
G0363  property -> number                     registry num vs getNum    (decision 2)
  '5432'  5432 | -1   ' '  0 | -1   true  1 | -1   Infinity  -1 | Infinity   run
G0251  template text -> filled text           6 members, 5 VARIANT   (decision 1)
  '${ x }' x 'v'   fillVariables "v" | resolveOutputFilename "${ x }" | substituteTemplate "v" | substituteAlertTemplate "${ x }" | renderDestinationTemplate "v" | replace "v"   run
  '${x}' x {a:1}   "{\"a\":1}" | "[object Object]" | "{\"a\":1}" | "${x}" | "{\"a\":1}" | "[object Object]"                                                                         run
  if merged onto fillVariables: File/SFTP filenames fill padded names and write objects as JSON.
```

## Groups 11 to 30

```
G0151.R  channel id -> record          23 members  1 VARIANT  canonical deployment.service.ts:253 stop       halt is stop with runtime.halt()
G0407    HTTP request -> none          21 members  6 SAME 3 VARIANT  canonical alert.controller.ts:61 update  controller update handlers
G0407.R  entity changes -> record      11 members  7 VARIANT  canonical collection.service.ts:131 update      service update bodies
G0239    audit context -> none          6 members  2 VARIANT  canonical collection.service.ts:414 emitCollectionEvent   event name only
G0204    outbound message -> record     7 members  1 VARIANT  canonical database-dispatcher.ts:131 sendDirect  transaction wrapper
G0249    processed file -> none         6 members  2 VARIANT  canonical sftp-receiver.ts:296 postProcess      File/SFTP/email after-actions
G0249.R  file entry -> none             3 members  1 VARIANT  canonical file-receiver.ts:269 processFile       read-failure skip
G0134    entry key -> none              9 members  2 VARIANT  canonical use-global-map.ts:52 useDeleteGlobalMapEntry   delete hooks
G0134.R  map key -> none                6 members  2 VARIANT  canonical global-map.service.ts:143 delete      map deletes
G0160    message ids -> none           14 members  1 VARIANT  canonical message.service.ts:503 deleteContent   removeContent
G0160.R  message ids -> none           12 members  2 VARIANT  canonical message-query.service.ts:320 deleteMessage   batch delete helpers
G0343    path -> text                   5 members  1 VARIANT  canonical hl7-message.ts:77 get                 X12 get mirrors HL7 get (by design, D-258)
G0041    method, path, body -> record   5 members  3 VARIANT  canonical cli api.ts:56 request             post/put/patch wrappers
G0161    message ids -> record         17 members  2 VARIANT  canonical message-reprocess.service.ts:58 reprocessMessage
G0161.R  message ids -> record         14 members  3 VARIANT  canonical use-message-actions.ts:41 useReprocessMessage   mutation hooks
G0149.R  channel id -> none            12 members  1 VARIANT  canonical use-channels.ts:209 useDeleteChannel   soak script copy
G0034    segment name -> number         4 members  1 SAME     canonical hl7-message.ts:260 getSegmentCount    X12 copy (by design)
G0003    request path -> record         5 members  2 VARIANT  canonical cli api.ts:37 get                 get/del/apiFetch
G0306    entry list -> none             7 members  2 VARIANT  canonical config-map.controller.ts:59 bulkUpsert   bulk upsert handlers
G0306.R  definitions -> collection      4 members  2 VARIANT  canonical settings.service.ts:120 bulkUpsert   bulk upsert services
```

## Prevention drafts

**Lint rule.** `eslint.config.js` already has `SHARED_HELPERS` (PR #85). Add one entry for decision 1 once it is settled:

```js
{ names: 'fillVariables|substituteTemplate|resolveOutputFilename', home: 'packages/connectors/src/base.ts (fillVariables)' },
```

`resolveOutputFilename` and `substituteTemplate` are exported today, so the rule passes them; the entry only stops a fourth copy. They need to move onto `fillVariables` first.

**Catalog lines** for AGENTS.md, valid once decisions 1 and 2 are settled:

- `fillVariables(text, message): string` in `connectors/src/base.ts`: fills `${name}` from message variables, name trimmed, objects as JSON, an unknown name left as written.
- `getNum(props, key, fallback): number` in `web/src/components/channels/common/connector-properties.ts`: the value when it is a finite number, else the fallback.

**The cause.** Fixed in PR #81: AGENTS.md line 38 now says to search `lib/` and `core-util` before writing a helper. Decision 1 shows the gap it leaves: `fillVariables` lives in `connectors/src/base.ts`, neither place, and #74 rewrote a sixth copy a day after it landed. Suggested addition to the line: "and the package's own base or shared module (`connectors/src/base.ts`)".

Method notes, canary results, the resolved and new-code group lists, per-key hits and the new domains are in `appendix.md`. Every verdict and its run evidence is in `verdicts.jsonl`.
