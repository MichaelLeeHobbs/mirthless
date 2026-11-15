# Reinvention audit appendix

Run of 2026-11-15 at commit 7d1f6dd, a re-run against the catalog from 56d667d (2026-11-13). Every group's verdicts and the run evidence are in `verdicts.jsonl`, one line per member with its content hash.

## Canaries

Four functions were planted in a fake `packages/web/src/pages/ExportHistoryPage.tsx`, rebuilt from current sources because two of the last run's sources were removed. They went through describe, grouping, judging and the run like any other row, and are left out of every count in the report.

| Canary | Copied from | Planted difference | Grouped with source | Verdict | Shown by run |
|---|---|---|---|---|---|
| `renderWhen` | `lib/format.ts:20 formatTimestamp` | `""` instead of "—" for null, undefined or `''` | G0144 | VARIANT | yes: null, undefined, `''`, both zones |
| `humanReadableSize` | `lib/system-health.ts:28 formatBytes` (reduce instead of log) | stops at GB | G0128 | VARIANT | yes: 2^40 gives "1024.0 GB" vs "1.0 TB" |
| `explainFailure` | `cli/src/lib/api.ts:104 describe` | "unknown failure" for non-Errors | G0071 | VARIANT | yes: string, `''`, null, undefined, plain object |
| `formatBytes` (hex dump) | negative: shares the name and vocabulary | another job | G0309, G0040 | DIFFERENT | n/a |

## How the re-run reused the last run

- The tool from the last run's work folder was copied and run against the skill's 30 fixtures at its vendored commit; all 30 passed.
- `reuse` against the saved `rows.jsonl`: 1768 rows kept their descriptions, 146 changed and 159 added rows were described again (10 slices, Sonnet 5.5), 164 rows are gone.
- Mapping: 821 of 997 `domain_in` strings had a saved mapping; the other 176 went to one mapper against the frozen list. 29 came back unmatched; 28 became 14 new domains (D0202 to D0215: IP subnet list, data type name, X12 message text, X12 path, X12 path and value, data type properties, database vendor, delimited text, message variable map, X12 element text, markdown table cell text, parsed X12 message, response source setting, research theme record). "plain text" (one identity function in `DelimitedSettings.tsx`) was mapped to D0173 "form field edit" instead of becoming a domain.
- A saved verdict was reused only when the unit's members, translated to their old IDs, were exactly a saved group's members and every content hash was unchanged. 257 units reused 1072 verdict lines; 145 units were judged again. Reused groups keep the last run's run evidence.
- Calibration: the last run's set used two controller copies that PR #77 removed, so it was rebuilt from real pairs: two `clearPollTimer` copies (SAME), two `fail` copies (SAME), File and SFTP `postProcess` (VARIANT), HL7 `formatTimestamp` vs `LogViewer.formatTimestamp` (DIFFERENT), `validate` middleware vs script `validate` (DIFFERENT). Two fresh judges with the frozen brief matched all five.

## Changes since the last run

### Resolved (43)

