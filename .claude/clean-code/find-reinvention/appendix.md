# Reinvention audit appendix

Run of 2026-11-16 at commit 97b30b6, a re-run against the catalog from 7d1f6dd (2026-11-15). Every group's verdicts and the run evidence are in `verdicts.jsonl`, one line per member with its content hash. This is the first run with the catalog in `.claude/clean-code/find-reinvention/`. The vendored skill moved it there, and the old `.claude/reinvention/` folder was copied in whole and can be deleted.

## Canaries

Four functions were planted in a fake `packages/web/src/pages/ExportHistoryPage.tsx`, rebuilt against today's sources. They went through describe, grouping, judging and the run like any other row, and are left out of every count in the report.

| Canary | Copied from | Planted difference | Grouped with source | Verdict | Shown by run |
|---|---|---|---|---|---|
| `renderWhen` | `lib/format.ts:36 formatTimestamp` | `""` instead of "—" for null, undefined or `''` | G0153 | VARIANT | yes: null, undefined, `''`, both zones |
| `humanReadableSize` | `lib/system-health.ts:28 formatBytes` (reduce instead of log) | stops at GB | G0137 | VARIANT | yes: 2^40 gives "1024.0 GB" vs "1.0 TB" |
| `explainFailure` | `lib/error-message.ts:14 errorMessage` | fallback hard-coded to "unknown failure" | G0075 | SAME (FAIL) | no: equal to `errorMessage(x, 'unknown failure')` on every input |
| `formatBytes` (hex dump) | negative: shares the name and vocabulary | another job | G0347, G0043 | DIFFERENT | n/a |

Canary 3 failed because of how it was built. Last run's source for it, the CLI's `describe`, was removed with the CLI (D-280). Its replacement, `errorMessage`, takes the fallback as a parameter, so a hard-coded fallback has no behaviour `errorMessage` cannot produce. The next run should plant a real difference there, for example an empty `Error` message that gives `""` instead of the fallback. The judge's SAME also goes against the brief, which calls a superset a VARIANT, and its note said the anchor does more.

## How the re-run reused the last run

- The tool from the last run's work folder was copied and run against the 30 fixtures of the skill vendored at 8e6a5f6; all 30 passed.
- `reuse` against the saved `rows.jsonl`: 1796 rows kept their descriptions, 215 changed and 333 added rows were described again (15 slices, Sonnet), 64 rows are gone. Two describe workers read only the line ranges of their rows rather than whole files; both slices passed `verify`.
- Mapping: 900 of 1142 `domain_in` strings had a saved mapping; the other 242 went to one mapper against the frozen list. 68 came back unmatched and became 18 new domains (D0216 to D0233: script diagnostics, broker delivery, script surface, message broker connector properties, script test run input, broker consumer run, CI change classification, worker thread message, script reference entry, backup row restore step, script language, pixel length, numeric range, labelled check callback, item count, editor line changes, duration text with unit, URL query parameters). "text with typed escapes" was mapped to D0028, where the saved mapping already put "typed escape sequences".
- A saved verdict was reused only when the unit's members were exactly a saved group's members and every content hash was unchanged. 227 units reused 873 verdict lines; 223 units were judged again in 38 packets, then 114 residual groups in 21 packets. Reused groups keep the last run's run evidence.
- Calibration: four pairs carried over from the last run (two `clearPollTimer` copies SAME, two `fail` copies SAME, File and SFTP `postProcess` VARIANT, `validate` middleware vs script `validate` DIFFERENT) and one new negative, `formatBytes` vs `formatUptime` DIFFERENT, because `LogViewer.formatTimestamp` was removed by D-278. Two fresh judges with the frozen brief matched all five.
- The first run-set build paired canary 3 with the removed CLI `describe`; that pair was BLOCKED, and the comparison above comes from G0075, where the canary ran beside `errorMessage`.

## Batch 4's entries (#240)

The groups batch 4 settled by decision were renumbered and regrouped by this run:

- Old G0012 (`requireNumber`, `getNum`) and old G0363 (`num`, `getNum`) are one group now, G0012, with exactly those three members. One entry covers it (D-276).
- Old G0013's TLS readers split in two. G0013.P16.R holds the server resolver's `readTlsBag` and a second `readTlsBag` that batch 4 added to `connectors/src/tls.ts`. G0013.X.R holds `readTlsClientOptions`, `readTlsServerOptions`, the registry wrappers `readQueueTls` and `readHttpSourceTls` (both VARIANT, gated on `useTls` and on the HTTP scheme), and 15 DIFFERENT members. Its entry lists all 19, since D-267 closes a group only when every member matches. Both entries cite D-277.
- The web form's `getTls` was not grouped with any reader this run: the 42-member job group G0013 was split by signature, and `getTls` was a part of one, left out of the cross-part group at its 25-member cap. It is in no copy group, so nothing is recorded for it.

## Batch 5's entries (2026-11-17)

Michael took the report's defaults. Every member's hash was checked against main at b255c6c first; the five groups below were unchanged there.

