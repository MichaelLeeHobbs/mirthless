# Reinvention audit

```
Reinvention audit: galvaniflow (whole repo, 7 packages + scripts)  commit 56d667d  2026-11-13
Catalog: .claude/reinvention/   Work folder: C:\Users\mhobb\AppData\Local\Temp\claude\549d30843d4e2e51\946aede9-45bb-45c1-a98b-d3c48fcf6ec1\scratchpad\fr
Since last run: first run
Coverage: 0.9971 over 542 files (0 adjusted)   PASS
Rows: 2092 (utility 829, method 428, framework-bound 291, handler 255, component 158, override 131; 668 private)   Excluded: 3159 (anonymous callback 1831, test 861, object-literal property 426, constructor 41)
Slices: 24 done, 0 blocked
Groups: 379 judged of 379 (none cut); residuals judged 138 of 138 (57 second-level residual groups, 208 members, not judged)
Spend: $89.79 of no cap (estimated from subagent tokens at list price; excludes the coordinator and 13 rate-limited judge runs)
Canaries: 4 of 4 behaved as planted   PASS
Executed: 10 of 10 top groups   Network off: no
Jobs implemented 2+ times: 190, of which 27 match only through a delegating wrapper (first run)
```

Every check passed: the 30 tool fixtures, `verify` at each step, coverage, calibration (two independent judges matched all 5 known answers), and all 4 canaries. The run covered 100 member results across 13 groups: 98 CONFIRMED and 2 REFUTED. The REFUTED cells were a non-object `sourceConnectorProperties` in `channelToExportEntry` and a `Uint8Array` passed to the canary. Neither changes a verdict. Since this run: decisions 2 and 3 are fixed in PR #70 (main had already closed most of 3 in 36cc537).

## Decision list

1. **HTTP status for a service error.** `lib/controller-helpers.ts:9 mapErrorToStatus` maps 10 codes and has 9 importers. 24 controllers still carry a local copy that maps a subset. On the same input the run gives: `ALREADY_EXISTS` returns 409 from 13 copies and 500 from 12; `FORBIDDEN` returns 403 from 2 and 500 from 23; `INVALID_INPUT` returns 400 from 4 and 500 from the rest. Only `channel.controller.ts` maps `NOT_SUPPORTED` to 422.
   Default: the shared helper, plus `NOT_SUPPORTED -> 422`. A client gets 500 today for a conflict on 12 endpoints.
2. **Blocking internal hosts.** There are two blocklists. `engine/src/sandbox/ssrf.ts` uses `net.BlockList` and has 4 importers. `connection-test.service.ts` has its own regexes (`isBlockedIp`, `isBlockedHost`). Run: `LOCALHOST.`, `foo.localhost`, `[::1]` and `100.64.0.1` all pass the connection-test checks, and `isBlockedHost` also passes `::ffff:127.0.0.1`. All are blocked by `ssrf.ts`.
   Default: `isBlockedHostname` from `ssrf.ts`. This is a security fix, not a style choice.
3. **Placeholder substitution in outbound text.** The alert dispatcher substitutes in one literal pass. `smtp-dispatcher.ts:102 substituteTemplate` chains four `String.replace` calls. The run shows the effect: message content `[$& $1 $$]` comes out as `[${msg} $1 $]`, and a `${channelId}` inside the content gets expanded. `file-dispatcher.ts:33 resolveOutputFilename` expands values that contain other placeholders.
   Default: the alert dispatcher's single literal pass. Message content (PHI) should never be read as a template.
4. **A missing timestamp on screen.** The formatters disagree. `UsersPage` shows "Never" for null and `""`. `formatUpdated` shows `""`. `formatTime`, `EventsPage.formatDate` and `CertificatesPage.formatDate` show the epoch for null ("12/31/1969, 7:00:00 PM" in New York) and "Invalid Date" for `""` or undefined.
   Default: one formatter that takes the empty label from the caller. Null must never render as 1969.
5. **Byte sizes.** `lib/system-health.ts:28 formatBytes` goes from B to TB and prints `"0 B"` for anything at or below 0. `ResourcesPage.formatBytes` stops at MB, prints `"-5 B"` and has no decimal under 1 KB. Run: the shared one prints `"512.0 undefined"` for 0.5 and `"NaN undefined"` for NaN.
   Default: the `system-health` version, with the fraction and NaN guarded.
6. **Error text shown in the web UI.** `ErrorState.toMessage` ends with "An unexpected error occurred." with a full stop. `QueryProvider.mutationErrorMessage` drops the full stop and guards an empty message.
   Default: `mutationErrorMessage`, the one that handles the empty message.

## Top 10 groups