- G0008: `message-export.service.ts:45:escapeCsvField ~ event-export.service.ts:87:escapeCsvField`
- G0010: `ChannelDestinationForm.tsx:20:getBool ~ DatabaseDestinationForm.tsx:27:getBool`; `ChannelDestinationForm.tsx:20:getBool ~ FileDestinationForm.tsx:31:getBool` (+6 more)
- G0011: `HttpDestinationForm.tsx:28:getNum ~ registry.ts:35:num`; `HttpDestinationForm.tsx:28:getNum ~ connection-test.service.ts:173:requireNumber` (+14 more)
- G0012: `connector-tls-resolver.ts:33:readTlsBag ~ tls.ts:40:readTlsServerOptions`; `connector-tls-resolver.ts:33:readTlsBag ~ tls.ts:60:readTlsClientOptions` (+2 more)
- G0012.R: `connection-test.service.ts:514:testConnection ~ connection-test.service.ts:210:testTcpMllp`; `connection-test.service.ts:514:testConnection ~ data-source.service.ts:196:testConnection`
- G0013: `DatabaseSourceForm.tsx:21:getStr ~ connection-test.service.ts:164:requireString`; `DatabaseSourceForm.tsx:21:getStr ~ ChannelDestinationForm.tsx:15:getStr` (+17 more)
- G0039: `http-receiver.ts:203:handleRequest ~ http-receiver.ts:147:handler`
- G0044.P2.R: `statistics.controller.ts:28:getChannelStats ~ channel-export.controller.ts:15:exportChannel`; `statistics.controller.ts:28:getChannelStats ~ message.controller.ts:54:getDetail` (+2 more)
- G0044.P3: `user.controller.ts:157:unlock ~ user.controller.ts:45:getById`; `user.controller.ts:157:unlock ~ user.controller.ts:92:delete`
- G0046.R: `channel-group.service.ts:114:create ~ alert.service.ts:285:create`; `channel-group.service.ts:114:create ~ certificate.service.ts:164:create` (+6 more)
- G0056: `pruner-scheduler.controller.ts:37:updateSchedule ~ data-pruner.controller.ts:56:pruneChannel`; `pruner-scheduler.controller.ts:37:updateSchedule ~ event.controller.ts:50:purge`
- G0058: `mirth-import.service.ts:433:getNestedRecord ~ data-type-handler.ts:118:childOf`
- G0060: `secret-redaction.ts:70:isPlainObject ~ xml-order.ts:70:isRecord`; `secret-redaction.ts:70:isPlainObject ~ channel-import.service.ts:27:isPlainObject` (+1 more)
- G0062.P1: `controller-helpers.ts:9:mapErrorToStatus ~ alert.controller.ts:17:mapErrorToStatus`; `controller-helpers.ts:9:mapErrorToStatus ~ attachment.controller.ts:12:mapErrorToStatus` (+22 more)
- G0062.X: `controller-helpers.ts:9:mapErrorToStatus ~ channel-dependency.routes.ts:22:mapErrorToStatus`
- G0063.P4: `controller-helpers.ts:24:errorResponse ~ alert.controller.ts:24:errorResponse`; `controller-helpers.ts:24:errorResponse ~ attachment.controller.ts:17:errorResponse` (+18 more)
- G0063.X: `logger.ts:42:errorInfo ~ fatal-handlers.ts:22:describe`
- G0064: `channel.controller.ts:34:errorMessage ~ api.ts:104:describe`; `channel.controller.ts:34:errorMessage ~ data-pruner.controller.ts:22:errorMessage` (+5 more)
- G0064.R: `message.controller.ts:18:errorCode ~ data-pruner.controller.ts:17:errorCode`; `message.controller.ts:18:errorCode ~ statistics.controller.ts:16:errorCode` (+1 more)
- G0066: `engine.ts:1161:wireJavaScriptDestinations ~ engine.ts:1143:wireJavaScriptSource`
- G0068: `mirth-import.service.ts:519:convertFilters ~ mirth-import.service.ts:609:convertTransformers`
- G0072: `connection-pool.ts:100:queryReadOnly ~ connection-pool.ts:136:query`
- G0074: `HttpSourceForm.tsx:77:updateTls ~ HttpDestinationForm.tsx:74:updateTls`
- G0075: `connector-tls-resolver.ts:39:optionalId ~ HttpSourceForm.tsx:41:getTlsStr`
- G0081: `xml-order.ts:83:occurrences ~ mirth-import.service.ts:596:extractStringArray`
- G0116: `connection-pool.ts:104:runInTransaction ~ connection-pool.ts:90:transaction`
- G0124: `system-health.ts:28:formatBytes ~ ResourcesPage.tsx:46:formatBytes`
- G0138: `CertificateSelect.tsx:39:expiryLabel ~ CertificatesPage.tsx:61:getExpiryLabel`
- G0138.R: `CertificatesPage.tsx:55:getExpiryColor ~ CertificateSelect.tsx:33:expiryColor`
- G0139: `CertificatesPage.tsx:49:getExpiryDays ~ CertificateSelect.tsx:29:expiryDays`
- G0140: `MessageTable.tsx:46:formatTime ~ ChannelColumnCells.tsx:41:formatUpdated`; `MessageTable.tsx:46:formatTime ~ LogViewer.tsx:41:formatTimestamp` (+3 more)
- G0140.R: `hl7-timestamp.ts:7:formatTimestamp ~ message-export.service.ts:53:toIso`; `hl7-timestamp.ts:7:formatTimestamp ~ collections.ts:44:toDateTimeLocal`
- G0145: `channel-dependency.service.ts:78:getDependencies ~ channel-dependency.service.ts:103:getDependents`
- G0145.R: `channel-revision.service.ts:63:listRevisions ~ use-channel-revisions.ts:33:useChannelRevisions`
- G0152.R: `engine.ts:464:deploy ~ deployment.controller.ts:12:deploy`; `engine.ts:464:deploy ~ engine.ts:482:deployChannel`
- G0157.R: `message.service.ts:468:deleteContent ~ message.service.ts:508:deleteAttachments`
- G0205: `connection-pool.ts:59:create ~ connection-test.service.ts:48:defaultPoolFactory`
- G0240: `action-dispatcher.ts:145:substituteAlertTemplate ~ file-dispatcher.ts:33:resolveOutputFilename`; `action-dispatcher.ts:145:substituteAlertTemplate ~ smtp-dispatcher.ts:102:substituteTemplate`
- G0246: `TcpMllpDestinationForm.tsx:43:update ~ ChannelDestinationForm.tsx:37:update`; `TcpMllpDestinationForm.tsx:43:update ~ DatabaseDestinationForm.tsx:44:update` (+15 more)
- G0308: `api.ts:104:describe ~ fatal-handlers.ts:22:describe`
- G0311: `database-receiver.ts:311:drainPool ~ database-dispatcher.ts:192:drainPool`
- G0379: `HttpSourceForm.tsx:46:getTlsBool ~ HttpDestinationForm.tsx:44:getTlsBool`
- G0380: `HttpSourceForm.tsx:41:getTlsStr ~ HttpDestinationForm.tsx:39:getTlsStr`