- **G0014** (D-267) replaces the 7d1f6dd line for the same group, which covered 4 of today's 6 members. `optionalString` and `connectorScript` joined.
- **G0263@97b30b6** (D-275), the placeholder templates. The bare ID G0263 already names an older out-of-scope line for another group.
- **G0013.X** (D-274), the six registry factories, with 19 DIFFERENT members listed so the group closes.
- **G0153** (D-278), the screen time formatters, with 10 DIFFERENT members listed. Because `alertTime`, `toIso` and `fromDateTimeLocal` are among them, this line also closes G0153.R until the `alertTime` fix changes `alertTime`.
- **G0068** (D-258) replaces the G0065 line, which covered 3 of today's 4 members.
- **G0074** is not recorded: `errorInfo` (#238's fix) and `toHostError` changed on main after this run, so their verdicts no longer describe the code.

## Open copy groups

Every group with at least one SAME or VARIANT member that no `accepted.jsonl` line closes, after batch 4's and batch 5's entries. "Reopened" names the older entry that covers part of the group; one of its members changed or a member joined. Members judged DIFFERENT are counted, not listed. 433 more groups had only DIFFERENT members and are not listed.

- **G0013.P20** (new): `core-models/src/schemas/http-connector.schema.ts:115 dropDestinationLegacy` ANCHOR, `core-models/src/schemas/tcp-mllp-connector.schema.ts:58 dropLegacyKeys` VARIANT
- **G0013.P28** (new): `server/src/services/connector-tls-resolver.ts:59 resolveHttpDestinationTls` ANCHOR, `server/src/services/connector-tls-resolver.ts:70 resolveQueueTls` VARIANT
- **G0016** (new; 3 DIFFERENT): `connectors/src/smtp/smtp-dispatcher.ts:262 createNodemailerTransport` ANCHOR, `connectors/src/smtp/smtp-dispatcher.ts:250 buildNodemailerOptions` VARIANT, `connectors/src/smtp/smtp-dispatcher.ts:271 defaultTransportFactory` SAME, `server/src/services/email.service.ts:37 defaultTransportFactory` VARIANT
- **G0016.R** (new; 1 DIFFERENT): `server/src/services/connection-test.service.ts:412 testSmtp` ANCHOR, `server/src/services/connection-test.service.ts:492 testEmail` VARIANT
- **G0018** (new; 1 DIFFERENT): `server/src/services/connection-test.service.ts:531 closeSftp` ANCHOR, `connectors/src/sftp/sftp-dispatcher.ts:106 safeEnd` VARIANT
- **G0025** (new; 2 DIFFERENT): `connectors/src/file/file-dispatcher.ts:187 writeFile` ANCHOR, `connectors/src/sftp/sftp-dispatcher.ts:94 writeRemote` VARIANT, `connectors/src/file/file-dispatcher.ts:181 appendToFile` VARIANT
- **G0026** (reopened, G0025 (accepted) covers 5 of 10; 8 DIFFERENT): `server/src/engine.ts:966 sendMessage` ANCHOR, `server/src/services/deployment.service.ts:441 sendMessage` SAME
- **G0026.R** (reopened, G0025 (accepted) covers 5 of 8; 5 DIFFERENT): `engine/src/pipeline/attachment-handler.ts:69 extract` ANCHOR, `engine/src/pipeline/attachment-handler.ts:88 extractRegex` VARIANT, `engine/src/pipeline/attachment-handler.ts:109 extractJavaScript` VARIANT
- **G0031** (reopened, G0030 (accepted) covers 2 of 3; 1 DIFFERENT): `core-util/src/hl7/hl7-message.ts:304 parseSegment` ANCHOR, `core-util/src/hl7/hl7-message.ts:321 parseMshSegment` VARIANT
- **G0038** (new; 1 DIFFERENT): `connectors/src/tcp-mllp/ack-builder.ts:70 classifyAckResponse` ANCHOR, `connectors/src/tcp-mllp/tcp-mllp-dispatcher.ts:280 toResponse` VARIANT
- **G0045** (new; 5 DIFFERENT): `server/src/controllers/user-preference.controller.ts:28 list` ANCHOR, `server/src/controllers/channel-revision.controller.ts:13 list` VARIANT, `server/src/controllers/attachment.controller.ts:13 list` VARIANT, `server/src/controllers/channel-export.controller.ts:15 exportChannel` VARIANT, `server/src/controllers/event.controller.ts:40 purge` VARIANT, `server/src/controllers/user-preference.controller.ts:42 getByKey` VARIANT, `server/src/controllers/user-preference.controller.ts:88 delete` VARIANT, `server/src/controllers/user-preference.controller.ts:58 upsert` VARIANT, `server/src/controllers/user-preference.controller.ts:73 bulkUpsert` VARIANT
- **G0045.R** (new; 3 DIFFERENT): `connectors/src/http/http-receiver.ts:222 handleRequest` ANCHOR, `connectors/src/http/http-receiver.ts:166 handler` VARIANT
- **G0048** (reopened, G0045 (accepted) covers 4 of 6; 4 DIFFERENT): `web/src/components/common/HeadersEditor.tsx:26 coerceHeaders` ANCHOR, `core-models/src/schemas/http-connector.schema.ts:39 parseHeaderLines` VARIANT
- **G0051.P2** (reopened, G0048.P2 (out-of-scope) covers 24 of 25): `server/src/controllers/alert.controller.ts:78 delete` ANCHOR, `server/src/controllers/collection.controller.ts:71 delete` SAME, `server/src/controllers/deployment.controller.ts:89 halt` VARIANT, `server/src/controllers/user.controller.ts:35 getById` VARIANT, `server/src/controllers/deployment.controller.ts:104 pause` VARIANT, `server/src/controllers/channel-group.controller.ts:84 delete` SAME, `server/src/controllers/user.controller.ts:147 unlock` VARIANT, `server/src/controllers/deployment.controller.ts:43 redeploy` VARIANT, `server/src/controllers/resource.controller.ts:25 getById` VARIANT, `server/src/controllers/user.controller.ts:134 getPermissions` VARIANT, `server/src/controllers/data-source.controller.ts:59 delete` VARIANT, `server/src/controllers/deployment.controller.ts:28 undeploy` VARIANT, `server/src/controllers/statistics.controller.ts:13 getChannelStats` VARIANT, `server/src/controllers/deployment.controller.ts:12 deploy` VARIANT, `server/src/controllers/channel.controller.ts:34 getById` VARIANT, `server/src/controllers/deployment.controller.ts:74 stop` VARIANT, `server/src/controllers/tag.controller.ts:70 delete` SAME, `server/src/controllers/code-template.controller.ts:130 deleteTemplate` SAME, `server/src/controllers/code-template.controller.ts:66 deleteLibrary` SAME, `server/src/controllers/deployment.controller.ts:59 start` VARIANT, `server/src/controllers/certificate.controller.ts:73 delete` SAME, `server/src/controllers/statistics.controller.ts:40 resetStats` VARIANT, `server/src/controllers/user.controller.ts:82 delete` VARIANT, `server/src/controllers/resource.controller.ts:72 delete` SAME, `server/src/controllers/deployment.controller.ts:119 resume` VARIANT
- **G0052** (reopened, G0049 (out-of-scope) covers 18 of 19; 4 DIFFERENT): `server/src/controllers/tag.controller.ts:53 update` ANCHOR, `server/src/controllers/extension.controller.ts:38 setEnabled` VARIANT, `server/src/controllers/collection.controller.ts:56 update` SAME, `server/src/controllers/channel-group.controller.ts:67 update` SAME, `server/src/controllers/code-template.controller.ts:113 updateTemplate` SAME, `server/src/controllers/channel.controller.ts:128 setEnabled` VARIANT, `server/src/controllers/data-source.controller.ts:46 update` VARIANT, `server/src/controllers/code-template.controller.ts:49 updateLibrary` SAME, `server/src/controllers/resource.controller.ts:55 update` SAME, `server/src/controllers/user.controller.ts:64 update` VARIANT, `server/src/controllers/alert.controller.ts:94 setEnabled` VARIANT, `server/src/controllers/alert.controller.ts:61 update` SAME, `server/src/controllers/channel.controller.ts:72 update` SAME, `server/src/controllers/certificate.controller.ts:56 update` SAME, `server/src/controllers/collection.controller.ts:112 updateRecord` VARIANT
- **G0052.R** (reopened, G0049 (out-of-scope) covers 3 of 4; 1 DIFFERENT): `server/src/services/alert.service.ts:479 setEnabled` ANCHOR, `server/src/services/channel.service.ts:1089 setEnabled` VARIANT, `server/src/services/extension.service.ts:95 setEnabled` VARIANT
- **G0054** (reopened, G0051 (out-of-scope) covers 18 of 22; 10 DIFFERENT): `server/src/controllers/certificate.controller.ts:40 create` ANCHOR, `server/src/controllers/user.controller.ts:48 create` VARIANT, `server/src/controllers/collection.controller.ts:98 createRecord` VARIANT, `server/src/controllers/channel.controller.ts:56 create` SAME, `server/src/controllers/resource.controller.ts:39 create` SAME, `server/src/controllers/alert.controller.ts:45 create` SAME, `server/src/controllers/collection.controller.ts:42 create` SAME, `server/src/controllers/code-template.controller.ts:97 createTemplate` SAME, `server/src/controllers/tag.controller.ts:37 create` SAME, `server/src/controllers/data-source.controller.ts:33 create` SAME, `server/src/controllers/code-template.controller.ts:33 createLibrary` SAME, `server/src/controllers/channel-group.controller.ts:51 create` SAME
- **G0054.R** (reopened, G0051 (out-of-scope) covers 6 of 10; 2 DIFFERENT): `server/src/services/channel-group.service.ts:114 create` ANCHOR, `server/src/services/tag.service.ts:70 create` VARIANT, `server/src/services/collection.service.ts:104 create` VARIANT, `server/src/services/resource.service.ts:91 create` VARIANT, `server/src/services/data-source.service.ts:98 create` VARIANT, `server/src/services/certificate.service.ts:164 create` VARIANT, `server/src/services/alert.service.ts:285 create` VARIANT, `server/src/services/channel.service.ts:719 create` VARIANT
- **G0057** (reopened, G0054 (out-of-scope) covers 10 of 11; 4 DIFFERENT): `server/src/controllers/global-map.controller.ts:25 getByKey` ANCHOR, `server/src/controllers/settings.controller.ts:33 getByKey` SAME, `server/src/controllers/config-map.controller.ts:27 getByKey` VARIANT, `server/src/controllers/user-preference.controller.ts:42 getByKey` VARIANT, `server/src/controllers/global-map.controller.ts:69 delete` VARIANT, `server/src/controllers/config-map.controller.ts:74 delete` VARIANT, `server/src/controllers/settings.controller.ts:81 delete` VARIANT
- **G0074** (reopened, G0070 (accepted) covers 5 of 7; 5 DIFFERENT): `server/src/engine.ts:237 fail` ANCHOR, `connectors/src/dicom/dcmjs-dimse-adapter.ts:41 fail` SAME
- **G0076** (reopened, G0072 (accepted) covers 2 of 3; 1 DIFFERENT): `engine/src/runtime/queue-consumer.ts:333 alert` ANCHOR, `engine/src/runtime/queue-consumer.ts:327 alertOnce` VARIANT
- **G0077** (new; 1 DIFFERENT): `engine/src/sandbox/script-test-run.ts:97 errorResult` ANCHOR, `engine/src/sandbox/script-test-isolated.ts:60 errorResult` VARIANT
- **G0084** (new): `connectors/src/tls.ts:51 readPem` ANCHOR, `server/src/services/connector-tls-resolver.ts:48 optionalId` VARIANT
- **G0086** (new; 1 DIFFERENT): `engine/src/sandbox/script-type-checker.ts:149 checkScriptTypesBatch` ANCHOR, `engine/src/sandbox/script-type-check.ts:57 checkScriptTypes` VARIANT, `server/src/services/script-type-gate.service.ts:198 findTypeFailures` VARIANT
- **G0088** (new; 5 DIFFERENT): `engine/src/sandbox/script-compiler.ts:71 compileScript` ANCHOR, `server/src/engine.ts:1164 compileWithTemplates` VARIANT
- **G0091** (new; 1 DIFFERENT): `server/src/services/global-script.service.ts:106 update` ANCHOR, `server/src/services/server-backup.service.ts:505 restoreGlobalScript` VARIANT, `web/src/hooks/use-global-scripts.ts:29 useUpdateGlobalScripts` VARIANT
- **G0092** (new; 1 DIFFERENT): `server/src/services/global-script.service.ts:47 language` ANCHOR, `server/src/services/channel.service.ts:411 language` VARIANT
- **G0094** (new; 1 DIFFERENT): `engine/src/pipeline/xml-order.ts:80 occurrences` ANCHOR, `server/src/services/mirth-import.service.ts:1027 stringList` VARIANT
- **G0100** (reopened, G0091 (accepted) covers 5 of 6; 4 DIFFERENT): `server/src/lib/jwt.ts:52 verifyAccessToken` ANCHOR, `server/src/lib/jwt.ts:60 verifyRefreshToken` VARIANT
- **G0118** (reopened, G0109 (accepted) covers 1 of 2): `engine/src/alerts/action-dispatcher.ts:124 formatAlertContent` ANCHOR, `engine/src/alerts/action-dispatcher.ts:132 defaultAlertBody` VARIANT
- **G0119** (new; 2 DIFFERENT): `server/src/services/server-backup.service.ts:407 restoreTags` ANCHOR, `server/src/services/server-backup.service.ts:421 restoreChannelGroups` VARIANT, `server/src/services/server-backup.service.ts:457 restoreCodeTemplateLibraries` VARIANT, `server/src/services/server-backup.service.ts:475 restoreCodeTemplates` VARIANT, `server/src/services/server-backup.service.ts:435 restoreResources` VARIANT, `server/src/services/server-backup.service.ts:658 restoreTagAssignments` VARIANT, `server/src/services/server-backup.service.ts:639 restoreGroupMemberships` VARIANT, `server/src/services/server-backup.service.ts:598 restoreChannelDependencies` VARIANT, `server/src/services/server-backup.service.ts:628 restoreGlobalMap` VARIANT, `server/src/services/server-backup.service.ts:617 restoreConfigMap` VARIANT, `server/src/services/server-backup.service.ts:309 restoreSettings` VARIANT, `server/src/services/server-backup.service.ts:556 restoreAlerts` VARIANT
- **G0143** (reopened, G0134 (out-of-scope) covers 6 of 9; 6 DIFFERENT): `server/src/services/global-map.service.ts:143 delete` ANCHOR, `server/src/services/config-map.service.ts:136 delete` VARIANT, `server/src/services/global-map.service.ts:59 persistRemoval` VARIANT
- **G0143.R** (reopened, G0134 (out-of-scope) covers 3 of 6; 3 DIFFERENT): `web/src/hooks/use-global-map.ts:52 useDeleteGlobalMapEntry` ANCHOR, `web/src/hooks/use-config-map.ts:56 useDeleteConfigMapEntry` VARIANT, `web/src/hooks/use-collections.ts:143 useDeleteRecord` VARIANT
- **G0146** (new; 2 DIFFERENT): `engine/src/runtime/global-map-proxy.ts:93 set` ANCHOR, `engine/src/runtime/global-map-proxy.ts:57 load` VARIANT, `engine/src/runtime/global-channel-map.ts:20 put` VARIANT
- **G0147** (reopened, G0138 (out-of-scope) covers 13 of 14; 9 DIFFERENT): `web/src/hooks/use-config-map.ts:38 useUpsertConfigMapEntry` ANCHOR, `web/src/hooks/use-collections.ts:115 useCreateRecord` VARIANT, `web/src/hooks/use-global-map.ts:37 useUpsertGlobalMapEntry` SAME, `web/src/hooks/use-preferences.ts:37 useUpsertPreference` VARIANT, `web/src/hooks/use-collections.ts:129 useUpdateRecord` VARIANT
- **G0147.R** (reopened, G0138 (out-of-scope) covers 8 of 9; 5 DIFFERENT): `server/src/services/config-map.service.ts:66 upsert` ANCHOR, `server/src/services/global-map.service.ts:107 upsert` VARIANT, `server/src/services/settings.service.ts:83 upsert` VARIANT, `server/src/services/user-preference.service.ts:61 upsert` VARIANT
- **G0155** (new; 2 DIFFERENT): `web/src/components/editors/surface-state.ts:63 onSurfaceApplied` ANCHOR, `server/src/services/global-map.service.ts:40 onChange` VARIANT
- **G0158.R** (reopened, G0149.R (accepted) covers 11 of 12; 10 DIFFERENT): `web/src/hooks/use-channels.ts:214 useDeleteChannel` ANCHOR, `scripts/soak.mjs:138 removeChannel` VARIANT
- **G0160.R** (reopened, G0151.R (out-of-scope) covers 19 of 23; 20 DIFFERENT): `server/src/services/deployment.service.ts:378 getStatus` ANCHOR, `server/src/services/deployment.service.ts:464 getDeployed` VARIANT, `server/src/engine.ts:951 getRuntime` VARIANT
- **G0165** (new; 6 DIFFERENT): `server/src/services/script-type-gate.service.ts:104 connectorScripts` ANCHOR, `server/src/services/script-type-gate.service.ts:156 typeScriptScripts` VARIANT
- **G0166.R** (reopened, G0048.P2 (out-of-scope) covers 1 of 9; 7 DIFFERENT): `server/src/engine.ts:563 deploy` ANCHOR, `server/src/engine.ts:581 deployChannel` VARIANT
- **G0177** (new; 1 DIFFERENT): `web/src/hooks/use-message-export.ts:21 buildExportQuery` ANCHOR, `web/src/hooks/use-messages.ts:80 buildSearchQuery` VARIANT
- **G0188** (new): `engine/src/pipeline/message-processor.ts:284 scriptReplacement` ANCHOR, `engine/src/sandbox/script-test-run.ts:53 replacement` SAME
- **G0189** (reopened, G0178 (accepted) covers 4 of 5; 1 DIFFERENT): `engine/src/sandbox/script-test-run.ts:57 asText` ANCHOR, `engine/src/pipeline/message-processor.ts:290 responseText` VARIANT, `engine/src/pipeline/data-type-handler.ts:247 serializeFromSandbox` VARIANT, `engine/src/pipeline/data-type-handler.ts:272 serializeTransformed` VARIANT
- **G0191** (new; 7 DIFFERENT): `server/src/services/collection.service.ts:294 requireById` ANCHOR, `server/src/services/collection.service.ts:383 requireByName` VARIANT, `server/src/services/collection.service.ts:99 getById` VARIANT
- **G0195** (reopened, G0184 (accepted) covers 7 of 9; 6 DIFFERENT): `server/src/services/collection.service.ts:306 insertRecord` ANCHOR, `server/src/services/collection.service.ts:230 createRecord` VARIANT, `server/src/services/collection.service.ts:168 store` VARIANT
- **G0195.R** (reopened, G0184 (accepted) covers 5 of 6; 4 DIFFERENT): `server/src/services/collection.service.ts:325 patchRecord` ANCHOR, `server/src/services/collection.service.ts:243 updateRecord` VARIANT
- **G0197** (reopened, G0186 (out-of-scope) covers 6 of 7; 4 DIFFERENT): `web/src/hooks/use-channels.ts:140 useChannels` ANCHOR, `web/src/hooks/use-alerts.ts:20 useAlerts` VARIANT, `web/src/hooks/use-collections.ts:102 useCollectionRecords` VARIANT
- **G0203** (reopened, G0193 (accepted) covers 5 of 6; 4 DIFFERENT): `connectors/src/tcp-mllp/tcp-mllp-receiver.ts:199 handleConnection` ANCHOR, `connectors/src/tcp-mllp/tcp-mllp-receiver.ts:124 onConnection` SAME
- **G0204** (new): `core-models/src/constants.ts:74 isSourceConnectorType` ANCHOR, `core-models/src/constants.ts:79 isDestinationConnectorType` VARIANT
- **G0206** (new; 2 DIFFERENT): `server/src/services/mirth-import.service.ts:399 sourceTypeFor` ANCHOR, `server/src/services/mirth-import.service.ts:406 destinationTypeFor` VARIANT
- **G0207** (new; 2 DIFFERENT): `server/src/services/message.service.ts:85 updateConnectorMessageStatus` ANCHOR, `server/src/services/message.service.ts:303 release` VARIANT, `server/src/db/seeds/seed-example-messages.ts:91 setConnectorStatus` VARIANT
- **G0211** (new; 1 DIFFERENT): `server/src/services/channel-export.service.ts:15 destinationMetaDataId` ANCHOR, `server/src/services/channel.service.ts:453 cloneMetaDataId` VARIANT
- **G0213** (reopened, G0202 (accepted) covers 2 of 3; 1 DIFFERENT): `server/src/services/channel-import.service.ts:249 resolveConnectorId` ANCHOR, `server/src/services/channel-import.service.ts:299 connectorFor` SAME
- **G0217** (reopened, G0206 (accepted) covers 2 of 3; 1 DIFFERENT): `engine/src/batch/batch-processor.ts:71 splitByDelimiter` ANCHOR, `engine/src/batch/batch-processor.ts:80 splitByRegex` VARIANT
- **G0219** (new; 1 DIFFERENT): `server/src/services/data-source.service.ts:161 delete` ANCHOR, `web/src/hooks/use-datasources.ts:79 useDeleteDataSource` VARIANT
- **G0221** (reopened, G0210 (out-of-scope) covers 8 of 13; 3 DIFFERENT): `server/src/db/seeds/seed-showcase.ts:187 seedGlobalMap` ANCHOR, `server/src/db/seeds/seed-showcase.ts:208 seedConfigMap` VARIANT, `server/src/db/seeds/seed-showcase.ts:166 seedGlobalScripts` VARIANT, `server/src/db/seeds/seed-showcase.ts:67 seedResources` VARIANT, `server/src/db/seeds/seed-showcase.ts:90 seedCollection` VARIANT, `server/src/db/seeds/seed-showcase.ts:124 seedCodeTemplate` VARIANT, `server/src/db/seeds/seed-showcase.ts:269 seedAlert` VARIANT, `server/src/db/seeds/seed-showcase.ts:230 seedDataSource` VARIANT, `server/src/db/seeds/seed-showcase.ts:374 seedHeadlineChannel` VARIANT, `server/src/db/seeds/seed-examples.ts:152 seedExampleChannels` VARIANT
- **G0225** (reopened, G0214 (accepted) covers 3 of 4): `connectors/src/kafka/kafka-client.ts:40 parseBrokers` ANCHOR, `web/src/components/channels/source/DelimitedSettings.tsx:47 readColumnNames` SAME, `web/src/lib/collections.ts:16 parseFields` VARIANT, `docs/research/voice-of-user/clusters.mjs:3 k` VARIANT
- **G0226** (new; 1 DIFFERENT): `server/src/lib/openapi.ts:45 openApiErrorResponse` ANCHOR, `server/src/lib/openapi.ts:26 successResponse` VARIANT
- **G0236** (reopened, G0225 (accepted) covers 4 of 6; 3 DIFFERENT): `engine/src/sandbox/script-test-isolated.ts:116 finish` ANCHOR, `server/src/services/connection-test.service.ts:284 finish` VARIANT, `engine/src/sandbox/sandbox-executor.ts:701 finish` VARIANT
- **G0237** (reopened, G0226 (accepted) covers 3 of 4; 2 DIFFERENT): `connectors/src/dicom/dcmjs-dimse-adapter.ts:38 ok` ANCHOR, `scripts/bench-throughput.mjs:74 ok` SAME
- **G0240** (reopened, G0229 (accepted) covers 2 of 3; 1 DIFFERENT): `server/src/services/event-export.service.ts:74 exportAsCsv` ANCHOR, `server/src/services/event-export.service.ts:84 exportAsJson` VARIANT
- **G0250** (new; 1 DIFFERENT): `server/src/lib/event-emitter.ts:35 emitSuccessEvent` ANCHOR, `server/src/services/auth.service.ts:32 auditLoginFailure` VARIANT, `server/src/lib/event-emitter.ts:21 emitEvent` VARIANT
- **G0260** (reopened, G0249 (accepted) covers 2 of 6; 3 DIFFERENT): `connectors/src/sftp/sftp-receiver.ts:272 postProcess` ANCHOR, `connectors/src/file/file-receiver.ts:327 postProcess` VARIANT, `connectors/src/email/email-receiver.ts:334 postProcess` VARIANT
- **G0260.R** (new; 1 DIFFERENT): `connectors/src/sftp/sftp-receiver.ts:242 processFile` ANCHOR, `connectors/src/file/file-receiver.ts:284 processFile` VARIANT
- **G0261** (new): `connectors/src/file/file-receiver.ts:302 readMessage` ANCHOR, `connectors/src/sftp/sftp-receiver.ts:257 downloadMessage` VARIANT
- **G0265** (reopened, G0253 (accepted) covers 1 of 2): `server/src/services/channel.service.ts:550 syncFilters` ANCHOR, `server/src/db/seeds/seed-examples.ts:101 addSourceFilter` VARIANT
- **G0268** (reopened, G0256 (accepted) covers 1 of 2): `server/src/services/channel.service.ts:593 syncTransformers` ANCHOR, `server/src/db/seeds/seed-examples.ts:124 addSourceTransformer` VARIANT
- **G0269** (new; 1 DIFFERENT): `engine/src/sandbox/script-compiler.ts:287 compileTransformerStepsToScript` ANCHOR, `server/src/services/script-type-gate.service.ts:87 joinedSteps` VARIANT
- **G0271** (reopened, G0407 (out-of-scope) covers 1 of 2): `web/src/pages/DataSourcesPage.tsx:89 setField` ANCHOR, `web/src/components/channels/common/connector-properties.ts:63 update` VARIANT
- **G0281.R** (reopened, G0267 (accepted) covers 1 of 2): `server/src/services/email.service.ts:51 setTransportFactory` ANCHOR, `server/src/services/connection-test.service.ts:95 setSftpClientFactory` SAME
- **G0294** (reopened, G0279 (accepted) covers 1 of 2): `server/src/lib/role-permissions.ts:31 permissionRowsForRole` ANCHOR, `server/src/lib/role-permissions.ts:57 permissionNamesForRole` VARIANT
- **G0295** (new): `server/src/middleware/permission.middleware.ts:15 requirePermission` ANCHOR, `server/src/middleware/permission.middleware.ts:44 requireAllPermissions` VARIANT
- **G0314** (reopened, G0220 (accepted) covers 1 of 8; 6 DIFFERENT): `connectors/src/amqp/amqp-receiver.ts:276 giveUp` ANCHOR, `connectors/src/kafka/kafka-receiver.ts:269 giveUp` VARIANT
- **G0314.R** (reopened, G0220 (accepted) covers 1 of 6; 4 DIFFERENT): `connectors/src/amqp/amqp-receiver.ts:253 notStored` ANCHOR, `connectors/src/kafka/kafka-receiver.ts:254 notStored` VARIANT
- **G0315** (new; 5 DIFFERENT): `connectors/src/kafka/kafka-receiver.ts:67 toRawMessage` ANCHOR, `connectors/src/amqp/amqp-receiver.ts:47 toRawMessage` VARIANT
- **G0315.R** (new; 3 DIFFERENT): `connectors/src/amqp/amqp-receiver.ts:213 dispatchDelivery` ANCHOR, `connectors/src/kafka/kafka-receiver.ts:212 dispatchRecord` VARIANT
- **G0316** (new; 4 DIFFERENT): `engine/src/sandbox/script-type-check.ts:36 onlySyntaxWhileBroken` ANCHOR, `web/src/components/editors/editor-hooks.ts:123 syntaxMarkers` VARIANT
- **G0320** (new): `web/src/components/editors/monaco.ts:93 applyScriptSurface` ANCHOR, `web/src/components/editors/ScriptEditor.tsx:181 apply` SAME
- **G0323** (new): `connectors/src/kafka/kafka-receiver.ts:171 isCurrent` ANCHOR, `connectors/src/amqp/amqp-receiver.ts:159 isCurrent` SAME
- **G0324** (new; 2 DIFFERENT): `connectors/src/kafka/kafka-receiver.ts:176 run` ANCHOR, `connectors/src/amqp/amqp-receiver.ts:164 watch` VARIANT
- **G0325** (new): `server/src/services/server-backup.service.ts:380 restoreRow` ANCHOR, `server/src/services/server-backup.service.ts:395 upsertMapEntry` VARIANT
- **G0337** (new): `engine/src/runtime/global-channel-map.ts:55 applyChanges` ANCHOR, `engine/src/runtime/global-map-proxy.ts:80 applyChanges` VARIANT
- **G0344** (reopened, G0306 (out-of-scope) covers 4 of 6; 3 DIFFERENT): `server/src/services/settings.service.ts:120 bulkUpsert` ANCHOR, `server/src/services/config-map.service.ts:98 bulkUpsert` VARIANT, `server/src/services/user-preference.service.ts:113 bulkUpsert` VARIANT
- **G0344.R** (reopened, G0306 (out-of-scope) covers 2 of 3): `server/src/controllers/settings.controller.ts:66 bulkUpsert` ANCHOR, `server/src/controllers/config-map.controller.ts:59 bulkUpsert` SAME, `server/src/controllers/user-preference.controller.ts:73 bulkUpsert` VARIANT
- **G0345** (reopened, G0307 (out-of-scope) covers 20 of 21; 10 DIFFERENT): `server/src/controllers/resource.controller.ts:25 getById` ANCHOR, `server/src/controllers/user.controller.ts:35 getById` VARIANT, `server/src/controllers/channel-group.controller.ts:37 getById` SAME, `server/src/controllers/attachment.controller.ts:27 getById` VARIANT, `server/src/controllers/event.controller.ts:26 getById` SAME, `server/src/controllers/data-source.controller.ts:23 getById` VARIANT, `server/src/controllers/alert.controller.ts:31 getById` SAME, `server/src/controllers/channel.controller.ts:34 getById` VARIANT, `server/src/controllers/certificate.controller.ts:26 getById` SAME, `server/src/controllers/extension.controller.ts:24 getById` SAME, `server/src/controllers/collection.controller.ts:30 getById` SAME
- **G0345.R** (reopened, G0307 (out-of-scope) covers 9 of 10): `server/src/services/resource.service.ts:66 getById` ANCHOR, `server/src/services/attachment.service.ts:57 getById` VARIANT, `server/src/services/channel-group.service.ts:80 getById` VARIANT, `server/src/services/data-source.service.ts:90 getById` VARIANT, `server/src/services/event.service.ts:134 getById` VARIANT, `server/src/services/certificate.service.ts:148 getById` VARIANT, `server/src/services/collection.service.ts:99 getById` VARIANT, `server/src/services/alert.service.ts:270 getById` VARIANT, `server/src/services/channel.service.ts:706 getById` VARIANT, `server/src/services/extension.service.ts:83 getById` VARIANT
- **G0350** (reopened, G0047 (out-of-scope) covers 1 of 5; 3 DIFFERENT): `engine/src/runtime/global-channel-map.ts:35 clear` ANCHOR, `engine/src/runtime/global-map-proxy.ts:105 clear` VARIANT
- **G0353** (new; 2 DIFFERENT): `connectors/src/kafka/kafka-dispatcher.ts:92 close` ANCHOR, `connectors/src/amqp/amqp-dispatcher.ts:119 close` VARIANT
- **G0387** (new): `connectors/src/amqp/amqp-receiver.ts:226 handle` ANCHOR, `connectors/src/kafka/kafka-receiver.ts:225 handle` VARIANT
- **G0409** (reopened, G0048.P2 (out-of-scope) covers 1 of 5; 3 DIFFERENT): `engine/src/runtime/channel-runtime.ts:176 pause` ANCHOR, `server/src/services/deployment.service.ts:334 pause` VARIANT
- **G0409.R** (reopened, G0048.P2 (out-of-scope) covers 1 of 3; 1 DIFFERENT): `connectors/src/amqp/amqp-receiver.ts:308 pause` ANCHOR, `connectors/src/kafka/kafka-receiver.ts:292 pause` VARIANT
- **G0412** (reopened, G0371 (accepted) covers 4 of 5): `connectors/src/sftp/sftp-receiver.ts:178 pollCycle` ANCHOR, `connectors/src/email/email-receiver.ts:200 pollCycle` VARIANT, `connectors/src/file/file-receiver.ts:210 pollCycle` VARIANT, `connectors/src/database/database-receiver.ts:153 pollCycle` VARIANT, `connectors/src/javascript/javascript-receiver.ts:94 pollCycle` VARIANT
- **G0420** (new; 1 DIFFERENT): `connectors/src/sftp/sftp-receiver.ts:217 reconnect` ANCHOR, `connectors/src/email/email-receiver.ts:236 reconnect` VARIANT
- **G0421** (reopened, G0184 (accepted) covers 1 of 3; 1 DIFFERENT): `engine/src/runtime/global-channel-map.ts:40 toRecord` ANCHOR, `engine/src/runtime/global-map-proxy.ts:72 toRecord` SAME
- **G0423** (new): `engine/src/sandbox/script-compiler.ts:46 remember` ANCHOR, `engine/src/sandbox/script-type-checker.ts:75 remember` VARIANT
- **G0433** (new): `connectors/src/sftp/sftp-receiver.ts:318 safeDisconnect` ANCHOR, `connectors/src/email/email-receiver.ts:242 safeDisconnect` VARIANT
- **G0445** (new): `web/src/components/editors/editor-hooks.ts:92 suggestRoom` ANCHOR, `web/src/components/editors/editor-hooks.ts:106 useSuggestRoom` VARIANT
- **G0447** (reopened, G0060 (out-of-scope) covers 1 of 4; 2 DIFFERENT): `server/src/services/connection-test.service.ts:691 testConnection` ANCHOR, `server/src/services/data-source.service.ts:196 testConnection` VARIANT
- **G0452** (reopened, G0407 (out-of-scope) covers 14 of 21; 11 DIFFERENT): `server/src/controllers/certificate.controller.ts:56 update` ANCHOR, `server/src/controllers/channel.controller.ts:72 update` SAME, `server/src/controllers/data-source.controller.ts:46 update` VARIANT, `server/src/controllers/resource.controller.ts:55 update` SAME, `server/src/controllers/channel-group.controller.ts:67 update` SAME, `server/src/controllers/tag.controller.ts:53 update` SAME, `server/src/controllers/alert.controller.ts:61 update` SAME, `server/src/controllers/global-script.controller.ts:25 update` VARIANT, `server/src/controllers/user.controller.ts:64 update` VARIANT, `server/src/controllers/collection.controller.ts:56 update` SAME
- **G0452.R** (reopened, G0407 (out-of-scope) covers 4 of 11; 3 DIFFERENT): `server/src/services/collection.service.ts:128 update` ANCHOR, `server/src/services/data-source.service.ts:129 update` VARIANT, `server/src/services/certificate.service.ts:213 update` VARIANT, `server/src/services/resource.service.ts:139 update` VARIANT, `server/src/services/tag.service.ts:109 update` VARIANT, `server/src/services/channel-group.service.ts:156 update` VARIANT, `server/src/services/alert.service.ts:357 update` VARIANT, `server/src/services/channel.service.ts:874 update` VARIANT
- **G0461** (reopened, G0416 (accepted) covers 2 of 3; 1 DIFFERENT): `scripts/bench-throughput.mjs:178 worker` ANCHOR, `scripts/bench-throughput.mjs:220 worker` VARIANT


## Changes since the last run

### Resolved (49)

- G0003: `api.ts:37:get ~ api.ts:52:del`; `api.ts:37:get ~ client.ts:53:apiFetch`
- G0010.R: `output.ts:7:formatTable ~ gen-tables.mjs:18:table`
- G0013: `connector-properties.ts:30:getTls ~ tls.ts:40:readTlsServerOptions`; `connector-properties.ts:30:getTls ~ tls.ts:60:readTlsClientOptions` (+1 more)
- G0013.R: `database-receiver.ts:57:toPoolConfig ~ database-dispatcher.ts:32:toPoolConfig`
- G0015: `connector-tls-resolver.ts:81:resolveHttpSourceTls ~ connector-tls-resolver.ts:50:resolveHttpDestinationTls`
- G0015.R: `connection-test.service.ts:293:testHttp ~ connection-test.service.ts:239:testHttpsSourceHandshake`
- G0023: `ack-builder.ts:124:controlIdOf ~ soak.mjs:81:field`
- G0025.R: `engine.ts:163:parsedOrRaw ~ data-type-handler.ts:207:parseForSandbox`
- G0036: `DelimitedSettings.tsx:30:readEscapes ~ mirth-import.service.ts:1031:unescapeMirth`
- G0041: `api.ts:56:request ~ api.ts:42:post`; `api.ts:56:request ~ api.ts:47:put` (+1 more)
- G0045: `HeadersEditor.tsx:25:coerceHeaders ~ safe-http-fetch.ts:74:toHeaders`
- G0054.R: `global-map.controller.ts:69:delete ~ config-map.controller.ts:74:delete`; `global-map.controller.ts:69:delete ~ settings.controller.ts:81:delete` (+1 more)
- G0056: `server-backup.controller.ts:13:exportBackup ~ user-preference.controller.ts:13:list`
- G0061: `data-pruner.controller.ts:40:pruneChannel ~ event.controller.ts:40:purge`
- G0070.R: `error-info.ts:11:errorInfo ~ sandbox-executor.ts:646:toHostError`
- G0071: `QueryProvider.tsx:6:mutationErrorMessage ~ api.ts:104:describe`; `QueryProvider.tsx:6:mutationErrorMessage ~ ErrorState.tsx:25:toMessage`
- G0072: `output.ts:40:printError ~ output.ts:45:printSuccess`
- G0074.R: `mirth-code-templates.ts:80:idList ~ mirth-import.service.ts:943:extractStringArray`
- G0075: `mirth-import.service.ts:525:extractConnectorProperties ~ mirth-import.service.ts:1013:extractDataTypeProperties`
- G0076: `ScriptEditor.tsx:32:registerJsDefaults ~ ScriptEditor.tsx:55:registerTsDefaults`
- G0079: `HttpSourceForm.tsx:41:updateTls ~ HttpDestinationForm.tsx:38:updateTls`
- G0092: `login.ts:29:login ~ soak.mjs:100:login`
- G0113: `secret-redaction.ts:50:isSecretSetting ~ settings-catalog.ts:110:isSecret`
- G0131: `like.ts:10:containsPattern ~ collection.service.ts:375:likePattern`
- G0144: `format.ts:20:formatTimestamp ~ LogViewer.tsx:41:formatTimestamp`
- G0151.R: `deployment.service.ts:253:stop ~ deployment.service.ts:279:halt`
- G0156: `channel-export.service.ts:20:channelToExportEntry ~ secret-redaction.ts:110:redactChannelDetail`; `channel-export.service.ts:20:channelToExportEntry ~ channel.service.ts:416:buildCloneInput`
- G0167: `seed-showcase.ts:299:findChannelId ~ seed-examples.ts:22:findChannel`
- G0175: `message.service.ts:238:dequeue ~ queue-manager.service.ts:39:dequeue`
- G0178: `data-type-handler.ts:247:serializeFromSandbox ~ data-type-handler.ts:272:serializeTransformed`; `data-type-handler.ts:247:serializeFromSandbox ~ message-processor.ts:290:responseText`
- G0204: `database-dispatcher.ts:131:sendDirect ~ database-dispatcher.ts:143:sendWithTransaction`
- G0214: `collections.ts:16:parseFields ~ clusters.mjs:3:k`; `collections.ts:16:parseFields ~ DelimitedSettings.tsx:47:readColumnNames`
- G0216: `ChannelEditorPage.tsx:358:buildDestinationsPayload ~ channel.service.ts:400:buildCloneDestinations`
- G0225: `sandbox-executor.ts:701:finish ~ connection-test.service.ts:254:finish`
- G0228: `event.service.ts:44:buildWhereConditions ~ event-export.service.ts:31:buildExportWhereConditions`
- G0229.R: `use-events.ts:31:buildEventQueryString ~ use-event-export.ts:27:buildExportUrl`
- G0239: `collection.service.ts:414:emitCollectionEvent ~ auth.service.ts:33:auditLoginFailure`; `collection.service.ts:414:emitCollectionEvent ~ data-source.service.ts:221:emitDataSourceEvent`
- G0250: `file-dispatcher.ts:50:unknownPlaceholders ~ TemplatesSection.tsx:32:findUnknownVariables`
- G0267: `email.service.ts:54:setTransportFactory ~ connection-test.service.ts:66:setSmtpTransportFactory`
- G0268: `sftp-receiver.ts:329:loadLedgerFile ~ file-receiver.ts:361:loadLedgerFile`; `sftp-receiver.ts:329:loadLedgerFile ~ sftp-receiver.ts:354:addLedgerKeys`
- G0302: `destination-template.ts:18:asText ~ DelimitedSettings.tsx:80:asText`
- G0313: `file-receiver.ts:420:clearPollTimer ~ database-receiver.ts:326:clearPollTimer`; `file-receiver.ts:420:clearPollTimer ~ email-receiver.ts:339:clearPollTimer` (+2 more)
- G0331: `database-receiver.ts:334:drainPool ~ database-dispatcher.ts:183:drainPool`
- G0340: `channel.service.ts:174:findChannel ~ seed-examples.ts:22:findChannel`
- G0343: `hl7-message.ts:77:get ~ x12.ts:95:get`
- G0359: `sftp-receiver.ts:319:loadQuarantine ~ file-receiver.ts:351:loadQuarantine`
- G0370: `sftp-receiver.ts:375:persistQuarantine ~ file-receiver.ts:393:persistQuarantine`
- G0373: `email-receiver.ts:243:processMessage ~ tcp-mllp-receiver.ts:259:processMessage`
- G0379: `global-channel-map.ts:40:toRecord ~ global-map-proxy.ts:70:toRecord`

### New, touching rows added since the last run (45)

- G0013.P16.R: `tls.ts:43:readTlsBag ~ connector-tls-resolver.ts:40:readTlsBag`
- G0013.P20: `http-connector.schema.ts:115:dropDestinationLegacy ~ tcp-mllp-connector.schema.ts:58:dropLegacyKeys`
- G0013.P28: `connector-tls-resolver.ts:59:resolveHttpDestinationTls ~ connector-tls-resolver.ts:70:resolveQueueTls`
- G0013.X: `registry.ts:162:tcpMllpReceiver ~ registry.ts:168:tcpMllpDispatcher`; `registry.ts:162:tcpMllpReceiver ~ registry.ts:189:httpReceiver` (+3 more)
- G0013.X.R: `tls.ts:99:readTlsClientOptions ~ registry.ts:124:readQueueTls`; `tls.ts:99:readTlsClientOptions ~ registry.ts:135:readHttpSourceTls` (+1 more)
- G0014: `connector-properties.ts:12:getStr ~ connection-test.service.ts:167:requireString`; `connector-properties.ts:12:getStr ~ connection-test.service.ts:499:optionalString` (+3 more)
- G0018: `connection-test.service.ts:531:closeSftp ~ sftp-dispatcher.ts:106:safeEnd`
- G0048: `HeadersEditor.tsx:26:coerceHeaders ~ http-connector.schema.ts:39:parseHeaderLines`
- G0077: `script-test-run.ts:97:errorResult ~ script-test-isolated.ts:60:errorResult`
- G0084: `tls.ts:51:readPem ~ connector-tls-resolver.ts:48:optionalId`
- G0086: `script-type-checker.ts:149:checkScriptTypesBatch ~ script-type-check.ts:57:checkScriptTypes`; `script-type-checker.ts:149:checkScriptTypesBatch ~ script-type-gate.service.ts:198:findTypeFailures`
- G0091: `global-script.service.ts:106:update ~ server-backup.service.ts:505:restoreGlobalScript`; `global-script.service.ts:106:update ~ use-global-scripts.ts:29:useUpdateGlobalScripts`
- G0092: `global-script.service.ts:47:language ~ channel.service.ts:411:language`
- G0094: `xml-order.ts:80:occurrences ~ mirth-import.service.ts:1027:stringList`
- G0153: `format.ts:36:formatTimestamp ~ ChannelColumnCells.tsx:58:formatUpdated`; `format.ts:36:formatTimestamp ~ LogViewer.tsx:54:formatClockTime` (+1 more)
- G0153.R: `action-dispatcher.ts:143:alertTime ~ message-export.service.ts:41:toIso`; `action-dispatcher.ts:143:alertTime ~ collections.ts:52:fromDateTimeLocal`
- G0155: `surface-state.ts:63:onSurfaceApplied ~ global-map.service.ts:40:onChange`
- G0165: `script-type-gate.service.ts:104:connectorScripts ~ script-type-gate.service.ts:156:typeScriptScripts`
- G0188: `message-processor.ts:284:scriptReplacement ~ script-test-run.ts:53:replacement`
- G0189: `script-test-run.ts:57:asText ~ data-type-handler.ts:247:serializeFromSandbox`; `script-test-run.ts:57:asText ~ data-type-handler.ts:272:serializeTransformed` (+1 more)
- G0204: `constants.ts:74:isSourceConnectorType ~ constants.ts:79:isDestinationConnectorType`
- G0206: `mirth-import.service.ts:399:sourceTypeFor ~ mirth-import.service.ts:406:destinationTypeFor`
- G0211: `channel-export.service.ts:15:destinationMetaDataId ~ channel.service.ts:453:cloneMetaDataId`
- G0225: `kafka-client.ts:40:parseBrokers ~ clusters.mjs:3:k`; `kafka-client.ts:40:parseBrokers ~ DelimitedSettings.tsx:47:readColumnNames` (+1 more)
- G0236: `script-test-isolated.ts:116:finish ~ sandbox-executor.ts:701:finish`; `script-test-isolated.ts:116:finish ~ connection-test.service.ts:284:finish`
- G0250: `event-emitter.ts:35:emitSuccessEvent ~ event-emitter.ts:21:emitEvent`; `event-emitter.ts:35:emitSuccessEvent ~ auth.service.ts:32:auditLoginFailure`
- G0261: `file-receiver.ts:302:readMessage ~ sftp-receiver.ts:257:downloadMessage`
- G0263: `base.ts:124:fillVariables ~ channel-dispatcher.ts:33:resolveTarget`; `base.ts:124:fillVariables ~ smtp-dispatcher.ts:108:substituteTemplate` (+4 more)
- G0269: `script-compiler.ts:287:compileTransformerStepsToScript ~ script-type-gate.service.ts:87:joinedSteps`
- G0281.R: `email.service.ts:51:setTransportFactory ~ connection-test.service.ts:95:setSftpClientFactory`
- G0314: `amqp-receiver.ts:276:giveUp ~ kafka-receiver.ts:269:giveUp`
- G0314.R: `amqp-receiver.ts:253:notStored ~ kafka-receiver.ts:254:notStored`
- G0315: `kafka-receiver.ts:67:toRawMessage ~ amqp-receiver.ts:47:toRawMessage`
- G0315.R: `amqp-receiver.ts:213:dispatchDelivery ~ kafka-receiver.ts:212:dispatchRecord`
- G0316: `script-type-check.ts:36:onlySyntaxWhileBroken ~ editor-hooks.ts:123:syntaxMarkers`
- G0320: `monaco.ts:93:applyScriptSurface ~ ScriptEditor.tsx:181:apply`
- G0323: `kafka-receiver.ts:171:isCurrent ~ amqp-receiver.ts:159:isCurrent`
- G0324: `kafka-receiver.ts:176:run ~ amqp-receiver.ts:164:watch`
- G0325: `server-backup.service.ts:380:restoreRow ~ server-backup.service.ts:395:upsertMapEntry`
- G0353: `kafka-dispatcher.ts:92:close ~ amqp-dispatcher.ts:119:close`
- G0387: `amqp-receiver.ts:226:handle ~ kafka-receiver.ts:225:handle`
- G0409.R: `amqp-receiver.ts:308:pause ~ kafka-receiver.ts:292:pause`
- G0421: `global-channel-map.ts:40:toRecord ~ global-map-proxy.ts:72:toRecord`
- G0423: `script-compiler.ts:46:remember ~ script-type-checker.ts:75:remember`
- G0445: `editor-hooks.ts:92:suggestRoom ~ editor-hooks.ts:106:useSuggestRoom`

### Second-level residuals not judged (56 groups, 249 members)

G0074.R.R (4), G0160.R.R (20), G0452.R.R (3), G0314.R.R (4), G0143.R.R (3), G0013.X.R.R (15), G0158.R.R (10), G0167.R.R (11), G0215.R.R (3), G0184.R.R (6), G0407.R.R (3), G0153.R.R (7), G0026.R.R (5), G0203.R.R (3), G0197.R.R (3), G0019.R.R (2), G0191.R.R (6), G0166.R.R (7), G0350.R.R (2), G0220.R.R (4), G0182.R.R (4), G0195.R.R (4), G0315.R.R (3), G0088.R.R (4), G0048.R.R (3), G0232.R.R (4), G0089.R.R (3), G0328.R.R (2), G0100.R.R (3), G0432.R.R (3), G0037.R.R (2), G0104.R.R (2), G0132.R.R (2), G0438.R.R (2), G0275.R.R (2), G0276.R.R (4), G0316.R.R (3), G0021.R.R (3), G0266.R.R (2), G0312.R.R (6), G0221.R.R (2), G0267.R.R (2), G0072.R.R (3), G0027.R.R (3), G0135.R.R (3), G0165.R.R (5), G0079.R.R (9), G0317.R.R (2), G0236.R.R (2), G0134.R.R (3), G0080.R.R (19), G0247.R.R (2), G0054.R.R (2), G0147.R.R (5), G0045.R.R (3), G0013.P23.R.R (2)

### Removed rows by file (64 rows, 38 files)

`packages/cli/src/lib/api.ts` 6, `packages/cli/src/lib/output.ts` 4, `packages/connectors/src/file/file-receiver.ts` 4, `packages/connectors/src/sftp/sftp-receiver.ts` 4, `packages/connectors/src/database/database-dispatcher.ts` 3, `packages/web/src/components/editors/ScriptEditor.tsx` 3, `packages/cli/src/commands/export-import.ts` 2, `packages/cli/src/commands/login.ts` 2, `packages/cli/src/index.ts` 2, `packages/cli/src/lib/config-path.ts` 2, `packages/server/src/lib/secret-redaction.ts` 2, `packages/server/src/services/collection.service.ts` 2, `packages/server/src/services/mirth-import.service.ts` 2, `packages/web/src/components/channels/source/DelimitedSettings.tsx` 2, `packages/cli/src/commands/channels.ts` 1, `packages/cli/src/commands/deploy.ts` 1, `packages/cli/src/commands/users.ts` 1, `packages/cli/src/lib/config-store.ts` 1, `packages/cli/src/lib/prompt.ts` 1, `packages/connectors/src/database/database-receiver.ts` 1, `packages/engine/src/pipeline/destination-template.ts` 1, `packages/server/src/db/seeds/seed-examples.ts` 1, `packages/server/src/db/seeds/seed-showcase.ts` 1, `packages/server/src/services/connector-validation.service.ts` 1, `packages/server/src/services/data-source.service.ts` 1, `packages/server/src/services/event-export.service.ts` 1, `packages/server/src/services/event.service.ts` 1, `packages/server/src/services/mirth-code-templates.ts` 1, `packages/server/src/services/queue-manager.service.ts` 1, `packages/server/src/services/script-validation.service.ts` 1, `packages/web/src/components/channels/common/DatabaseVendorField.tsx` 1, `packages/web/src/components/channels/destinations/HttpDestinationForm.tsx` 1, `packages/web/src/components/channels/source/HttpSourceForm.tsx` 1, `packages/web/src/components/common/states/ErrorState.tsx` 1, `packages/web/src/components/system/LogViewer.tsx` 1, `packages/web/src/lib/settings-catalog.ts` 1, `packages/web/src/pages/MessageGeneratorPage.tsx` 1, `packages/web/src/providers/QueryProvider.tsx` 1
