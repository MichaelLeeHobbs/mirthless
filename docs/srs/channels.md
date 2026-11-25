# Channels

How a channel is made, changed, deployed, compared, moved between servers and tested, for interface developers, operators and automation. Area code `CHAN`. What happens to a message inside a channel is in [Pipeline](pipeline.md), who may do each thing in [Access control](access.md), scripts and code templates in [Scripting](scripting.md), and channels that come from Mirth in [Mirth migration](mirth-migration.md).

## Editing (EDIT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CHAN-EDIT-01 | The system shall let an authorized user create, read, change and delete channels in the browser and over the API, and a save that fails shall leave the stored channel as it was before. | P1 | Test | Proposed |
| CHAN-EDIT-02 | An import over a channel, a restore of it, and enabling or disabling it shall each count as a change to the channel, so that a save made from the version before is refused as a conflict. | P1 | Test | Proposed |
| CHAN-EDIT-03 | A channel update shall leave every setting it does not name as stored, at every depth, encryption, storage mode, pruning and enabled included. | P1 | Test | Proposed |
| CHAN-EDIT-04 | The system shall keep each destination's identity through every save, rename and reorder, and shall never give a removed destination's identity to another, so that a queued message, a resend or a statistic never moves to a different destination. | P1 | Test | Proposed |
| CHAN-EDIT-05 | A cloned channel shall start disabled and shall have every setting, script, filter, transformer and code template library of the channel it was cloned from, its storage and encryption settings included. | P2 | Test | Proposed |
| CHAN-EDIT-06 | The system shall refuse to delete a channel while it is deployed. | P1 | Test | Proposed |
| CHAN-EDIT-07 | The system shall refuse to give two channels that are not deleted the same name, whether by create, rename, clone, import or restore. | P2 | Test | Proposed |

- CHAN-EDIT-01: source: docs/user/capabilities.md "Create, edit, clone and delete channels" (Yes). That a save is all or nothing is from the code and its tests.
- CHAN-EDIT-02: source: docs/design/01-core-models.md resolved decision 4; D-328 (enabling and an overwriting import raise the revision); docs/design/18-voice-of-the-user.md UI6. The general rule for a save made against an older version is in the REST API area.
- CHAN-EDIT-03: source: issue #400 (an update that leaves a field out resets it, encryption at rest included); D-294 sets the rule for script languages.
- CHAN-EDIT-04: source: issue #395 ("A number that a destination keeps across saves, and that is never given to another, settles all of it"). Routing of what is already queued is the Pipeline area's.
- CHAN-EDIT-05: source: D-066 (starts disabled); D-249 (clone joins the libraries); #91; docs/ops/hipaa-security-checklist.md "A cloned channel keeps its encryption setting". Conflict: D-156 says clones start with encryption off; the checklist and the code keep it, kept here.
- CHAN-EDIT-06: source: D-190; issue #397 (an ID in capitals gets past the check; IDs in any letter case are the REST API area's).
- CHAN-EDIT-07: source: code and its tests only for create and rename. Conflict: D-308 says channel names are not unique, and an import or restore does not check them. #202 shows what two channels of one name look like to a user.