### New, touching rows added since the last run (31)

- G0007: `ssrf.ts:65:isBlockedHostname ~ ssrf.ts:45:inList`; `ssrf.ts:65:isBlockedHostname ~ ssrf.ts:56:isBlockedAddress` (+2 more)
- G0009: `csv.ts:12:escapeCsvField ~ delimited.ts:112:writeValue`
- G0010: `message-export.service.ts:137:toCsv ~ delimited.ts:126:serializeDelimited`
- G0010.R: `output.ts:7:formatTable ~ gen-tables.mjs:18:table`
- G0011: `connector-properties.ts:24:getBool ~ connector-properties.ts:42:getTlsBool`
- G0012: `connection-test.service.ts:146:requireNumber ~ connector-properties.ts:18:getNum`
- G0013: `connector-properties.ts:30:getTls ~ tls.ts:40:readTlsServerOptions`; `connector-properties.ts:30:getTls ~ tls.ts:60:readTlsClientOptions` (+1 more)
- G0014: `connector-properties.ts:12:getStr ~ connection-test.service.ts:137:requireString`; `connector-properties.ts:12:getStr ~ DatabaseVendorField.tsx:19:databaseVendor` (+1 more)
- G0025.R: `engine.ts:163:parsedOrRaw ~ data-type-handler.ts:207:parseForSandbox`
- G0034: `hl7-message.ts:260:getSegmentCount ~ x12.ts:139:getSegmentCount`
- G0036: `DelimitedSettings.tsx:30:readEscapes ~ mirth-import.service.ts:1031:unescapeMirth`
- G0065: `data-type-handler.ts:45:isHl7MessageProxy ~ data-type-handler.ts:85:isX12MessageProxy`
- G0069: `controller-helpers.ts:9:mapErrorToStatus ~ user.controller.ts:17:userErrorStatus`
- G0070.R: `error-info.ts:11:errorInfo ~ sandbox-executor.ts:646:toHostError`
- G0074.R: `mirth-code-templates.ts:80:idList ~ mirth-import.service.ts:943:extractStringArray`
- G0078: `mysql-pool.ts:23:run ~ connection-pool.ts:110:queryReadOnly`; `mysql-pool.ts:23:run ~ mysql-pool.ts:123:statement`
- G0144: `format.ts:20:formatTimestamp ~ LogViewer.tsx:41:formatTimestamp`
- G0160: `message.service.ts:503:deleteContent ~ message.service.ts:153:removeContent`
- G0178: `data-type-handler.ts:247:serializeFromSandbox ~ data-type-handler.ts:272:serializeTransformed`; `data-type-handler.ts:247:serializeFromSandbox ~ message-processor.ts:290:responseText`
- G0202: `channel-import.service.ts:224:resolveConnectorId ~ channel-import.service.ts:271:connectorFor`
- G0212: `mirth-import.service.ts:711:portValue ~ x12.ts:29:number`
- G0214: `collections.ts:16:parseFields ~ clusters.mjs:3:k`; `collections.ts:16:parseFields ~ DelimitedSettings.tsx:47:readColumnNames`
- G0220: `message-processor.ts:893:storeAndAlertPostError ~ message-processor.ts:648:failUnexpected`; `message-processor.ts:893:storeAndAlertPostError ~ message-processor.ts:852:recordSendFailure` (+1 more)
- G0251: `base.ts:114:fillVariables ~ file-dispatcher.ts:34:resolveOutputFilename`; `base.ts:114:fillVariables ~ smtp-dispatcher.ts:104:substituteTemplate` (+3 more)
- G0257: `connector-properties.ts:61:update ~ DelimitedSettings.tsx:90:set`; `connector-properties.ts:61:update ~ DataSourcesPage.tsx:89:setField`
- G0271: `code-template.service.ts:104:createLibrary ~ code-template.controller.ts:33:createLibrary`; `code-template.service.ts:104:createLibrary ~ mirth-code-templates.ts:161:createLibrary` (+1 more)
- G0291: `delimited.ts:60:readField ~ delimited.ts:34:readQuoted`
- G0302: `destination-template.ts:18:asText ~ DelimitedSettings.tsx:80:asText`
- G0343: `hl7-message.ts:77:get ~ x12.ts:95:get`
- G0363: `registry.ts:36:num ~ connector-properties.ts:18:getNum`
- G0364: `mirth-import.service.ts:201:getNumber ~ x12.ts:29:number`

