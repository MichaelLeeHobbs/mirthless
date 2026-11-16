# Reinvention audit

**This run failed one check: canary 3.** `explainFailure` was planted as a copy of `web/src/lib/error-message.ts:14 errorMessage` with its fallback hard-coded to "unknown failure". The judge called it SAME, and in the run it matched `errorMessage(x, 'unknown failure')` on every input. The canary was built wrong, not the pipeline: `errorMessage` takes the fallback as a parameter, so a hard-coded fallback is a specialisation of it and has no planted difference to find. The judge should still have said VARIANT, because the brief calls a superset a VARIANT and its own note said the anchor does more. The other three canaries behaved as planted. Every other check passed. Since SAME and VARIANT both count as copies, the failure hides no copy group.

```
Reinvention audit: mirthless (GalvaniFlow) whole repo  commit 97b30b6  2026-11-16
Catalog: .claude/clean-code/find-reinvention/ (copied from .claude/reinvention/, which can be deleted)   Work folder: C:\Users\mhobb\AppData\Local\Temp\claude\01cabae8bc8fad5d\91848fd1-f250-41cc-bd37-ddb61bb8edba\scratchpad\fr
Since last run: 1796 reused, 215 changed, 333 added, 64 removed
Coverage: 0.9974 over 609 files (0 adjusted)   PASS
Rows: 2344 (utility 1005, method 468, framework-bound 303, handler 218, component 184, override 166; 741 private)   Excluded: 4105 (anonymous callback 2192, test 1368, object-literal property 499, constructor 46)
Slices: 15 done, 0 blocked
Groups: 450 units, none cut: 227 reused from the last run's verdicts, 223 judged; residuals judged 114 of 114 (56 second-level residual groups, 249 members, not judged)
Spend: $79.90 of no cap (estimated from subagent tokens at list price; excludes the coordinator)
Canaries: 3 of 4 behaved as planted   FAIL
Executed: 10 of 10 top groups   Network off: no
Jobs implemented 2+ times: 192 (last run: 186), of which 21 match only through a delegating wrapper
```

The 30 tool fixtures passed. `verify` passed at every step. Two fresh judges matched all 5 calibration answers. The run covered 60 members in 15 groups (10 top groups and 5 canary units): 56 CONFIRMED, 4 REFUTED, none BLOCKED. None of the REFUTED cells changes a verdict. The two `fail` copies pass `null` through as `error: null` where the judge predicted `undefined`, and still match each other. `getTlsStr` gives `""` for a string `tls` because `getTls` turns it into `{}`. The negative canary returns `""` for a number rather than throwing.

`accepted.jsonl` now closes 84 of the 192 copy groups (70 accepted, 14 out of scope). The file at the base commit closed 81. This PR adds three entries for batch 4's decisions: G0012 (`getNum`, `num`, `requireNumber`, D-276), G0013.P16.R (the two `readTlsBag`s, D-277) and G0013.X.R (`readTlsClientOptions`, `readTlsServerOptions`, `readQueueTls`, `readHttpSourceTls` and 15 DIFFERENT members, D-277). 108 copy groups stay open: 56 that an older entry partly covers but where a member changed or joined, and 52 new. They are listed in `appendix.md`. MichaelLeeHobbs/skills#31 is still open, so the skill does not read `accepted.jsonl`. This run was filtered by hand, as D-267 describes.

Since the last run, 49 of its copy groups are gone and 45 are new, touching rows added since then. Most of the new ones are in the Kafka and AMQP receivers, the script editor's type checking, the CI change classifier and the connector schemas. Both lists are in `appendix.md`.

## Decision list

These are proposals for Michael. This PR accepts nothing beyond batch 4's three groups.

1. **Property bag to text, reopened (G0014).** The accepted line covers `getStr`, `getTlsStr`, `databaseVendor` and `requireString`. Two members joined: `connection-test.service.ts:499 optionalString` gives `undefined` for a missing or non-string value, and `script-type-gate.service.ts:151 connectorScript` gives `""`. Run: key missing gives `"FALLBACK"` (getStr), `""` (getTlsStr), `"postgresql"` (databaseVendor), throws INVALID_INPUT (requireString), `undefined` (optionalString), `""` (connectorScript).
   Default: accept both under the existing reason (server-side readers versus form getters).
2. **Placeholder fill (G0263, D-275).** `fillPlaceholders` and its callers agree on padded names, numbers and JSON. The differences are each template's built-in names, run: `'${messageId}'` gives "7" in the destination and SMTP templates, and `substituteAlertTemplate` leaves any name it does not own as written (`'${ a }'`, `'${a}'` with a = 5).
   Default: accept, citing D-275 (built-in names first, by design).
3. **Connector factories (G0013.X).** `tcpMllpReceiver`, `tcpMllpDispatcher`, `httpReceiver`, `httpDispatcher`, `databaseReceiver` and `databaseDispatcher` in `connectors/src/registry.ts` share parse-then-construct and differ in schema, TLS reader and defaults. Run: `tls: {}` gives a TCP/MLLP dispatcher with all-undefined TLS options but fails the TCP/MLLP receiver.
   Default: accept as parallel by design (D-274, one schema per connector).
