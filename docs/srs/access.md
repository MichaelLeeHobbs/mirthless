# Access control

Who may do what, on which channels, until when, and how anyone can find out. It covers permissions, roles, assignments, channel-group scope, enforcement on every request and live feed, the rules that stop anyone giving away more than they hold, and the record of who could reach a channel. Accounts, passwords, sessions and an API key's own life are in [Authentication](auth.md). An API key is bound by every row here as a person is, unless the row says "person". Area code `ACC`.

## Permissions (PERM)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| ACC-PERM-01 | The system shall allow an action on a channel only when at least one live assignment of the caller both gives a role holding the permission for that action and covers that channel, so that a permission from one assignment never combines with the scope of another. | P1 | Test | Proposed |
| ACC-PERM-02 | The system shall refuse any assignment or role edit that would give on chosen channel groups a permission that reaches the whole system or every channel's data: users, roles, API keys, the audit record, backup, restore, changes to settings, certificates, alerts, resources, collections, data sources, global scripts and either map, and reading the server log, collections and either map. | P1 | Test | Proposed |
| ACC-PERM-03 | The system shall require for bulk message export a permission separate from the one for reading messages, so that a role can read messages without being able to export them in bulk. | P2 | Test | Proposed |

- ACC-PERM-01: source: D-310 ("Viewer, all channels" plus "Analyst, Lab" never gives write access to another department); docs/user/capabilities.md "Limit a user to some channels" (Yes); docs/design/20-rbac-access-plan.md section 1.
- ACC-PERM-02: source: D-310, D-311; docs/design/20-rbac-access-plan.md section 1 "Classes" and "Your question: the system-wide areas"; docs/user/access-control.md "What scope promises".
- ACC-PERM-03: source: docs/user/capabilities.md "Separate permission for bulk message export" (No); #172; docs/ops/hipaa-security-checklist.md "Access control (RBAC)" and "Known gaps". Conflict: docs/design/20-rbac-access-plan.md defers splitting the permission until a privacy officer asks; #172, still open, asks for a plan, and is kept.

## Roles (ROLE)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| ACC-ROLE-01 | On a new install the system shall provide the roles admin, deployer, developer, viewer, channel-viewer, channel-developer and channel-deployer, each holding exactly the permissions the access control page's matrix lists for it, with admin holding every permission. | P1 | Test | Proposed |
| ACC-ROLE-02 | The system shall refuse every attempt to edit or delete the admin role, whoever makes it. | P1 | Test | Proposed |
| ACC-ROLE-03 | The system shall let a person who may change roles create a role, edit it, and start a new one as a copy of an existing role, with a name of 1 to 100 characters that no other role has, ignoring case. | P1 | Test | Proposed |
| ACC-ROLE-04 | The system shall refuse to delete a role or a channel group while any assignment, ended or not, uses it. | P1 | Test | Proposed |
| ACC-ROLE-05 | Wherever a role is listed, edited or chosen, the system shall show whether it runs code, reads patient data, is as strong as admin, or can be held only on every channel. | P2 | Demonstration | Proposed |
| ACC-ROLE-06 | An upgrade shall leave every person and API key with the permissions, channels and end times they had before it, and shall give a permission the release adds to no role but admin unless the release notes name the role. | P1 | Test | Proposed |

- ACC-ROLE-01: source: docs/user/capabilities.md "Built-in roles checked on every route that needs a permission" (Yes); docs/user/access-control.md "Roles at a glance" and "Role and permission matrix"; D-310. Conflict: docs/ops/hipaa-security-checklist.md "Access control (RBAC)" still says four fixed roles and no per-channel scope; the access control page and D-310 are later and kept.
- ACC-ROLE-02: source: D-310; docs/user/access-control.md "Role and permission matrix" (`roles:write`).
- ACC-ROLE-03: source: docs/user/capabilities.md "Define custom roles" (Yes); D-310; ROADMAP N13. The name limit comes from the role schema; the case rule from code and tests only.
- ACC-ROLE-04: source: docs/user/access-control.md "Role and permission matrix" (`roles:write`, `channels:write`); D-311. That an ended assignment counts comes from code: renewing it would restore the access.
- ACC-ROLE-05: source: docs/user/access-control.md "What is supported and what is not" (Custom roles); docs/design/20-rbac-access-plan.md sections 1 and 8.
- ACC-ROLE-06: source: docs/design/20-rbac-access-plan.md section 9 ("every user's permissions are identical before and after") and section 1 ("Nobody's access changes on upgrade"), which state it for one upgrade; the general rule is drafted. Conflict: D-180 wanted a permission added to a role in code to reach its holders at once; D-310 makes roles the site's own data, and is kept.