### Second-level residuals not judged (26 groups, 148 members)

G0013.R.R (16), G0151.R.R (20), G0407.R.R (2), G0204.R.R (3), G0160.R.R (8), G0156.R.R (9), G0365.R.R (2), G0148.R.R (4), G0394.R.R (2), G0144.R.R (6), G0173.R.R (5), G0272.R.R (4), G0155.R.R (6), G0193.R.R (2), G0197.R.R (4), G0199.R.R (2), G0092.R.R (2), G0210.R.R (2), G0036.R.R (2), G0074.R.R (10), G0075.R.R (18), G0055.R.R (2), G0051.R.R (9), G0043.R.R (3), G0127.R.R (2), G0385.R.R (3)

### Removed rows by file (164 rows, 59 files)

`packages/web/src/components/channels/destinations/HttpDestinationForm.tsx` 7, `packages/web/src/components/channels/source/HttpSourceForm.tsx` 7, `packages/web/src/components/channels/destinations/DatabaseDestinationForm.tsx` 6, `packages/web/src/components/channels/destinations/SftpDestinationForm.tsx` 6, `packages/web/src/components/channels/destinations/SmtpDestinationForm.tsx` 6, `packages/web/src/components/channels/source/FileSourceForm.tsx` 6, `packages/web/src/components/channels/source/SftpSourceForm.tsx` 6, `packages/web/src/components/channels/source/EmailSourceForm.tsx` 5, `packages/web/src/components/channels/destinations/ChannelDestinationForm.tsx` 4, `packages/web/src/components/channels/destinations/DicomDestinationForm.tsx` 4, `packages/web/src/components/channels/destinations/FhirDestinationForm.tsx` 4, `packages/web/src/components/channels/destinations/FileDestinationForm.tsx` 4, `packages/web/src/components/channels/destinations/TcpMllpDestinationForm.tsx` 4, `packages/web/src/components/channels/source/DatabaseSourceForm.tsx` 4, `packages/web/src/components/channels/source/DicomSourceForm.tsx` 4, `packages/web/src/components/channels/source/JavaScriptSourceForm.tsx` 4, `packages/web/src/components/channels/source/TcpMllpSourceForm.tsx` 4, `packages/web/src/pages/CertificatesPage.tsx` 4, `packages/server/src/controllers/data-pruner.controller.ts` 3, `packages/server/src/controllers/message.controller.ts` 3, `packages/server/src/controllers/statistics.controller.ts` 3, `packages/server/src/controllers/user.controller.ts` 3, `packages/server/src/services/connection-test.service.ts` 3, `packages/web/src/components/channels/common/CertificateSelect.tsx` 3, `packages/server/src/controllers/alert.controller.ts` 2, `packages/server/src/controllers/attachment.controller.ts` 2, `packages/server/src/controllers/certificate.controller.ts` 2, `packages/server/src/controllers/channel-group.controller.ts` 2, `packages/server/src/controllers/channel-revision.controller.ts` 2, `packages/server/src/controllers/channel.controller.ts` 2, `packages/server/src/controllers/code-template.controller.ts` 2, `packages/server/src/controllers/collection.controller.ts` 2, `packages/server/src/controllers/config-map.controller.ts` 2, `packages/server/src/controllers/data-source.controller.ts` 2, `packages/server/src/controllers/event.controller.ts` 2, `packages/server/src/controllers/extension.controller.ts` 2, `packages/server/src/controllers/global-map.controller.ts` 2, `packages/server/src/controllers/message-reprocess.controller.ts` 2, `packages/server/src/controllers/pruner-scheduler.controller.ts` 2, `packages/server/src/controllers/resource.controller.ts` 2, `packages/server/src/controllers/server-backup.controller.ts` 2, `packages/server/src/controllers/settings.controller.ts` 2, `packages/server/src/controllers/tag.controller.ts` 2, `packages/server/src/controllers/user-preference.controller.ts` 2, `packages/server/src/routes/channel-dependency.routes.ts` 2, `packages/web/src/components/channels/destinations/JavaScriptDestinationForm.tsx` 2, `packages/connectors/src/logger.ts` 1, `packages/connectors/src/transmission/mllp-mode.ts` 1, `packages/engine/src/pipeline/xml-order.ts` 1, `packages/server/src/lib/fatal-handlers.ts` 1, `packages/server/src/lib/secret-redaction.ts` 1, `packages/server/src/services/channel-import.service.ts` 1, `packages/server/src/services/event-export.service.ts` 1, `packages/server/src/services/message-export.service.ts` 1, `packages/server/src/services/mirth-import.service.ts` 1, `packages/web/src/components/messages/MessageTable.tsx` 1, `packages/web/src/pages/EventsPage.tsx` 1, `packages/web/src/pages/ResourcesPage.tsx` 1, `packages/web/src/pages/UsersPage.tsx` 1