4. **Times (G0153, G0153.R).** `formatClockTime` and `formatUpdated` are D-278's views of `formatTimestampWith`. In G0153.R, `action-dispatcher.ts:143 alertTime` gives `"1970-01-01T00:00:00.000Z"` for `null` and `''`. For `null`, `message-export.service.ts:41 toIso` and `collections.ts:52 fromDateTimeLocal` throw TypeError; for `''` they give `""` and `null`. Its input is typed as epoch milliseconds, so this needs malformed data.
   Default: accept G0153 under D-278. Make `alertTime` show missing times the way D-278 does, as its own change.
5. **HL7 and X12 proxy guards, reopened (G0068).** `isHl7MessageProxy` and `isX12MessageProxy` differ only in the marker they test (run: `{ __hl7Proxy: true }` gives true and false). A member changed since the accepted line.
   Default: re-accept under D-258.
6. **Result `fail`, reopened (G0074).** `engine.ts:237 fail` and `dcmjs-dimse-adapter.ts:41 fail` returned the same on all 9 inputs. Two DIFFERENT members joined the group (`script-test-isolated.ts:125 fail`, `kafka-client.ts:188 describeKafkaError`).
   Default: re-accept. Two private three-line helpers in different packages.

## Top 10 groups

Run in the bare runtime, `en-US`; zones America/New_York and UTC for G0153.R. `run` cells come from the harness in the work folder.

```
G0074    error object -> failed Result        2 run, SAME            identical on 9 inputs (run)
G0073    error -> HTTP status                 mapErrorToStatus [canonical, 35 importers] vs userErrorStatus   INVALID_CREDENTIALS 401 | 400 (run, D-263, accepted)
G0014    property bag -> text                 getStr [canonical, 23 importers], 5 VARIANT   decision 1
G0013.X  property bag -> connector            6 factories, 5 VARIANT   decision 3
G0013.X.R property bag -> TLS options         readTlsClientOptions, 3 VARIANT (accepted in this PR, D-277)
  tls {}         {cert:undefined,...} | throws | undefined (useTls off) | undefined (scheme http)   run
  tls {cert}     throws (half a key pair) | throws | undefined | throws                              run
G0263    template -> text                     fillVariables, 1 SAME, 5 VARIANT   decision 2
G0012    property bag -> number               getNum [canonical, 16 importers], num and requireNumber VARIANT (accepted in this PR, D-276)
  "42"     -999 (fallback) | 42 | throws INVALID_INPUT   NaN  -999 | -999 | throws   run
G0153.R  epoch ms -> text                     alertTime, 2 VARIANT   decision 4
G0068    value -> is proxy                    isHl7MessageProxy vs isX12MessageProxy   decision 5
G0011    property bag -> boolean              getBool vs getTlsBool (accepted): {k:false} at top level false | true   run
```

## Groups 11 to 30

```
G0160.R  channel id -> status record      getStatus, 2 VARIANT (getRuntime, getDeployed)              open
G0452    HTTP update handlers             certificate update, 6 SAME, 3 VARIANT                         open (controller handlers)
G0452.R  service update bodies            collection update, 7 VARIANT                                  open (service bodies)
G0250    audit event -> none              emitSuccessEvent, 2 VARIANT (emitEvent, auditLoginFailure)    open
G0314    store failure -> none            amqp giveUp vs kafka giveUp, VARIANT                          open
G0314.R  unstored delivery -> none        amqp notStored vs kafka notStored, VARIANT                    open
G0143    map key -> delete                global-map delete, 2 VARIANT                                  open
G0143.R  delete hooks                     useDeleteGlobalMapEntry, 2 VARIANT                            open
G0260    processed file -> post action    sftp postProcess, 2 VARIANT (email, file)                     open
G0260.R  remote file -> process           sftp processFile vs file processFile, VARIANT                 open
G0171    message content -> delete        deleteContent vs removeContent                                accepted
G0171.R  message -> delete                deleteMessage, 2 VARIANT                                      accepted
G0158.R  channel id -> delete             useDeleteChannel vs soak removeChannel                        open
G0172    message -> reprocess             reprocessMessage, 2 VARIANT                                   accepted
G0172.R  message action hooks             useReprocessMessage, 3 VARIANT                                accepted
G0035    segment name -> count            HL7 vs X12 getSegmentCount, SAME                              accepted
G0324    broker subscription -> run       kafka run vs amqp watch, VARIANT                              open
G0153    timestamp -> text                formatTimestamp, 3 VARIANT                                    decision 4
G0026    raw message -> send              engine sendMessage vs deployment sendMessage, SAME            open
G0026.R  attachment extract               extract, 2 VARIANT (regex, JavaScript)                        open
```

## Prevention drafts

No new drafts. The shared helpers this run found copies of are already in AGENTS.md's helper list and `eslint.config.js` `SHARED_HELPERS`. The open groups above are mostly parallel connector, controller and service code, which a name rule cannot tell apart.