## Assignments (ASG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| ACC-ASG-01 | The system shall give access to a person as up to 50 assignments, each of one role, on either every channel (channels in no group included) or 1 to 100 chosen channel groups, with an optional end time and an optional reason of up to 500 characters, and shall refuse the default group as a scope. | P1 | Test | Proposed |
| ACC-ASG-02 | The system shall stop honouring an assignment from the first request after its end time, with no job, restart or sign-in needed. | P1 | Test | Proposed |
| ACC-ASG-03 | Before a change to a person's access is saved, the system shall show which permissions it gives and takes away, on which channels or groups, and which API keys it will disable. | P2 | Demonstration | Proposed |

- ACC-ASG-01: source: D-310; docs/user/access-control.md "What scope promises" and "Role and permission matrix" (`users:write`); docs/design/20-rbac-access-plan.md sections 1 and 2. The limits of 50, 100 and 500 come from the assignment schema.
- ACC-ASG-02: source: D-310; docs/design/20-rbac-access-plan.md section 1 ("an expiry takes effect live with no background job").
- ACC-ASG-03: source: docs/user/access-control.md "What is supported and what is not" (Custom roles); docs/design/20-rbac-access-plan.md sections 2 and 5, and slice 10 "Not built" (the preview exists for a single role, not for scoped assignments); #266.

## Channel-group scope (SCP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| ACC-SCP-01 | When a request concerns a particular channel, by its page or address, an import that would overwrite it, or a connection or script test made for it, the system shall require the permission on that channel and shall not accept the same permission held on other channels. | P1 | Test | Proposed |
| ACC-SCP-02 | In channel lists, statistics, deployment status, message searches, exports, events, tags, dependencies, alerts and code template libraries, the system shall show a person whose permission covers chosen groups nothing about any channel outside them except a count of such channels or a placeholder that does not name them. | P1 | Test | Proposed |
| ACC-SCP-03 | The system shall answer a request about a channel outside the caller's scope exactly as it answers one about a channel that does not exist. | P1 | Test | Proposed |
| ACC-SCP-04 | The system shall let only a person holding the permission to change channels on every channel create, rename or delete a channel group. | P1 | Test | Proposed |
| ACC-SCP-05 | The system shall place every new channel, whether created, cloned or imported, in a channel group where its creator may change channels, and shall refuse the request when a creator limited to several groups names none of them. | P1 | Test | Proposed |
| ACC-SCP-06 | The system shall let a person change or delete a code template library, or a template in it, only when they hold that permission on every channel the library is linked to, before the change and after it, counting a library linked to every channel or to none as linked to every channel. | P1 | Test | Proposed |
| ACC-SCP-07 | The system shall refuse a connection test or channel save by a person limited to chosen groups that uses a stored certificate with a private key, unless a channel in their scope already uses that certificate in the same way. | P1 | Test | Proposed |
| ACC-SCP-08 | Wherever a scope is chosen for a person or an API key, and in the user documentation, the system shall state that scope limits screens and the API but not code: anyone who can change or deploy channel code, code templates or global scripts, or restore a backup, can reach every channel's messages and credentials, and that reach is not recorded. | P1 | Inspection | Proposed |