The resolved groups PRs #73 to #80 account for: G0008, G0010, G0011, G0013, G0060, G0062.P1, G0062.X, G0063.P4, G0063.X, G0064, G0064.R, G0074, G0075, G0124, G0138, G0138.R, G0139, G0140, G0240, G0246, G0308, G0379, G0380. Several of the new groups are the same families seen from the shared helpers' new homes (G0011, G0012, G0013, G0014, G0069, G0070.R, G0144, G0251, G0257, G0363); the copies inside the new X12, Delimited, MySQL and research-script code are G0009, G0010, G0010.R, G0034, G0036, G0065, G0078, G0212, G0214, G0291, G0302, G0343, G0364.

## Per-key hits

Of the 82 copy groups judged this run: 47 were found only by the job key (canonical domain plus output kind), 9 only by the name stem, 11 by both, 1 by a cross-part group, and 14 by residual regrouping. The job key found the canary `humanReadableSize`, which shares no stem with its source.

Stop stems, too common to group by name: `delete` (30 rows), `list` (27). `update` and `maperrortostatus` are no longer stop stems: the controller copies are gone and `update` now groups (G0407).

## Run conditions

- Node v26.12.1 ran with no install and stripped TypeScript types natively. Every member was copied into its own harness; no repo code was imported. `ServiceError`'s parameter properties were rewritten as plain fields (type syntax only), and `mllp-mode.ts` `parse` ran as a standalone copy of its inner arrow.
- The zone probe worked: `2026-03-08T07:30:00Z` gave "3/8/2026, 3:30:00 AM" under America/New_York and "3/8/2026, 7:30:00 AM" under UTC. G0144 ran in both zones.
- Locale was en-US. The clock was fixed inside the harness by overriding `Date.now` for `formatUpdated` and `formatDuration`.
- Network could not be switched off on this Windows host. No member does network I/O.

## Notes on method

- 13 of the 186 groups that hold copies match only because a judge marked a delegating wrapper or a hook one layer up as VARIANT (a note naming a call, wrap or delegation). The same test gives 15 for the last run's 190; its report said 27 by a looser reading.
- Spend is estimated from subagent token totals at list price (Sonnet 5.5 $2/$10, Fable 5.2 $8/$40, Opus 5.5 $4/$20 per MTok), assuming 95% input. The coordinator is not counted. On a subscription plan the dollar figure is notional. The pre-run estimate was $33; each judge packet cost about 115K tokens whatever its size, which the estimate under-counted.
- The concurrent subagent cap on this host is 20, so the 30 judge packets ran in three waves.
- Five judges wrote their output under the temporary name and did not rename it; their files were complete and passed `check-judge` after the coordinator renamed them.
