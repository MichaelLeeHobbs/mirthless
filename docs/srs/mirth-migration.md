# Mirth migration

What a Mirth Connect channel export or server backup becomes when it is imported, what the preview must say before that, and how parity is measured. Area code `MIG`. Scripts are kept and rewritten by a person, never translated (README, Out of scope). Who may import, and into which group, is in [access.md](access.md).

## Importing (IMP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MIG-IMP-01 | The system shall import a channel export, a file holding several channels, and a server configuration backup written by Mirth Connect 3.0 to 4.5. | P1 | Test | Proposed |
| MIG-IMP-02 | The system shall preview an import, returning every channel and library as it would be imported and every warning, without writing, deploying or starting anything. | P1 | Test | Proposed |
| MIG-IMP-03 | The system shall refuse, with a reason and with nothing written, a file that is not a Mirth export, that holds no channel, or that declares a document type. | P1 | Test | Proposed |
| MIG-IMP-04 | Importing a file again shall, as the caller chooses, leave existing channels as they are, replace them, or make copies; with the first two choices it shall create no second channel, code template library or code template. | P1 | Test | Proposed |
| MIG-IMP-05 | An import shall not deploy, start or stop a channel, and a channel disabled in Mirth shall be created disabled, so a server restart does not start it either. | P1 | Test | Proposed |
| MIG-IMP-06 | When one channel of a file cannot be imported, the system shall name it and the reason, import none of that channel, and import the other channels; it shall then leave every code template unchanged. | P1 | Test | Proposed |
| MIG-IMP-07 | The system shall let a user upload a Mirth file, read its preview, choose what happens to channels that already exist, and import it, all in the admin console. | P2 | Demonstration | Proposed |

- MIG-IMP-01: source: docs/user/capabilities.md "Mirth migration" (channel export or server backup); D-237 (4.5 exports); D-245, D-301 (pre-3.5 and 3.0 to 3.2 forms are read). No document states the version range; 3.0 to 4.5 is what the code and its tests read.
- MIG-IMP-02: source: docs/user/capabilities.md "Mirth migration" introduction ("with a dry-run preview that returns warnings"); D-301.
- MIG-IMP-03: source: the importer's tests (DOCTYPE, no channel structure); they are the only source, so this is code behaviour proposed as a rule.
- MIG-IMP-04: source: docs/design/01-core-models.md "Channel Export/Import Format" (skip, overwrite, or create as new); D-242 (libraries matched by name, replaced only on overwrite).
- MIG-IMP-05: source: docs/user/capabilities.md "A disabled channel"; D-328 (an import keeps deploy control out of its hands); scenario S24 in e2e/scenarios/manifest.json.
- MIG-IMP-06: source: the import's tests ("leaves code templates untouched when a channel in the backup fails to import"); docs/user/access-control.md `code_templates:write`. Code behaviour proposed as a rule.
- MIG-IMP-07: source: docs/design/01-core-models.md "Mirth XML import" and "the import dialog offers"; README "Migration engineer". docs/user/capabilities.md documents only the API.

## Safety rules (SAFE)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MIG-SAFE-01 | For every setting in an imported channel that the system does not carry with the same behaviour, the preview shall warn, naming the channel, the connector, the setting, and what will happen instead, and quoting no password, key or token; no setting that changes what a message says, where it goes or who can reach it shall be dropped without a warning. | P1 | Test | Proposed |
| MIG-SAFE-02 | Where the nearest equivalent of a Mirth setting would lose, change, overwrite or expose data without anyone choosing it, the system shall import the safer behaviour, or import the channel disabled, with the reason in its warning and its description, whether it creates the channel or replaces an enabled one. | P1 | Test | Proposed |
| MIG-SAFE-03 | A connector that used TLS, a checked host key or sign-in in Mirth shall be imported with the same protection, or shall refuse to deploy until a person sets or removes it; it shall never be imported so that it listens or sends without it. | P1 | Test | Proposed |
| MIG-SAFE-04 | A connector class, file scheme, database vendor or database script mode that the system cannot run (today among them Web Service, JMS, Document Writer, FTP, SMB, S3, WebDAV, SQL Server and Oracle) shall be imported so that its channel refuses to deploy, with a preview warning that names it. | P1 | Test | Proposed |
| MIG-SAFE-05 | A data type (today NCPDP, HL7 v3 and DICOM), filter rule or transformer step (today Mapper, Iterator, XSLT and External Script) that the system cannot run as Mirth did shall be imported so that its channel refuses to deploy, with a preview warning that names it. | P1 | Test | Proposed |
| MIG-SAFE-06 | The preview of a server backup shall list every kind of content in it that the import leaves out, with how many of each (for example alerts, users, plugin settings). | P1 | Test | Proposed |
| MIG-SAFE-07 | The preview should say for each channel whether it will deploy as imported, deploy after named edits, or not deploy at all, and count per channel and in total the scripts to rewrite and the settings to fill in. | P2 | Test | Proposed |