## Deployment (DEP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CHAN-DEP-01 | The system shall let an operator deploy, redeploy, undeploy, start, stop, pause, resume, halt, enable and disable a channel, and shall refuse with the reason an action the channel's state does not allow, such as deploying a disabled channel or undeploying a running one. | P1 | Test | Proposed |
| CHAN-DEP-02 | While a channel is paused, the system shall accept no new message from its source and shall go on delivering the messages it already accepted. | P1 | Test | Proposed |
| CHAN-DEP-03 | The system shall refuse to deploy a channel that has a connector setting that is invalid, missing or unknown, a script that does not compile, a TypeScript error, a filter rule or transformer step it cannot run, or a queued destination whose messages its storage mode does not keep, and shall name the connector or script and the problem; it shall never skip the part, and shall leave a running version of the channel running. | P1 | Test | Proposed |
| CHAN-DEP-04 | The system shall report, without deploying or sending anything, every problem that would make it refuse to deploy a channel as saved. | P2 | Test | Proposed |
| CHAN-DEP-05 | When a channel that should be running after a deploy or redeploy cannot start, the system shall stop every part of it that had started, report the deploy as failed with the cause, and leave the channel deployed and stopped. | P1 | Test | Proposed |
| CHAN-DEP-06 | A redeploy shall apply the saved configuration and leave the channel running, paused or stopped as it was before. | P1 | Test | Proposed |
| CHAN-DEP-07 | After a restart, the system shall run each enabled channel as it was last deployed, with the code templates and global scripts of that deployment, and shall run no change saved since and no channel that was never deployed or was undeployed. | P1 | Test | Proposed |
| CHAN-DEP-08 | When one or more channels cannot be deployed at a restart, the system shall deploy all the others, and shall name each channel that failed, with the cause, in the event log and the health report. | P1 | Test | Proposed |
| CHAN-DEP-09 | The system shall deploy channels that start together only after the channels they depend on, shall refuse a dependency that would make a cycle, and shall deploy none of them at a restart when it cannot read the dependencies. | P1 | Test | Proposed |
| CHAN-DEP-10 | When a deploy would remove or switch off a destination, or turn off its queue, while messages wait to be delivered to it, the system shall refuse with their number unless the operator chooses what happens to them, and shall never leave them waiting with nothing to send them and nothing to show it. | P1 | Test | Proposed |
| CHAN-DEP-11 | The system shall start, stop and deploy a channel at times an operator schedules. | P3 | Test | Proposed |