```
G0063.X  error of unknown shape -> loggable record     2 members, 1 VARIANT
  connectors/src/logger.ts:42 errorInfo             exported 11 importers [canonical]
  server/src/lib/fatal-handlers.ts:22 describe      private   0 importers
  new Error('boom')   {message:"boom",name:"Error",stack}  run | {errMsg:"boom",stack}  run
  {message:'m'}       {message:"[object Object]"}      run | {errMsg:"[object Object]"}  run
  if merged onto errorInfo: fatal-handler log lines rename errMsg -> message and gain name.
  Both lose the message of a plain {message} object; fix that in the canonical copy.

G0012  connector property bag -> TLS settings          5 members, 2 SAME, 2 VARIANT
  server/src/services/connector-tls-resolver.ts:33 readTlsBag   private [canonical for the bag]
  web/.../HttpSourceForm.tsx:36 getTls, HttpDestinationForm.tsx:34 getTls   SAME (all 12 run rows equal)
  connectors/src/tls.ts:40 readTlsServerOptions, :60 readTlsClientOptions   VARIANT, 3 importers each
  tls missing   {}  run | {} | {} | undefined | undefined
  The two tls.ts readers return undefined on purpose (no TLS); keep them. Merge the three bag readers.

G0153  channel detail -> redacted record               2 members, 1 VARIANT
  server/src/lib/secret-redaction.ts:112 redactChannelDetail     exported 2 importers [canonical]
  server/src/services/channel-export.service.ts:14 channelToExportEntry   private (whitelist + redaction)
  sourceConnectorProperties null   throws TypeError  run | returns detail  run
  adapter: channelToExportEntry(d) = project(redactChannelDetail(d)), one redaction path for secrets.

G0006  hostname -> blocked?                            4 members, 3 VARIANT   (decision 2)
  engine/src/sandbox/ssrf.ts:42 isBlockedHostname   exported 4 importers [canonical]
  "[::1]"            true  run | false  run | false  run | false  run
  "::ffff:127.0.0.1" true  run | true   run | false  run | true   run
  "100.64.0.1"       true  run | false  run | false  run | true   run
  if merged onto isBlockedHostname: connection tests to those hosts are refused, as sandbox fetches already are.

G0062.P1  service error -> HTTP status                 25 members, 24 VARIANT   (decision 1)
  server/src/lib/controller-helpers.ts:9 mapErrorToStatus   exported 9 importers [canonical]
  24 controllers/*.controller.ts private copies, each a subset; channel.controller.ts adds NOT_SUPPORTED->422
  ALREADY_EXISTS   409 | 409 | 409 | 409 | 500 | 500 | 500 | 409 | 500 | ...  run (13 x 409, 12 x 500)
  if merged: 12 copies change 500 -> 409 on ALREADY_EXISTS and 23 change 500 -> 403 on FORBIDDEN.

G0063.P4  service error -> {code, message} body        21 members, 20 SAME
  server/src/lib/controller-helpers.ts:24 errorResponse   exported [canonical]
  20 private copies in controllers/ and routes/channel-dependency.routes.ts; 0 of 24 run rows differ.
  if merged: no behaviour change. Delete the copies and import the helper.

G0062.X  service error -> HTTP status (route file)     2 members, 1 VARIANT
  server/src/routes/channel-dependency.routes.ts:22 mapErrorToStatus   private, NOT_FOUND only
  ALREADY_EXISTS 409 | 500 run; FORBIDDEN 403 | 500 run; if merged: 7 codes stop returning 500.

G0060  unknown value -> is plain object               4 members, 3 SAME
  server/src/lib/secret-redaction.ts:70 isPlainObject, server/.../channel-import.service.ts:27,
  server/.../mirth-import.service.ts:152 isRecord, engine/src/pipeline/xml-order.ts:70 isRecord
  0 of 14 run rows differ. No shared copy exists: put one in core-util and import it.

G0240  template + values -> text                       3 members, 2 VARIANT   (decision 3)
  engine/src/alerts/action-dispatcher.ts:145 substituteAlertTemplate   [canonical: single literal pass]
  value "[$& $1 $$]"            "[$& $1 $$]"  run | "[${msg} $1 $]"  run | "[$& $1 $$]"  run
  value "x ${channelId}"        "x ${channelId}" run | "x ch-1"  run | "x ch-1"  run
  if merged: SMTP bodies and file names stop re-expanding text that came from the message.

G0193  connector type -> default properties  2 members, 1 VARIANT: source vs destination defaults tables; differ on purpose, leave.
```

## Groups 11 to 30