- MIG-SAFE-01: source: D-301 ("carries a setting when GalvaniFlow behaves the same, and otherwise warns in the preview"); README "Migration engineer" ("with nothing silently changed"); #171, #178. docs/user/capabilities.md "Mirth migration" lists the rows with no warning today. A `${...}` reference the system cannot fill counts as such a setting: D-246 sends it as written, and only file names are warned about. The rule on credentials is from the importer's tests (a database URL is never quoted in a warning).
- MIG-SAFE-02: source: D-301; docs/user/capabilities.md "Storage mode, encryption and pruning" and "Polling by time of day or cron". Conflict: D-328 says an import over an existing channel keeps its enabled flag (#225), so the hold does not take effect on overwrite; the safer reading of D-301 kept.
- MIG-SAFE-03: source: D-301 and docs/user/capabilities.md "DICOM Listener and Sender" (TLS kept so the deploy refuses); docs/user/capabilities.md sftp row (host key). Conflict: docs/user/capabilities.md "HTTP Sender" lets a Digest sender deploy with its credentials dropped and a warning; the general rule kept.
- MIG-SAFE-04: source: docs/user/capabilities.md rows for Web Service, JMS, Document Writer, ftp/smb/s3/webdav, SQL Server or Oracle, and JavaScript mode; D-301 (no local folder named after a server). As ROADMAP 1, 2, 6, 7, 11 and 12 ship, the list shrinks and MIG-CON gains the connector. Conflict: docs/user/capabilities.md says a JavaScript-mode Database connector "fails as SQL" and Database URL rows refuse; refusing kept for both.
- MIG-SAFE-05: source: D-207 (a step the engine cannot run blocks the deploy); docs/user/capabilities.md "NCPDP, HL7 v3 and DICOM data types" ("Not confirmed", no warning) and "Mapper transformer steps" (does not deploy, no warning). Conflict: the capabilities page has NCPDP, HL7 v3 and DICOM passing through as text; D-207's rule kept.
- MIG-SAFE-06: source: README Scope ("Import Mirth Connect channels and server backups and say what must change"); D-301 read for a whole backup. No document says what else a backup holds is left out.
- MIG-SAFE-07: source: README "Migration engineer" ("Know before cutover what will not work"); docs/research/voice-of-user/ranking.md UPG3. The shape of the estimate is this draft's.

## Connectors (CON)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MIG-CON-01 | A TCP Listener or TCP Sender shall be imported as an MLLP connector with its address, port, frame bytes, character set and, for a Sender, message template. | P1 | Test | Proposed |
| MIG-CON-02 | An HTTP Listener shall be imported as an HTTP source serving every path under its context path with its response content type and status, with a warning naming the difference in how bodies with no declared character set and binary bodies are read. | P1 | Test | Proposed |
| MIG-CON-03 | An HTTP Sender shall be imported as an HTTP destination with its method, URL, headers, query parameters, body template, content type and Basic credentials. | P1 | Test | Proposed |
| MIG-CON-04 | A File Reader or File Writer on the local or SFTP scheme shall be imported as a connector that reads or writes the same folder, with its file filter, after-processing action, sort order, file age, dotfile rule, file name, append and temporary-file settings and character set. | P1 | Test | Proposed |
| MIG-CON-05 | An imported File connector shall never delete, move, overwrite or append to a file that Mirth would have left alone, and an imported DICOM Listener shall never delete a file it stored. | P1 | Test | Proposed |
| MIG-CON-06 | A Database Reader or Writer on a vendor the system supports shall be imported with its vendor, address, database, credentials, queries and update mode, a `${...}` reference kept for the deploy to resolve, and with a warning that a Reader's rows arrive as JSON. | P1 | Test | Proposed |
| MIG-CON-07 | An SMTP Sender shall be imported with its server, port, encryption, credentials, addresses, headers, subject, body, character set and attachments. | P1 | Test | Proposed |
| MIG-CON-08 | A Channel Reader or Writer shall be imported pointing at the channel it named in Mirth; when an import gives channels new IDs, references between channels of the same file shall point at the new channels. | P1 | Test | Proposed |
| MIG-CON-09 | A DICOM Listener or Sender shall be imported with its address, port, AE titles and storage folder, with a warning that a message is a file path here and for each option that has no equivalent. | P1 | Test | Proposed |
| MIG-CON-10 | A source that polls at an interval shall keep that interval; one that polls at a time of day, by cron or only on some days or hours, where the system cannot keep that schedule, shall be imported disabled with a warning that names it. | P1 | Test | Proposed |

- MIG-CON-01: source: docs/user/capabilities.md "TCP Listener" and "TCP Sender"; D-253; scenarios S01, S06, S18. The character set is added under MIG-SAFE-01: the capabilities rows do not list it.
- MIG-CON-02: source: docs/user/capabilities.md "HTTP Listener"; D-243; D-334; scenario S07.
- MIG-CON-03: source: docs/user/capabilities.md "HTTP Sender"; D-252; scenario S17. Digest is under MIG-SAFE-03.
- MIG-CON-04: source: docs/user/capabilities.md "File Reader and Writer, file scheme" and "sftp scheme"; D-304; scenarios S16, S28.
- MIG-CON-05: source: #178; D-301; D-304 ("reading a file meant for someone else is data loss").
- MIG-CON-06: source: docs/user/capabilities.md "Database Reader and Writer on PostgreSQL, MySQL or MariaDB"; D-182; D-259; scenarios S14, S15. docs/progress/ROADMAP.md 1 adds SQL Server and Oracle.
- MIG-CON-07: source: docs/user/capabilities.md "SMTP Sender" (server, credentials, addresses, subject, body); D-252; scenario S12. Headers, character set and attachments are added under MIG-SAFE-01; docs/progress/ROADMAP.md 9 says the connector sends attachments.
- MIG-CON-08: source: docs/user/capabilities.md "Channel Reader and Writer"; docs/design/01-core-models.md ("create as new (with new ID)"); scenarios S02, S09. The reference rule is not written anywhere: it follows from making copies.
- MIG-CON-09: source: docs/user/capabilities.md "DICOM Listener and Sender"; #171; D-301; scenario S29.
- MIG-CON-10: source: docs/user/capabilities.md "Polling by time of day or cron, or on some days or hours only"; D-301. Conflict: D-301 disables only time-of-day and cron polling and warns for limited days or hours; one rule for all three proposed, since each would poll when the partner did not expect it.

## Channel settings (SET)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MIG-SET-01 | HL7 v2, XML, JSON, Raw, Delimited and X12 data types shall be imported as the same type with the settings that decide how content is read, written, split and acknowledged: delimiters, quotes, column names, batch splitting, and the codes and texts of HL7 v2 acknowledgements. | P1 | Test | Proposed |
| MIG-SET-02 | JavaScript filter rules and transformer steps of the source, each destination and each destination's response shall be imported in Mirth's order, with their names, operators and enabled flags, on the connector they belong to. | P1 | Test | Proposed |
| MIG-SET-03 | A Rule Builder rule shall accept and reject the same messages as in Mirth: as a built rule where the two read the field alike, otherwise as the script Mirth generates for it, and as a rule that refuses to deploy where the import cannot read it. | P1 | Test | Proposed |
| MIG-SET-04 | Destinations shall keep their Mirth names, numbers, order, enabled flags and wait-for-previous settings, so scripts and response settings that refer to them still find the right one. | P1 | Test | Proposed |
| MIG-SET-05 | A destination's queue mode, retry count, retry interval and rotation shall be imported so that a message is neither given up sooner nor sent in another order than in Mirth, with a warning for a thread count or thread assignment the system does not apply. | P1 | Test | Proposed |
| MIG-SET-06 | The choice of what answers the sender (none, automatic at each of Mirth's three points, the postprocessor, or a named destination) shall be imported as the same choice; any other choice shall answer after the destinations with a warning. | P1 | Test | Proposed |
| MIG-SET-07 | Message storage mode, encryption, content and attachment removal, initial state and custom metadata columns shall be imported as set in Mirth. | P1 | Test | Proposed |
| MIG-SET-08 | Pruning shall be on after import only when it deletes nothing Mirth would have kept; otherwise it shall be off with Mirth's message age kept, and the preview shall say why. | P1 | Test | Proposed |

- MIG-SET-01: source: docs/user/capabilities.md rows for data types and "Process Batch on an HL7 v2 source"; D-254; D-257; D-258; scenarios S03, S19, S20, S21. Acknowledgement codes and texts are added under MIG-SAFE-01; docs/design/01-core-models.md lists HL7 v2 data type properties.
- MIG-SET-02: source: docs/user/capabilities.md "JavaScript filter rules and transformer steps"; D-241; scenarios S03, S13. The response transformer is added under MIG-SAFE-01: docs/user/capabilities.md has the feature ("Response transformers and response modes") but no migration row for it.
- MIG-SET-03: source: docs/user/capabilities.md "Rule Builder filter rules"; D-301.
- MIG-SET-04: source: the importer's tests (destinations keyed by the number in the export); D-239 ("Respond from" names one); D-241.
- MIG-SET-05: source: docs/user/capabilities.md "Destination queue settings" and "Multiple threads per destination queue" (No); D-230 (a retry count of 0 retries until delivered); scenario S06. How Mirth's retry count and its queue combine should be checked against Mirth before this is accepted.
- MIG-SET-06: source: docs/user/capabilities.md "Respond from a destination or the postprocessor"; D-239; D-255; scenarios S01, S26.
- MIG-SET-07: source: docs/user/capabilities.md "Storage mode, encryption and pruning" and "Custom metadata columns"; D-240; scenario S10.
- MIG-SET-08: source: D-301; docs/user/capabilities.md "Storage mode, encryption and pruning".

## Scripts (SCR)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MIG-SCR-01 | The system shall import every script exactly as Mirth held it, a JavaScript Reader's or Writer's included, except Mirth's default scripts that do nothing, which it leaves out; it shall never rewrite a script. | P1 | Test | Proposed |
| MIG-SCR-02 | The preview shall name, per channel and per code template, each Mirth-only construct that any script the import brings in uses (channel, filter, transformer, response, connector, global and code template scripts), with what to use instead. | P1 | Test | Proposed |

- MIG-SCR-01: source: D-244 (rewriting Mirth scripts at import rejected); D-245; docs/user/capabilities.md "Deploy, undeploy and postprocessor scripts" and "JavaScript Reader and Writer"; scenarios S08, S11.
- MIG-SCR-02: source: D-245; docs/user/capabilities.md "Mirth migration" introduction and "JavaScript Reader and Writer" ("Only for Mirth-only constructs in the script"). Conflict: that row says connector scripts are checked; the code checks channel, filter and transformer scripts only.

## Server backups (BAK)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MIG-BAK-01 | Code template libraries in a server backup or a channel export shall be imported matched by name, with their templates, contexts and channel scope, an existing one replaced only when the caller chose to replace; a library whose exclusion list cannot be kept shall carry a warning. | P1 | Test | Proposed |
| MIG-BAK-02 | The configuration map, global scripts, channel groups, tags, channel dependencies and alerts in a server backup shall be imported, each kind only when the caller chooses it, never replacing an existing one unless the caller chose to replace. | P2 | Test | Proposed |

- MIG-BAK-01: source: docs/user/capabilities.md "Code template libraries in a server backup"; D-242; D-249; scenarios S04, S25. A channel export can carry libraries too; only the server backup is read today.
- MIG-BAK-02: source: README Scope ("server backups"); doc 01 "Channel Export/Import Format" (a backup holds global scripts and the configuration map). Scenario S05 has the operator enter the map by hand. Conflict: scenario S23 says alerts "are server settings an operator recreates rather than channel exports"; importing is this draft's reading of the Scope line.

## Parity (PAR)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| MIG-PAR-01 | Every Mirth migration scenario that passed for the previous release shall pass before a release, each one importing a file in the form Mirth exports, deploying it, and checking what real partner systems receive. | P1 | Demonstration | Proposed |
| MIG-PAR-02 | The user documentation shall say what each Mirth feature becomes, whether it deploys and whether the preview warns, kept true by a check that fails when it and the importer disagree, and how to preview, import, rewrite, compare side by side and cut over. | P2 | Inspection | Proposed |

- MIG-PAR-01: source: D-237; docs/testing/migration-scenarios.md; AGENTS.md verification matrix ("nothing that passed may fail"); docs/progress/ROADMAP.md "Mirth migration suite" (65/65 on 2026-11-15). The suite runs on a developer machine only (docs/user/capabilities.md "Mirth migration").
- MIG-PAR-02: source: docs/user/capabilities.md "Mirth migration"; D-279; docs/design/12-connector-parity-gap-analysis.md section 7 ("which a docs guard keeps current"); docs/research/voice-of-user/ranking.md UPG3 ("prove behaviour is the same"). The step-by-step guide has no other source.