- ACC-SCP-01: source: D-310, D-311; docs/user/access-control.md "Role and permission matrix" (`channels:write`, `channels:deploy`); docs/design/20-rbac-access-plan.md section 4 and slice 8.
- ACC-SCP-02: source: docs/design/20-rbac-access-plan.md section 4 ("Hidden channels stay hidden") and slices 8 to 10; docs/user/access-control.md "Role and permission matrix" (`code_templates:read`, `alerts:read`, `settings:read`); docs/user/capabilities.md "Limit a user to some channels" (Yes).
- ACC-SCP-03: source: docs/design/20-rbac-access-plan.md sections 4 and 8a ("as for a channel that does not exist"); #266.
- ACC-SCP-04: source: D-311 (supersedes D-094, which needed no more than changing one channel); docs/user/access-control.md "Role and permission matrix" (`channels:write`).
- ACC-SCP-05: source: D-311; docs/user/access-control.md "Role and permission matrix" (`channels:write`). A backup restore keeps the memberships in the backup instead (docs/design/20-rbac-access-plan.md slice 9b).
- ACC-SCP-06: source: D-311; docs/user/access-control.md "Role and permission matrix" (`code_templates:write`, `code_templates:delete`).
- ACC-SCP-07: source: docs/design/20-rbac-access-plan.md slice 10b; docs/user/access-control.md "Role and permission matrix" (`channels:write`, `channels:deploy`).
- ACC-SCP-08: source: docs/user/access-control.md "What scope promises"; D-311; docs/design/20-rbac-access-plan.md section 3.

## Enforcement (ENF)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| ACC-ENF-01 | The system shall refuse every API request unless its caller is signed in and holds the permission its operation needs, except the requests the access control page lists as open to anyone, and those that act only on the caller's own session, password or display preferences. | P1 | Test | Proposed |
| ACC-ENF-02 | The system shall decide each request on the caller's assignments, roles and channel groups as stored at that moment, so that a change to any of them applies to the next request without a new sign-in. | P1 | Test | Proposed |
| ACC-ENF-03 | The system shall send a live update only to connections whose caller holds its permission on its channel, and shall stop sending within 60 seconds after that stops being true. | P1 | Test | Proposed |
| ACC-ENF-04 | When the caller's access or a channel's groups cannot be read, the system shall refuse the request, and shall not send the live update. | P1 | Test | Proposed |
| ACC-ENF-05 | The system shall treat an identifier sent in upper, lower or mixed case as the same record in every access check, protective check and access record. | P1 | Test | Proposed |

- ACC-ENF-01: source: docs/user/access-control.md "Endpoints any signed-in user, or anyone, can call" and "Per-endpoint permissions"; D-299; docs/user/capabilities.md "Built-in roles checked on every route that needs a permission" (Yes).
- ACC-ENF-02: source: D-180, D-310; docs/user/access-control.md "Sessions and tokens" and "Cutting someone off" (Change the access).
- ACC-ENF-03: source: docs/user/access-control.md "Cutting someone off"; docs/design/20-rbac-access-plan.md slice 8c; D-306 (feeds carry no message data). The limit of 60 seconds is today's re-check interval.
- ACC-ENF-04: source: code only (the channel scope check and the live update audience); it follows AGENTS.md "Fail safe, not silent".
- ACC-ENF-05: source: #397 (open); D-344 (fixed for the user routes only).

## No one gives more than they hold (ESC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| ACC-ESC-01 | Other than in a backup restore, the system shall refuse any assignment, role edit or change of a channel's groups that would give a permission on a channel where the person making it does not hold that permission when the change takes effect, counting what an ended assignment would give if renewed. | P1 | Test | Proposed |
| ACC-ESC-02 | The system shall refuse any change that gives access, through an assignment, role edit, channel-group change, narrowed library links, restored group membership, password reset or enabled account, that would outlast the permission of the person making it. | P1 | Test | Proposed |
| ACC-ESC-03 | The system shall let a person edit, disable, delete, unlock or reset the password of another, or edit a role others hold, only when they hold every permission those people hold, on every channel they hold it. | P1 | Test | Proposed |
| ACC-ESC-04 | The system shall refuse a person's attempt to change their own roles or assignments. | P1 | Test | Proposed |
| ACC-ESC-05 | The system shall refuse any change to assignments, including two made at the same moment, that would leave no enabled person holding the admin role with no end time. | P1 | Test | Proposed |
| ACC-ESC-06 | The system shall refuse any change to assignments, and any disabling or deletion of a person, including two made at the same moment, that would leave no enabled person holding the admin role with no end time. | P1 | Test | Proposed |