```
G0148     channel id -> state        2 members  1 VARIANT  canonical deployment.service.ts:241 stop     differs: halt vs stop call, event attrs
G0229     audit context -> event     3 members  2 VARIANT  canonical collection.service.ts:414 emitCollectionEvent  differs: event name only
G0063.X.R error -> Result            2 members  1 SAME     canonical engine.ts:156 fail                  differs: none at runtime
G0238     processed file -> action   3 members  2 VARIANT  canonical sftp-receiver.ts:296 postProcess   differs: guards, timeouts, MARK_READ
G0238.R   file entry -> dispatch     2 members  1 VARIANT  canonical file-receiver.ts:269 processFile   differs: SFTP throws on failed download
G0012.R   connector -> test result   3 members  2 VARIANT  canonical connection-test.service.ts:514     differs: Postgres-only, no latency
G0130     entry key -> delete hook   3 members  2 VARIANT  canonical use-global-map.ts:52               differs: use-collections does not URL-encode ids
G0130.R   map key -> row delete      3 members  2 VARIANT  canonical global-map.service.ts:143 delete   differs: missing key silent, no audit
G0158     message ids -> reprocess   3 members  2 VARIANT  canonical message-reprocess.service.ts:58    differs: recovery path reuses source map
G0157     message ids -> delete      3 members  2 VARIANT  canonical message-delete-helper.ts:25        differs: batch has no existence check
G0157.R   message ids -> delete rows 2 members  1 VARIANT  canonical message.service.ts:468             differs: table only
G0199     message -> DB send         2 members  1 VARIANT  canonical database-dispatcher.ts:137         differs: transaction vs direct
G0072     SQL + params -> rows       2 members  1 VARIANT  canonical connection-pool.ts:100 queryReadOnly  differs: read-only guard
G0146.R   channel id -> delete       2 members  1 VARIANT  canonical use-channels.ts:209                differs: soak script stops first
G0002     path -> API response       3 members  2 VARIANT  canonical cli/lib/api.ts:37 get              differs: web apiFetch has no timeout
G0287     entries -> bulk upsert     3 members  2 VARIANT  canonical config-map.controller.ts:69        differs: user-preference skips audit
G0287.R   settings -> bulk upsert    3 members  2 VARIANT  canonical settings.service.ts:120            differs: empty list [] vs error
G0132     row -> map store           3 members  2 VARIANT  canonical global-map-proxy.ts:95 set         differs: dirty flag
G0065     message -> terminal line   2 members  1 VARIANT  canonical cli/lib/output.ts:40 printError    differs: stream and prefix
G0179     collection id -> row       3 members  2 VARIANT  canonical collection.service.ts:98 getById   differs: throws vs Result
```

The largest families sit below rank 30 because their copies have no importers. All are judged SAME from source and were not run. In the web connector forms: `getStr` 18 copies, `update` 17, `getNum` 15, `getBool` 8. Controller handlers: `listTags`-shaped 11 SAME. Connector receivers: `clearPollTimer` 5. In both the certificates page and `CertificateSelect`: `getExpiryLabel` and `getExpiryDays`. Exports: `escapeCsvField` 2.

## Prevention drafts

**Lint rule** for `eslint.config.js` (a draft: nothing outside this folder was changed). It flags a new local copy of a confirmed helper outside its canonical file:

```js
{
  files: ['packages/*/src/**/*.{ts,tsx}'],
  ignores: ['packages/server/src/lib/controller-helpers.ts', 'packages/engine/src/sandbox/ssrf.ts', 'packages/web/src/lib/system-health.ts', 'packages/core-util/src/**'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: 'FunctionDeclaration[id.name=/^(mapErrorToStatus|errorResponse|errorMessage)$/]', message: 'Import it from packages/server/src/lib/controller-helpers.ts.' },
      { selector: 'FunctionDeclaration[id.name=/^(isBlockedIp|isBlockedHost|isBlockedHostname)$/]', message: 'Use isBlockedHostname from packages/engine/src/sandbox/ssrf.ts.' },
      { selector: ':matches(FunctionDeclaration, VariableDeclarator)[id.name=/^(formatBytes|isPlainObject|isRecord|getStr|getNum|getBool)$/]', message: 'Use the shared helper; see .claude/reinvention/report.md.' },
    ],
  },
},
```

**Catalog lines** for `AGENTS.md`. They become valid once the decision list is settled:

- `mapErrorToStatus(error: unknown): number` in `server/src/lib/controller-helpers.ts`: 10 service codes, 500 otherwise (add `NOT_SUPPORTED -> 422`).
- `errorResponse(error: unknown): { code; message }` in the same file: ServiceError code and message, else `INTERNAL` / "Internal server error".
- `isBlockedHostname(host: string): boolean` in `engine/src/sandbox/ssrf.ts`: every BlockList range plus localhost names, brackets and trailing dots.
- `formatBytes(n: number): string` in `web/src/lib/system-health.ts`: binary units B to TB, one decimal, `"0 B"` at or below 0.

**The cause.** Line 38 of `AGENTS.md` reads "three similar lines are better than a clever helper used once". It is meant for one-off code, but nothing in the file says to look for an existing helper first. `controller-helpers.ts` has existed since 2026-03-04, and 24 controllers still copy its two functions. Suggested replacement: "No premature abstractions: don't build a helper for one caller. Before writing a helper, search `lib/` and `packages/core-util` for one that already does the job. A second copy of an existing helper is a defect."

Method notes, canary results, per-key hits and the unjudged residuals are in `appendix.md`. Every verdict and its run evidence is in `verdicts.jsonl`.