- CHAN-DEP-01: source: docs/user/capabilities.md "Deploy, start, stop and pause channels" (Yes); D-021, D-123 (a disabled channel cannot be deployed). What a halt ends is D-342, which the Pipeline area owns.
- CHAN-DEP-02: source: D-021; docs/user/capabilities.md "Deploy, start, stop and pause channels". The meaning of pause (source only) is from the code.
- CHAN-DEP-03: source: D-207 (a rule or step that cannot run blocks the deploy), D-229 (a redeploy compiles before it stops the running channel), D-269 and D-274 (unknown types and keys fail), D-285 (type errors); docs/user/quickstart-first-channel.md step 5. The storage-mode check is from the code and its tests.
- CHAN-DEP-04: source: docs/research/voice-of-user/ranking.md UI7 ("Validate on save in the editor and at server start"); issue #133. Saving a half-written channel stays allowed (D-229).
- CHAN-DEP-05: source: D-215; D-119; docs/ops/api-automation.md "Deploy it".
- CHAN-DEP-06: source: docs/ops/api-automation.md "Deploy it".
- CHAN-DEP-07: source: D-328 (#225). Not part of what is recorded, and read when the channel deploys: configuration map values, certificates, alerts, resources, data sources and collections. A channel held after a script hung (D-340) is the Scripting and Operations areas'. A channel an operator stopped follows its initial state at a restart, as a deploy does (D-119).
- CHAN-DEP-08: source: D-308.
- CHAN-DEP-09: source: docs/user/capabilities.md "Deploy channels in dependency order" (Yes); ROADMAP N6; D-096 (no cycles), D-194 (none deployed when dependencies cannot be read). "Start together" covers a restart today; deploying several by hand is this draft's extension.
- CHAN-DEP-10: source: issue #395 ("A queue that is turned off, or whose destination was removed, strands what is on it"). The refusal is this draft's proposal; the issue names the harm, not the answer.
- CHAN-DEP-11: source: ROADMAP "Scheduled channel operations" (maintenance windows, deploy and start on schedule).

## Revisions (REV)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CHAN-REV-01 | The system shall keep a revision of the whole channel, with who made it and when, for every change to it by create, edit, clone, import, restore, enable or disable, and shall not report the change as saved when its revision was not kept. | P2 | Test | Proposed |
| CHAN-REV-02 | The system shall show the differences between any two revisions of a channel, scripts line by line, with credentials masked for a reader who may not change the channel. | P2 | Test | Proposed |
| CHAN-REV-03 | The system shall let an authorized user restore an earlier revision of a channel as a new revision, which runs only once someone deploys it. | P2 | Test | Proposed |
| CHAN-REV-04 | The system shall show for each deployed channel the revision it runs, who deployed it and when, and whether the saved channel differs from it. | P2 | Test | Proposed |

- CHAN-REV-01: source: docs/user/capabilities.md "Keep channel revision history" (Yes); D-328 says the history has gaps (kept only on update, written without waiting for it, none for an import or for enabling). Keeping every change is this draft's reading of what a history is for.
- CHAN-REV-02: source: issue #337; ROADMAP V2 and "Channel diff viewer"; docs/user/capabilities.md "Git, CI/CD and revision diff for channels" (No). Masking is as in the revision view today.
- CHAN-REV-03: source: issue #337 ("Restoring makes a new revision"); ROADMAP V2.
- CHAN-REV-04: source: D-328 (the deployment record holds revision, who and when); issue #225 (saved and deployed can differ). Showing the difference is this draft's; no issue asks for it.

## Export, import and promotion (IMP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CHAN-IMP-01 | The system shall export one channel or all of them as JSON that, imported on another server, makes channels that do the same thing, every setting and script kept and each filter and transformer on its own connector, and shall report any channel it could not export. | P1 | Test | Proposed |
| CHAN-IMP-02 | An import shall put a stored credential that its file masks only back on the connector it belongs to, the source or the one destination that is still the same, shall give a new channel none, and shall never store the mask itself. | P1 | Test | Proposed |
| CHAN-IMP-03 | The result of an import shall name each channel and connector that is left without a credential it had or needs. | P1 | Test | Proposed |
| CHAN-IMP-04 | When an imported channel's ID already exists, the system shall skip it, overwrite it or import a copy with a new ID, as the importer chose, and an overwrite shall change neither whether the channel is enabled nor the version that is running. | P1 | Test | Proposed |
| CHAN-IMP-05 | The system shall import each channel of a file entirely or not at all, go on with the rest when one fails, and report each channel that was not imported with the reason. | P1 | Test | Proposed |
| CHAN-IMP-06 | The system shall export a chosen set of channels as one bundle with the code template libraries, groups, tags, dependencies, alerts, resources and saved test cases they use, and shall list each reference it could not resolve. | P2 | Test | Proposed |
| CHAN-IMP-07 | The system shall export channels and code template libraries, over the API, as files fit for Git: one file per script, byte-identical when nothing changed, and unchanged by an import to an empty server and a new export. | P2 | Test | Proposed |
| CHAN-IMP-08 | The system shall report, without writing anything, what an import would change in each channel, and shall mark as a conflict, not overwrite, a channel that was changed on the target since the last promotion to it. | P2 | Test | Proposed |
| CHAN-IMP-09 | A bundle shall name each configuration map key, certificate, data source and collection its channels expect, and the target shall refuse to deploy a channel while one is missing and name it. | P2 | Test | Proposed |
| CHAN-IMP-10 | When a bundle is made, the system shall list each host name, address, file path and credential written directly in a channel's settings. | P3 | Test | Proposed |

- CHAN-IMP-01: source: docs/user/capabilities.md "Export and import channels as JSON" (Yes); D-241 (filters and transformers on their own destination); #334 (an export dropped the script timeout); #323 (export-all dropped unreadable channels).
- CHAN-IMP-02: source: D-335; docs/ops/api-automation.md "Credentials". D-145 ("re-import requires re-entering credentials") is refined by it. Masking in the file, and dropping a credential when where it goes changes, are Security's.
- CHAN-IMP-03: source: docs/ops/api-automation.md "Credentials" ("The import's answer does not name the connectors that lost a credential", and some connectors then deploy and send without one); D-335 names it as not covered.
- CHAN-IMP-04: source: D-059; D-328 (an import keeps the stored enabled flag). A backup restore sets the flag, which Operations owns.
- CHAN-IMP-05: source: code and docs/ops/api-automation.md "Import it on another server" (one outside the caller's scope is listed and left as it was); #109 (one bad channel is reported, the others import).
- CHAN-IMP-06: source: ROADMAP N14; issue #346; docs/user/capabilities.md "Export a set of channels with their templates, dependencies, groups and tags" (Partial); issue #345 ("Cases export with the channel").
- CHAN-IMP-07: source: issue #337; ROADMAP V2 and B6; D-280 (no CLI). Its first version leaves out a server that pushes to or pulls from a Git remote.
- CHAN-IMP-08: source: issue #337 (dry run) and issue #346 (preview and conflicts); ROADMAP B6.
- CHAN-IMP-09: source: issue #346 ("Required values"); D-246 (configuration map references in connector settings).
- CHAN-IMP-10: source: issue #346 ("Hard-coded value warnings": the usual failure is a test host left in a production channel).

## Groups and tags (ORG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CHAN-ORG-01 | The system shall let a user put a channel in one or more channel groups and give it tags, and show and filter channels by group and by tag. | P2 | Test | Proposed |
| CHAN-ORG-02 | The system shall change a channel's groups all at once or not at all, and shall take a channel out of no group that the person saving was not shown. | P1 | Test | Proposed |

- CHAN-ORG-01: source: docs/user/capabilities.md "Organize channels in groups and tags" (Yes). Conflict: that row and D-126 say a channel belongs to one group; D-311 and #406 let it be in several, and access follows all of them. D-311, which is later, kept. Groups as an access boundary belong to Access control.
- CHAN-ORG-02: source: #223 (a failed move could leave a channel in no group); issue #406 (a save removed groups the user never saw).

## Testing (TEST)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CHAN-TEST-01 | The system shall run a message an authorized user enters through a started channel as if its source had received it, and shall answer with the new message's ID and its outcome, or with the reason it was not accepted. | P2 | Test | Proposed |
| CHAN-TEST-02 | The system shall generate up to 100 fictitious sample HL7 v2 messages at a time, of at least the types ADT^A01, ORM^O01, ORU^R01 and SIU^S12, that its own HL7 v2 parser reads without an error. | P2 | Test | Proposed |
| CHAN-TEST-03 | The system shall run a channel's saved test cases through the whole channel, from filter to response, with the filtering, routing, output and response the deployed channel would give, shall compare the result with what each case expects, and shall send nothing to any system and store no message, queue entry or file in doing so. | P2 | Test | Proposed |
| CHAN-TEST-04 | The system shall run a channel's test cases on an API request and answer with a JUnit report and a failing result when any case fails. | P2 | Test | Proposed |
| CHAN-TEST-05 | When a user makes a test case or a sample from a stored message, the system shall remove its patient identifiers and show the result for approval before saving it. | P1 | Demonstration | Proposed |

- CHAN-TEST-01: source: docs/user/capabilities.md "Send a test message to a channel" (Yes). Recording the send before it happens is Audit's. 
- CHAN-TEST-02: source: docs/user/capabilities.md "Generate sample HL7 v2 messages" (Yes, with these four types and 100 per request). ROADMAP "Message generator" also wants FHIR, JSON and user templates; left out until someone asks.
- CHAN-TEST-03: source: issue #345 (including "The same case gives the same result in the editor, over the API and when deployed", and replay of stored messages through the deployed and the edited version); ROADMAP V3 and B5. Limits on time and memory are D-286's and belong to Scripting.
- CHAN-TEST-04: source: issue #345 ("from CI over the API, with a JUnit result and a failing status"); ROADMAP V3.
- CHAN-TEST-05: source: issue #345 ("de-identification first. A saved case must not become a place PHI collects"). P1 because it is a PHI rule, though the feature it guards is P2.

## Documentation and first steps (DOC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| CHAN-DOC-01 | The system shall generate a readable document of a channel from its saved configuration, covering its connectors, filters, transformers, scripts and dependencies, with credentials masked. | P3 | Demonstration | Proposed |
| CHAN-DOC-02 | The system shall guide a new user, inside the product, from an empty server, through a choice of ready-made channels shipped with it, to a channel that has received and delivered a test message. | P3 | Demonstration | Proposed |

- CHAN-DOC-01: source: ROADMAP V13 (UI13); docs/user/capabilities.md "Generated channel docs and a guided first channel" (No).
- CHAN-DOC-02: source: ROADMAP V13 (UI3); docs/user/quickstart-first-channel.md is the written walkthrough it would replace ("about 10 minutes"); ROADMAP V13 "recipe gallery" and "Channel template library"; docs/design/09-feature-comparison-and-vision.md "Channel templates gallery". Conflict: doc 09 and that ROADMAP line want a community-shared library; only channels shipped with the product are kept here, because a template library people rate and publish to needs its own decision.
