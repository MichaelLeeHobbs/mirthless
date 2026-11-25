# Admin console

What every screen of the web console must do, whatever it shows. Area code `UI`. What a screen is for belongs to the area that owns it: the HL7 message viewer to Messages (`MSG`), the sign-in notice and its acceptance to Authentication (`AUTH`), the script editor's checks to Scripting (`SCR`), what a permission allows to Access control (`ACC`).

## Reach (RCH)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-RCH-01 | Every function of the console shall work in the current and the previous major version of Chrome, Edge, Firefox and Safari, with nothing installed beside the browser. | P1 | Test | Proposed |
| UI-RCH-02 | Every page of the console, script editors included, shall load and work when the browser can reach only the server. | P1 | Test | Proposed |
| UI-RCH-03 | At a width of 390 pixels, a user shall be able to use the dashboard, alerts, events, the message list and a message's detail, channel start, stop, pause and deploy, system health and user management without scrolling the page sideways, and shall be able to read every other page without doing so. | P2 | Test | Proposed |
| UI-RCH-04 | When an administrator has turned it on, the console shall be installable as an app on an iOS or Android phone, with the same sign-in as the browser. | P3 | Demonstration | Proposed |
| UI-RCH-05 | The console shall keep nothing on the user's device beyond what signing in and the user's own display choices need, and never message content, whether it runs in a browser or as an installed app. | P1 | Test | Proposed |

- UI-RCH-01: source: doc 18 "Already ours" (UI1 web admin, nothing to install); README Out of scope ("the admin console is a web application"). No source lists browsers; the list is the drafter's. Automated browser tests run in one browser engine today.
- UI-RCH-02: source: D-161 and D-283 (fonts and the script editor are bundled for networks without internet). Conflict: docs/user/capabilities.md "Write scripts in JavaScript or TypeScript" says the editor loads from a public network; D-283 is later and the code agrees with it. That the console loads nothing from elsewhere is a Security rule.
- UI-RCH-03: source: doc 15 "Layout and page anatomy"; #130, whose example list of phone screens is used here and is not agreed. Conflict: doc 06 decision 3 says desktop first with no mobile layouts, and ROADMAP "Someday" lists a phone-optimised UI; doc 15 is binding and kept.
- UI-RCH-04: source: #146; doc 18 theme UI16. Push notifications (#147) belong to Monitoring and alerts. Working without the server is not asked for: doc 06 decision 4 rules it out.
- UI-RCH-05: source: #136 (what the browser stores and why no cookie notice is shown); #146 (no response is ever stored on the phone). Where a session credential may be kept is a Security rule.

## Look (VIS)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-VIS-01 | A channel state or message status shall have the same colour and the same word on every page, and the colours that mean healthy, needs attention and action required shall be used for nothing else. | P1 | Test | Proposed |
| UI-VIS-02 | The console shall convey no state, error or required action by colour alone. | P1 | Test | Proposed |
| UI-VIS-03 | Every page shall be readable in a light and a dark theme, and the console shall keep a user's choice of theme and table columns when that user signs in from another browser. | P2 | Test | Proposed |

- UI-VIS-01: source: doc 15 "Colour" (five levels). Conflict: doc 06 "Theme" shows a stopped channel in grey; doc 15 shows it as action required, is binding and is kept.
- UI-VIS-02: source: doc 15 "Colour" ("Meaning never depends on colour alone"); dashboards are read by colour-blind operators.
- UI-VIS-03: source: doc 15 opening paragraph; doc 18 "Already ours" (UI2); docs/testing/50-user-preferences.md. Table columns follow the user today; the theme is kept per browser.

## Accessibility (ACS)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-ACS-01 | Every page of the console shall meet WCAG 2.1 level AA. | P2 | Test | Proposed |
| UI-ACS-02 | A user shall be able to carry out every function of the console with a keyboard alone, and the control that has the focus shall always be visibly marked. | P1 | Test | Proposed |

- UI-ACS-01: source: doc 15 "Interaction" and "Colour" (parts of it: visible focus, reduced motion, readable text in both themes). No source names a level; WCAG 2.1 AA is the drafter's choice.
- UI-ACS-02: source: doc 15 "Interaction" (focus is always visible; hover-only controls also appear on focus); docs/testing/54-keyboard-shortcuts.md; doc 18 theme UI9.

## Actions and errors (ACT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-ACT-01 | When a user is about to leave or close a page that holds changes they have not saved, the console shall say so and lose nothing unless the user confirms. | P1 | Test | Proposed |
| UI-ACT-02 | The console shall carry out an action that deletes, overwrites or stops something, or that reprocesses messages, only after the user confirms a question that names what will be affected and how many. | P1 | Test | Proposed |
| UI-ACT-03 | The console shall offer no setting, control or option that has no effect. | P1 | Inspection | Proposed |
| UI-ACT-04 | The console shall let a user with the permission see and change every channel, connector, code template library and server setting that the engine acts on. | P2 | Test | Proposed |
| UI-ACT-05 | When a request fails or is refused, the console shall show what was not done, the reason the server gave and what the user can do next, and shall never show the failure as an empty list or a success. | P1 | Test | Proposed |