- ACC-ESC-01: source: D-310 ("refuses a write that gives more than the actor holds"), D-311, D-333 (checked as the change commits, and ended assignments counted); #359; docs/design/20-rbac-access-plan.md section 5. The exception for a restore, which can already run code and so reach every channel, is slice 11a there.
- ACC-ESC-02: source: D-330, D-333; #355, #359; docs/user/access-control.md "Role and permission matrix" (`users:write`, `system:restore`). Re-sending, shortening or narrowing what someone already has is not giving (D-330).
- ACC-ESC-03: source: docs/design/20-rbac-access-plan.md section 5 "Target rule"; docs/user/access-control.md "Role and permission matrix" (`users:write`).
- ACC-ESC-04: source: docs/user/access-control.md "Cutting someone off"; docs/design/20-rbac-access-plan.md section 5 "Self and admin". Disabling or deleting your own account is AUTH-CUT-07 (#398).
- ACC-ESC-05: source: docs/user/access-control.md "Cutting someone off"; D-333; docs/design/20-rbac-access-plan.md section 5 "Self and admin". That a temporary admin does not count comes from code. Disabling or deleting the last administrator is AUTH-CUT-06.
- ACC-ESC-06: source: srs-debate 2026-11-24, finding A24 (Domain 5, Scope 1). One invariant had two definitions: disabling the permanent administrator while a temporary one remains satisfied AUTH-CUT-06 and locks the site out when the temporary one ends. Replaces ACC-ESC-05, AUTH-CUT-06: when this row is accepted, those rows become Superseded by ACC-ESC-06.

## Who can reach a channel (WHO)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| ACC-WHO-01 | The system shall show, for any channel, each enabled person and API key that can reach it now, with each permission they hold on it and the role, scope and end time that gives it, and shall let the viewer download that list. | P1 | Test | Proposed |
| ACC-WHO-02 | Beside that list, the system shall name each person and API key that can reach the channel's data through code, through data every channel shares, or by changing the maps, data sources or alerts a channel uses. | P1 | Test | Proposed |
| ACC-WHO-03 | The system shall give the same answer for any past second back to the start of the kept access history, as access stood then. | P1 | Test | Proposed |
| ACC-WHO-04 | When the asked time is before the access history starts, or any record the answer needs cannot be read, the system shall refuse with the reason and shall not give a partial answer. | P1 | Test | Proposed |
| ACC-WHO-05 | The system should answer who could reach a channel at a past time after that channel has been deleted. | P3 | Test | Proposed |
| ACC-WHO-06 | The system shall let a person who may read users list every account, deleted ones included, with its state, last sign-in and second-factor state, and download the list. | P2 | Test | Proposed |

- ACC-WHO-01: source: docs/user/access-control.md "What is supported and what is not" (Per-channel access) and "Role and permission matrix" (`users:read`); docs/design/20-rbac-access-plan.md section 8 and slice 11a; D-320 (keys listed like people).
- ACC-WHO-02: source: docs/design/20-rbac-access-plan.md sections 3 and 8, and slice 11a "Open" (holders of map, data source and alert changes are not listed today, left as a decision).
- ACC-WHO-03: source: D-319; docs/user/capabilities.md "Limit a user to some channels" (Yes). The history covers the audit retention (AUD-PROT-04).
- ACC-WHO-04: source: D-319.
- ACC-WHO-05: source: D-319 "Limits" (a channel deleted now has no answer for any past time).
- ACC-WHO-06: source: srs-debate 2026-11-24, finding A28 (Customer 9, limited by Domain, moved here by Scope).