- UI-ACT-01: source: doc 15 "Interaction" (asks before navigating away with unsaved changes). Six editor pages do so today.
- UI-ACT-02: source: doc 15 "Interaction" (confirm, and name the target); docs/testing/61-confirm-dialogs.md; #339 (reprocess guardrails). "How many" is the drafter's addition.
- UI-ACT-03: source: D-189, D-153 (controls that change nothing are removed, not kept); #154; #133. The Settings page text for maintenance mode says it is stored but blocks no one, so it breaks this row today.
- UI-ACT-04: source: ROADMAP v1.0 "Editor controls for what the engine now supports"; docs/user/capabilities.md Limits of "Receive and send HL7 over TCP/MLLP", "Receive and send over HTTP", "Custom metadata columns" and "Limit a code template library to some channels". That a save keeps settings the editor does not show is a Channels rule (#400).
- UI-ACT-05: source: doc 15 "Layout and page anatomy" ("A failed request must never look like 'no data'"); D-312 (a refused read is explained to the user); AGENTS.md "Fail safe, not silent".

## Permissions on screen (PRM)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-PRM-01 | The console shall not offer a user an action that their permissions, on the record they are looking at, would refuse, and a disabled action shall name the permission it needs. | P2 | Test | Proposed |
| UI-PRM-02 | When a user's access changes while the console is open, the console shall say so within 30 seconds of the first request that it affects, and shall then show only what the user still reaches. | P2 | Test | Proposed |

- UI-PRM-01: source: doc 15 "Layout and page anatomy" (a disabled action's tooltip says which permission it needs). The server's own check is an Access control rule.
- UI-PRM-02: source: D-310 and D-298; the "Your access changed" notice and its end-to-end test. The console also warns an hour before temporary access ends; the 30 seconds comes from the code's check interval.

## Live data (LIVE)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-LIVE-01 | While live updates are connected, an open message list shall show a new message that matches it within 3 seconds of the server recording it, at any message rate, without a reload. | P2 | Test | Proposed |
| UI-LIVE-02 | When the data on the dashboard or the message list may be out of date because the server cannot be reached or live updates are not connected, the console shall say so and show the time of the last successful refresh. | P1 | Test | Proposed |

- UI-LIVE-01: source: D-306 (after a burst the screen is at most about 3 seconds behind). The same bound for the dashboard is in Monitoring and alerts, and the refresh without a live connection in REST API and live updates (D-078, D-079). Conflict: D-025 and doc 06 refresh every 5 seconds; D-306 is later and kept.
- UI-LIVE-02: source: drafter's inference from AGENTS.md "Fail safe, not silent" and doc 15 ("A failed request must never look like 'no data'"). No document asks for it: a frozen dashboard that looks healthy hides a stopped feed.

## Notices and identity (NOT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-NOT-01 | The console shall show a notice that an administrator has set, in plain text at the top, the bottom or both, on every page including the sign-in page, until an administrator removes it, without covering any other content and without a way for a user to dismiss it. | P2 | Test | Proposed |
| UI-NOT-02 | The sign-in notice, when one is set, shall stand in place of the sign-in form until it is answered, readable in full at a width of 390 pixels and by keyboard, and shall render no markup beyond its formatting. | P2 | Test | Proposed |
| UI-NOT-03 | Every page shall show the server's name as the administrator set it, so that a user can tell one install from another. | P2 | Test | Proposed |

- UI-NOT-01: source: #132; doc 18 theme UI12. That it cannot be dismissed is #132's open question 1, answered as the issue leans.
- UI-NOT-02: source: #135. Whether one is required, who agreed and how that is recorded belong to Authentication.
- UI-NOT-03: source: the Settings page text for the server name ("so people can tell instances apart"); doc 18 theme UI12 ("prevents production mistakes"). The name is stored and shown nowhere else today.

## Time and language (LOC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-LOC-01 | The console shall show every time in the time zone and 12 or 24 hour format of the user's device, and shall show the zone wherever a time is shown in full. | P2 | Test | Proposed |
| UI-LOC-02 | The console shall show its text in a language the user chooses from those the project ships. | P3 | Demonstration | Proposed |

- UI-LOC-01: source: D-278 (one rule for a time on screen); doc 18 theme UI10 ("Use locale formatting now"). Showing the zone is the drafter's addition: no screen does so today, and people in two zones read the same incident.
- UI-LOC-02: source: doc 18 theme UI10 ("full i18n only on demand").

## Visual flows (FLOW)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| UI-FLOW-01 | The console shall let a user build and change a channel on a canvas of connected steps, with branches, error paths and reusable parts, and the result shall be an ordinary channel that the form editor, export, deploy and revision history treat the same. | P3 | Demonstration | Proposed |

- UI-FLOW-01: source: ROADMAP v1.1 "Visual pipeline builder" and v2.0 "Visual Flows" ("flows compile down to channels"); doc 06 resolved decision 1. Conflict: ROADMAP's Beyond-Mirth "[DECIDE]" and doc 14 call a low-code canvas an undecided identity choice; the v2.0 phase kept as a P3 row.
