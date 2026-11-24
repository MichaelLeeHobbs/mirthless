# Access control

This page describes who can sign in to GalvaniGraph, how sessions work, how to cut someone off, what each built-in role can do, which roles can run code on the server or take PHI and secrets out of it, what the audit log does not record, and which endpoints need no permission. It describes the code as it is today. For the operator's side (TLS, encryption at rest, backups), see the [HIPAA / security checklist](../ops/hipaa-security-checklist.md).

## What is supported and what is not

| Capability | Supported | Notes |
|---|---|---|
| Local accounts | Yes | An admin creates each account. There is no self-registration. Passwords are stored as bcrypt hashes (cost 12). |
| SSO (OIDC, SAML) | No | |
| LDAP or Active Directory | No | |
| Multi-factor authentication | No | |
| API keys | Yes | A machine caller sends `Authorization: Bearer gf_<keyId>_<secret>`. Each key holds chosen permissions on every channel or on chosen channel groups, until a required end time, within what its issuer holds; see [API keys](#api-keys). They are issued and managed on the API keys page (Administration), or through `/api/v1/api-keys`. |
| Custom roles | Yes | Roles are stored in the database, and seven are built in: admin (locked), deployer, developer, viewer, channel-viewer, channel-developer and channel-deployer. A user holds a role through an assignment, and the server reads the user's assignments on every request, so a change applies to the next one. Admins create, edit, clone and delete roles on the Roles page (`roles:write`), which shows each role's holders and flags: as strong as admin, runs code, reads PHI, all channels only. The user dialog lists the roles and shows what a role change gives and takes away before it is saved. |
| Per-channel access | Yes | An assignment gives a role on every channel or on chosen channel groups; see [What scope promises](#what-scope-promises). A channel's Access tab shows who can reach it, now or at a past time. |
| Idle session timeout | No | An open browser tab keeps refreshing its session. |
| Maximum session length | No | Each refresh deletes the session and starts a new one lasting `JWT_REFRESH_EXPIRES_IN` (default 7 days), so a session that keeps refreshing never ends. |

## Signing in

**Password rules.** 8 to 128 characters, with at least one letter and at least one digit. The same rule applies when an admin creates a user, when an admin resets a password, and when users change their own.

**Account lockout.** Five failed logins for a username, with no successful login in between, lock that account for 15 minutes. While it is locked, even the correct password is refused. When the lock expires the count starts again, so it takes another five failures to lock the account again. Lockout is per username, not per client, so anyone who knows a username can lock that account out. An admin can unlock it early from the Users page (`POST /api/v1/users/:id/unlock`, permission `users:write`).

**Login rate limit.** `POST /api/v1/auth/login` allows 5 failed attempts per client address per 15 minutes, and only when `NODE_ENV=production`. Successful logins do not count. In any other `NODE_ENV` the limit is 1000. The client address comes from Express's `trust proxy` setting, which `TRUST_PROXY` sets. Behind a proxy, set it to the number of proxies in front of the server (the production example uses `1` for the bundled nginx). If it is `false` behind a proxy, every client has the proxy's address and shares one limit, so five failures from anyone block every login for 15 minutes. If it trusts more hops than there are proxies, a client can choose its own address with `X-Forwarded-For` and avoid the limit. Token refreshes have their own, looser limit (300 per 15 minutes in production).

**Forced password change.** The seed creates the first admin (`admin`) with a forced password change. Until that user changes the password, every API call except changing their own password (`POST /api/v1/users/me/password`) and logging out returns 403, and Socket.IO connections are refused. A user created by an admin, and a user whose password an admin resets, are not forced to change it.

**Every rejected login is audited** as `USER_LOGIN_FAILED`, with the reason (unknown user, wrong password, locked, disabled) and the client address.

## Sessions and tokens

**Access token.** A JWT signed with `JWT_SECRET` (HS256) that lasts `JWT_ACCESS_EXPIRES_IN` (default 15 minutes). The login and refresh responses return it in the JSON body, and the client sends it in the `Authorization: Bearer` header. The web UI keeps it in the browser's `localStorage`. Socket.IO connections pass it in the handshake.

**Every request is checked against the database.** The server looks up the user and the session on each API call. A request fails if the user no longer exists, is disabled, still has to change their password, or if the token's session has been deleted or has expired. Deleting the session therefore stops an access token at once, without waiting for it to expire.

**Refresh token.** A separate JWT in a cookie named `refreshToken` that is `httpOnly`, `SameSite=strict`, limited to the path `/api/v1/auth`, and `Secure` when `NODE_ENV=production`. The browser cannot read it from script, and other sites cannot send it.

**Session record.** Each login and each refresh creates a row in the `sessions` table holding a SHA-256 hash of the refresh token, the user agent and client address of that request, and an expiry `JWT_REFRESH_EXPIRES_IN` later (default 7 days). Logout deletes the row.

**Rotation.** `POST /api/v1/auth/refresh` checks the refresh token's signature, then deletes its session in the same statement that finds it, so of two refreshes sent with one token only one gets the session. It checks that the session has not expired and that the user still exists and is enabled, then creates a new session with a new refresh token and a new expiry. A refresh token works once. The response carries the user with their current role and permissions, and the web UI replaces the list it was given at sign-in, so a role change reaches an open browser at its next refresh.

**Lifetimes.** `JWT_ACCESS_EXPIRES_IN` (default `15m`) and `JWT_REFRESH_EXPIRES_IN` (default `7d`) set the token lifetimes, and the session row and the refresh cookie follow the refresh token's expiry. Both need a unit (`15m`, `12h`, `7d`), and the server refuses to start when the refresh lifetime is shorter than the access lifetime.

## API keys

A key is its own principal: it holds one set of permissions on every channel or on chosen channel groups, until an end time it must have, and the guards, the audit log and a channel's Access tab treat it like a person. Keys are issued, replaced, enabled, disabled and revoked on the API keys page or through `/api/v1/api-keys` (`api_keys:manage`), and listed with `api_keys:read`. The page shows each key's status, what it holds and where, who issued it, and when it ends and was last used. Disabling a user on the Users page first lists the keys that user issued, which stop with them.

- **The token is shown once.** The answer to `POST /api/v1/api-keys` carries `gf_<keyId>_<secret>`, a 256-bit secret. The server keeps only the secret's SHA-256 and compares it in constant time.
- **Bearer only.** Send it in the `Authorization` header. A request with a key in its query string is refused. Every refusal (unknown key, wrong secret, revoked, ended, disabled, an issuer who no longer covers it, in the URL) is the same 401.
- **Within its issuer.** The issuer must hold every permission the key gets on the key's scope, now and still just before the key ends. Every request with the key checks this again: a key stops working as soon as its issuer is disabled or no longer holds what the key holds, and works again if the issuer gets it back. A key never holds a permission over users, roles, keys, the audit log, backups or restores.
- **Daily row ceiling.** A key may read at most `API_KEY_DAILY_ROWS` rows (5000 by default) in a UTC day through message searches, message details, attachments, message exports, sends and collection record lists. The read that would pass it is refused with 429 before anything is sent, and the first refusal each day is recorded as `API_KEY_ROW_CEILING_REACHED`. When a key's day first reaches 80% of the ceiling, the Events page gets one `API_KEY_ROW_CEILING_WARNING` at WARN level, naming the key (`apiKeyId`), its count (`used`) and the ceiling (`limit`). That happens once per key per UTC day, and a restart does not repeat it. If the event cannot be written, the key's next read tries again, refused or not. The read never waits for the event or is refused over it. Every read a key makes is recorded with its row count, never deduped, so a restart rebuilds the day's count from the audit log. A key's collection record reads are recorded fail-closed, where a person's are best effort. Event exports, map entries and server log lines are not counted. The count is kept by the server process, so it assumes one server. A key that reads every channel's messages needs a reason, recorded with it.
- **Rate limit.** Each key has its own rate limit, `API_KEY_RATE_LIMIT_MAX` requests a minute (300 in production by default), on top of the per-address limit.
- **Last use.** The key's last-used time and client address are written at most once a minute.
- **Replace.** `POST /api/v1/api-keys/:id/replace` with `mode` gives the key a new secret and makes the caller its issuer, so the caller must hold what the key holds for the rest of its life. `leak` ends the old secret at once; `planned` keeps it working for 7 days (or until the key ends) while the caller switches.
- **When the issuer's access narrows.** Editing the issuer's role or assignments so they no longer hold what a key holds, now or until the key ends, disables that key in the same change, recorded with the reason.
- **When the issuer leaves.** Disabling or deleting a user disables every working key they issued, in the same change, because they know those keys' secrets. Each feed stops until it has a new token. The Users page lists the keys first. A holder of `api_keys:manage` whose access covers a key may take it over instead (`DELETE /api/v1/users/:id?takeOwnership=<key id>,...`): in the same change the key gets a new secret and the taker becomes its issuer, the old secret stops at once, and the new token is shown once. `PUT /api/v1/users/:id` with `enabled: false` takes nothing over: every key is disabled. Enabling the user again does not enable the keys.
- **Not a person.** A key does not sign in with a password, is not listed on the Users page, and its private role is not a role anyone can pick or edit.

Issuing, disabling, enabling and revoking a key are recorded in the audit log, in the same rows a person's access changes use, so a channel's Access tab can rebuild a key's access at a past time.

## Cutting someone off

| Action | How | REST API | Open Socket.IO connections |
|---|---|---|---|
| Disable the user | Users page, or `PUT /api/v1/users/:id` with `enabled: false` (`users:write`) | All of the user's sessions are deleted. The next request fails, and refresh fails. | Disconnected at the next re-check |
| Reset the password | `POST /api/v1/users/:id/password` (`users:write`) | All of the user's sessions are deleted. The account stays enabled, and the user can sign in with the new password without being made to change it. | Disconnected at the next re-check |
| Delete the user | `DELETE /api/v1/users/:id` (`users:delete`) | Same as disabling: the account is disabled and its sessions deleted. The row stays, so the audit log keeps the identity. | Disconnected at the next re-check |
| Disable or revoke an API key | `PATCH /api/v1/api-keys/:id/enabled` with `enabled: false`, or `POST /api/v1/api-keys/:id/revoke` with a reason (`api_keys:manage`) | The key's next request fails. A revoked or ended key can never be enabled again. Disabling or deleting a user disables the keys they issued, except any an admin takes over with a new token; taking away what their keys hold disables those keys. | Keys do not use Socket.IO |
| Change the access | Users page, editing the user, or `PUT /api/v1/users/:id/assignments` (`users:write`) | Sessions are kept. The new access applies from the next request. An open web UI shows the new role's pages and buttons at the first request after its access token expires, which refreshes the session (at most `JWT_ACCESS_EXPIRES_IN`, default 15 minutes). Reloading the page does not refresh it sooner. | Leaves any room the new role may not join, at the next re-check |

The server re-checks every open Socket.IO connection against the database every 60 seconds, and again whenever the connection asks to join a room. So a cut-off user can keep receiving live updates for up to a minute.

You cannot disable, demote or delete the last enabled admin, and you cannot delete your own account or change your own role.

None of these actions changes a secret the person knew. Rotate them yourself: database and API passwords in connector settings, data source passwords, values in the configuration map and global map, the SMTP password, and, if the person had access to the server, `JWT_SECRET` and `CONTENT_ENCRYPTION_KEY`. Changing `JWT_SECRET` signs everyone out. Message exports and backups the person downloaded stay with them, and channel scripts and code templates they wrote keep running until someone changes them.

## Roles at a glance

**admin** holds every permission. Only admins manage users, settings, certificates, global scripts, the global and configuration maps, backups and restores, and delete messages, channels or audit events.

**deployer** builds and runs channels: it edits, deploys, starts and stops them, sends test messages, runs Test Connection, reprocesses messages, and manages code templates, alerts, resources, collections and data sources. It reads the server log, metrics and the global and configuration maps. It cannot manage users or settings.

**developer** edits channels, code templates, resources and collections, and reads messages. It cannot deploy, start, stop, enable or disable a channel. Its changes run once someone holding `channels:deploy` deploys the channel; a server restart brings back what was last deployed, not what was saved since (see [Who can run code on the server](#who-can-run-code-on-the-server)).

**viewer** reads channels, messages, code templates, alerts, events, resources, collections and data source settings. Reading messages includes exporting them in bulk and downloading attachments, on every channel.

**channel-viewer**, **channel-developer** and **channel-deployer** are viewer, developer and deployer without the permissions that only an all-channel assignment may hold: the reads that reach every channel's data (collections, both maps, system information) and the system-wide writes (resources, collections, data sources, alerts). They are for assignments scoped to channel groups ([#266](https://github.com/MichaelLeeHobbs/mirthless/issues/266)). Nobody holds them after an upgrade.

Every user had one of the first four roles before roles were stored in the database. The upgrade gave each user an all-channel assignment of that role, so nobody's access changed. A user whose role named none of them held no permissions before, and holds no assignment after.

## Role and permission matrix

| Permission | admin | deployer | developer | viewer | channel-viewer | channel-developer | channel-deployer | Also allows |
|---|---|---|---|---|---|---|---|---|
| `channels:read` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Reads every channel's scripts and connector settings (secret fields masked) and exports channels. Validates scripts, previews Mirth imports, generates sample messages, and joins the dashboard and channel live feeds. |
| `channels:write` | Yes | Yes | Yes | No | No | Yes | Yes | Writes code that runs on the server once someone deploys it: the channel's scripts, filters and transformers run at its next deploy. A server restart redeploys what each channel last deployed, never edits saved since. Also runs a script against a sample message on demand from the editor (a test run: in a worker with memory and time limits, one at a time, audited, with no sends, writes or routing). Also imports channels (including Mirth XML) and clones them. Importing over an existing channel keeps its enabled flag; a backup restore sets it. Creating, renaming or deleting a channel group needs it on every channel, and a group an assignment uses cannot be deleted. Adding a channel to a group gives that group's assignments access to it, so it also needs, on that channel and with no end time, every permission those assignments grant (assignments that have ended count too, since renewing one gives that channel; an API key always has an end time, so it can add a channel only to a group whose assignments grant nothing, not counting keys that have ended or are revoked). Remove assignments that have ended and will not be renewed, since they keep people who do not hold their permissions from adding channels; taking a channel out of a group needs only this permission. A new channel (created, cloned or imported, including from Mirth XML) joins a group where its creator holds this permission: the one the request names in `groupId`, else Default for someone who holds it on every channel, else their only such group (someone who holds it in several groups must name one). Importing over an existing channel needs this permission on that channel. Someone holding it on some groups can save or import a channel that uses a client or server certificate from the store only if a channel in their access already uses that certificate that way; a CA certificate can be any. A backup restore keeps the memberships the backup holds; one that gives access needs `system:restore` with no end time. Reads every channel's connector settings and revisions with secret fields unmasked (passwords, keys, tokens); those reads write no audit event. |
| `channels:deploy` | Yes | Yes | No | No | No | No | Yes | Deploying runs the channel's code, and records what was deployed (the channel, its code templates and the global scripts) as what a restart brings back. Undeploying marks it so a restart leaves it undeployed. Also enables and disables channels (`PATCH /api/v1/channels/:id/enabled`, or a channel save that changes `enabled`), since that decides whether a channel comes back at a restart. Also sends test messages into a channel, runs Test Connection (the server connects to the host in the form), resets statistics and edits channel dependencies. Someone holding it on some groups names the channel a Test Connection is for, and can test with a client or server certificate only if a channel in their access already uses it that way. |
| `channels:delete` | Yes | No | No | No | No | No | No | Deleting hides the channel; its messages are kept. |
| `messages:read` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Bulk message export and attachment download, on every channel. Lists message IDs, status and times across channels (cross-channel search, the Traffic page). |
| `messages:reprocess` | Yes | Yes | No | No | No | No | Yes | Reprocessing and resending send stored message content to destinations again. |
| `messages:delete` | Yes | No | No | No | No | No | No | Bulk delete as well as single messages. |
| `code_templates:read` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Someone holding it on some groups sees only the library links to their channels, and a count of the rest. |
| `code_templates:write` | Yes | Yes | Yes | No | No | Yes | Yes | Runs code on the server: a template reaches every channel that includes it at that channel's next deploy. A library, and each template in it, can be changed only by someone holding this permission on every channel the library links to, before and after the change; a library linked to every channel, or to none, needs it on all channels. Going to fewer but some channels (taking one out, or coming from every channel or none) needs it with no end time on every channel the library linked to (an API key always has an end time, so it cannot). Without links, a new library links to the channels in its writer's groups at that moment (channels added to those groups later are not added), or to every channel for someone who holds it on all of them. A link to a channel that does not exist counts as outside every group. Importing Mirth code templates checks every library in the file before writing any. |
| `code_templates:delete` | Yes | Yes | No | No | No | No | Yes | Deleting a library or a template needs it on every channel the library links to; a library linked to every channel, or to none, needs it on all channels. |
| `alerts:read` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Someone holding it on some groups sees an alert's channels in their access, and a count of the rest. |
| `alerts:write` | Yes | Yes | No | No | No | No | No | Alert emails carry the error text of the failure that triggered them to any address the alert names. |
| `alerts:delete` | Yes | Yes | No | No | No | No | No | |
| `users:read` | Yes | No | No | No | No | No | No | Lists every user's email address, role and lock state. Also shows who can access a channel (the channel's Access tab, `GET /api/v1/channels/:id/access`): each person whose assignments cover it, their permissions there and the role and scope that give them, and who reaches every channel through code or shared data. The As of field rebuilds the same answer for a past time from the audit log, back to when the history starts (the upgrade that added it, or the install). |
| `users:write` | Yes | No | No | No | No | No | No | Creates users and changes other users' roles, so it is as strong as admin, up to the permissions its holder has: a role can be given only by someone holding every permission in it, and a user can be changed, disabled, deleted, unlocked or given a new password only by someone holding every permission that user holds. Nobody can change their own role. Also sets a user's assignments (`PUT /api/v1/users/:id/assignments`): each gives a role on every channel or on chosen channel groups, optionally until a time and with a reason. Giving a role on groups needs every permission in it on each of those groups; a role holding a permission marked all channels only can be given only on every channel; the Default group cannot be a scope. Giving a single role through the Users page (or `role` on `POST`/`PUT /api/v1/users`) gives it on every channel, so it needs every permission in it on every channel, and it is refused for a user whose access is set per group or until a time. Changing another user needs each of their permissions over the channels they hold it on. Resetting someone's password, or enabling a user, also needs those permissions and this one for as long as that user's own access lasts, because whoever sets a password can sign in with it (an API key always has an end time, so it can do neither for a user with access that does not end before it). Nobody can give access that outlasts their own: an assignment needs the giver's access until it ends, and a single role, which has no end, needs access with no end. An assignment the user already has may be sent again, shortened or narrowed to fewer groups by someone who holds its permissions there now, for however long. |
| `users:delete` | Yes | No | No | No | No | No | No | Deleting disables the account and ends its sessions; the row is kept. |
| `settings:read` | Yes | No | No | No | No | No | No | Also reads certificates (not private keys), tags, extensions, and the pruner schedule and statistics. Secret settings are masked. Someone holding it on some groups sees pruner statistics and tag counts for the channels in their access only. |
| `settings:write` | Yes | No | No | No | No | No | No | Purges audit events older than a chosen number of days (minimum 1). Runs the message pruner now, for all channels or for one channel with any age of 1 day or more, which deletes messages, and changes its schedule. Also uploads certificates and private keys, manages tags and enables or disables extensions. |
| `events:read` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Reads and exports the whole audit log, including every user's sign-ins and client addresses. Searches are recorded in the audit log, best effort; exports fail-closed, with a reason. |
| `resources:read` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | |
| `resources:write` | Yes | Yes | Yes | No | No | No | No | Channel scripts read resources with `getResource`, so an edit changes what they receive. |
| `resources:delete` | Yes | Yes | No | No | No | No | No | |
| `collections:read` | Yes | Yes | Yes | Yes | No | No | No | Reads collection records, which channel scripts write and which can hold PHI. Viewers have it, and reads are recorded in the audit log, best effort. |
| `collections:write` | Yes | Yes | Yes | No | No | No | No | Adds and edits records that running channels read. |
| `collections:delete` | Yes | Yes | No | No | No | No | No | |
| `datasources:read` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Shows each data source's host, port, database and user name. The password is never returned. |
| `datasources:write` | Yes | Yes | No | No | No | No | No | Channel scripts query data sources with `dbQuery`, using the stored credentials. Also runs a data source connection test from the server. |
| `datasources:delete` | Yes | Yes | No | No | No | No | No | |
| `global_scripts:read` | Yes | Yes | Yes | No | No | Yes | Yes | |
| `global_scripts:write` | Yes | No | No | No | No | No | No | Runs code on the server: global deploy and undeploy scripts run with every channel, and the global preprocessor and postprocessor run on every message. |
| `global_map:read` | Yes | Yes | Yes | No | No | No | No | Values are returned in full. Scripts can store PHI or credentials there. Reads are recorded in the audit log, best effort. |
| `global_map:write` | Yes | No | No | No | No | No | No | Can clear the whole map, which running scripts read. |
| `config_map:read` | Yes | Yes | Yes | No | No | No | No | Values are returned in full, and the configuration map often holds credentials. Reads are recorded in the audit log, best effort. |
| `config_map:write` | Yes | No | No | No | No | No | No | Channel scripts read these values. |
| `system:info` | Yes | Yes | No | No | No | No | No | Also reads the server log and the live log stream, `/metrics` and `/health/full`. Error text in the log, from scripts and connectors, can hold PHI. |
| `system:backup` | Yes | No | No | No | No | No | No | The backup holds every channel's scripts, the global and configuration map values, resources, and every user's name and email address. Secret settings and secret connector fields are masked. |
| `system:restore` | Yes | No | No | No | No | No | No | Overwrites channels, code templates and global scripts from a file, so it runs code at the next deploy. Also restores settings and both maps. Held only until a time, it restores the channels but not a group membership that gives access, which is reported as an error. |
| `roles:read` | Yes | No | No | No | No | No | No | Lists every role with its permissions and how many users hold it (`GET /api/v1/roles`). |
| `roles:write` | Yes | No | No | No | No | No | No | Creates, edits, clones and deletes roles. A change to a role changes what every holder may do, so it is as strong as admin, up to the permissions the editor holds: a role can only gain a permission its editor holds, with no end time if the role is assigned to anyone. The admin role cannot be changed or deleted, and a role still assigned cannot be deleted. |
| `api_keys:read` | Yes | No | No | No | No | No | No | Lists API keys (`GET /api/v1/api-keys`): name, issuer, permissions, scope, end time, status and last use. Never a key's secret. |
| `api_keys:manage` | Yes | No | No | No | No | No | No | Issues, enables, disables and revokes API keys. A key holds at most what its issuer holds, on the issuer's scope, checked at issue for the key's whole life and again on every request; enabling a key needs the same of the person enabling it. A key can never hold a permission from this group (users, roles, keys, the audit log, backup and restore). |
| `audit:read` | Yes | No | No | No | No | No | No | Reads the protected audit log (`GET /api/v1/audit`): sign-ins and failed sign-ins with client addresses, refused requests and purges. |

## Who can run code on the server

Code reaches the server through channel scripts (deploy, undeploy, preprocessor, postprocessor), filters, transformers, JavaScript connectors, code templates, which are compiled into every channel that includes them, and global scripts, which are compiled into every channel.

- **admin** can write all of it, deploy it, and restore it from a backup.
- **deployer** can write channel scripts and code templates (`channels:write`, `code_templates:write`) and deploy them (`channels:deploy`). It cannot write global scripts.
- **developer** can write channel scripts and code templates but cannot deploy, enable or disable a channel. Its code runs the next time someone holding `channels:deploy` deploys an affected channel. A server restart does not run it: each channel comes back as it was last deployed, with the code templates and global scripts it was deployed with (D-328).
- A code template or global script change reaches a running channel only when that channel is deployed again.
- **viewer** cannot write code.

Scripts run in a `node:vm` sandbox. [SECURITY.md](../../SECURITY.md) says this sandbox is not a hard security boundary against hostile script authors. Treat admin, deployer and developer as able to read everything the engine handles: every message, the maps, collections, and the credentials channels and data sources use.

## Where PHI and secrets can leave

| Path | Permission | Roles | Audited? |
|---|---|---|---|
| Message search and message detail | `messages:read` | All four | Yes, fail-closed in the audit log: `MESSAGE_SEARCHED`, `MESSAGE_CONTENT_VIEWED` |
| Message export (`GET /api/v1/channels/:id/messages/export`) | `messages:read` | All four | Yes, fail-closed in the audit log, with every exported id: `MESSAGES_EXPORTED` |
| Attachment download | `messages:read` | All four | Yes, fail-closed in the audit log: `ATTACHMENT_DOWNLOADED`. Listing a message's attachments is not. |
| Cross-channel message search (Traffic, `GET /api/v1/messages`) | `messages:read` | All four | Yes, fail-closed in the audit log: `MESSAGES_SEARCHED_ALL_CHANNELS` |
| Reprocess and resend to destinations | `messages:reprocess` | admin, deployer | Yes: `MESSAGE_REPROCESSED`, `MESSAGES_REPROCESSED`, `MESSAGE_RESEND_QUEUED` |
| Collection records | `collections:read` | All four | Best effort: `COLLECTION_RECORDS_READ` |
| Global map and configuration map values | `global_map:read`, `config_map:read` | admin, deployer, developer | Best effort: `GLOBAL_MAP_READ`, `CONFIG_MAP_READ` |
| Audit event export (`GET /api/v1/events/export`) | `events:read` | All four | Yes, fail-closed in the audit log with its reason: `EVENTS_EXPORTED` |
| Channel export (scripts and connector settings, secret fields masked) | `channels:read` | All four | Yes: `CHANNEL_EXPORTED` |
| Connector credentials (channel and revision reads with secrets unmasked) | `channels:write` | admin, deployer, developer | Best effort: `CHANNEL_SECRETS_READ` |
| Server log and live log stream | `system:info` | admin, deployer | The log page, best effort: `SERVER_LOG_READ`. The live stream is not |
| Server backup | `system:backup` | admin | Yes, fail-closed in the audit log, with its reason and the SHA-256 of the file as the Backup page saves it, less its `exportInfo` header: `SERVER_BACKUP_EXPORTED` |
| Alert emails | `alerts:write` to set recipients | admin, deployer | The alert change is (`ALERT_UPDATED`); each email is recorded best effort with its recipients, never its text (`ALERT_SENT`) |
| Channel destinations, and scripts using `httpFetch`, `dbQuery`, `routeMessage` or collections | `channels:write` to write, `channels:deploy` to run | admin, deployer; developer writes | Channel changes and deploys are (`CHANNEL_UPDATED`, `CHANNEL_DEPLOYED`); what a running channel sends is not |

`httpFetch` refuses private and reserved addresses unless the host is listed in `SCRIPT_HTTP_ALLOWED_HOSTS`. Public addresses are always allowed.

File sources and File destinations reach only directories under `FILE_CONNECTOR_ROOTS`, never the server's install, working directory, `/proc`, `/sys` or `/dev`, so a deployer cannot read the server's `.env` or overwrite its code through a channel ([FILE security](connector-reference.md#file-security)). DICOM Listeners store and move files, and DICOM Senders send them, under the same roots ([DICOM security](connector-reference.md#dicom-security)).

## What scope promises

An assignment gives a role on every channel or on chosen channel groups ([#266](https://github.com/MichaelLeeHobbs/mirthless/issues/266)). On the Users page, editing a user lists their access: each row is a role, its scope (All channels, or Chosen groups), an optional end time and a reason, and Save sends the whole list. A new user gets one role on every channel; edit them afterwards to give access on groups. Roles holding a permission marked all channels only cannot be given on groups, and the Default group is never offered as a scope. On the dashboard, a group that someone's access is scoped to carries a Gives access chip: adding a channel to it gives those people access to the channel. Someone who can change channels in several groups, but not on every channel, chooses the group a new, cloned or imported channel joins. A code template library's Channels field links it to every channel or to chosen ones; links to channels outside your access show as a count. The account menu's My access lists what you may do and where. When your access changes while you work, a page that finds a channel missing asks the server again, and if your access changed every page says so. An hour before temporary access ends, a banner says when. This is what a scope means; the role editor, the assignment picker and the API key form say the same:

> Scope limits what a person or key can see and change through GalvaniGraph's screens and API. Message reads, searches and exports, and the reads listed under "What is recorded", are recorded in an audit log that the product can't change or delete; each entry there says whether the read is refused when it can't be recorded or recorded on a best-effort basis. Reads under "What is not audited" aren't. Scope is not a boundary for code: anyone who can change or deploy channel code, code templates or global scripts, or restore a backup, can reach every channel's messages and credentials through that code, and that reach is not recorded. A database owner can still alter the audit log.

The audit log is the `audit_log` table. The server's database role may only add rows to it and read them, and triggers refuse changes and deletions even from the table's owner. Only the owner can drop a month of it. The owner function for that, `drop_expired_audit_partitions`, drops no month younger than the retention setting (at least six years), but an owner can still drop a partition by hand. The [audit log runbook](../ops/audit-log.md) covers retention and the partitions. Only `audit:read`, held by admin, reads it; the Events page shows it under Access records. It holds sign-ins, sign-outs and failed sign-ins, refused requests, event purges, message searches, detail views, exports and attachment downloads, messages sent from the UI, script test runs, backup downloads, and the best-effort reads in the table above.

**What is recorded.** A message search (in one channel or across channels), a message's detail, a message export and an attachment download are recorded before anything is sent. When the record cannot be written within 2 seconds the request is refused with 503 `AUDIT_UNAVAILABLE` and nothing is sent. A search records the search term as typed, the filters, the total and every message id it returned; an export records every exported id. The same caller repeating the same search page or detail view within 15 minutes is not recorded again, except that a repeated page that lists a message not recorded yet is recorded again at once, naming only the new ids, so every message a caller was shown is in the log. Exports and attachment downloads are recorded every time. A message sent from the UI, a script test run that returns a result and a backup download are recorded the same way, fail-closed.

**Exports and backups need a reason.** A message export, an event export and a backup download each ask why they are being taken; the reason is required (3 to 500 characters, one line), is recorded with the export, and is written into the file. Every exported file starts with a header naming the server, who exported it, when, the audit record and the reason: `# ` comment lines at the top of a CSV, an `export` object beside the rows in JSON, and an `exportInfo` object at the top of a backup. When the audit log cannot record an export, the server answers 503 `AUDIT_UNAVAILABLE`, nothing is downloaded, and the page says to ask an administrator; there is no way around it. Changes to channels, users, settings and the like are still events in the `events` table.

## What is not audited

These write no audit event:

- The live log stream.
- Viewing one event, and the audit log itself (`GET /api/v1/audit`).
- Socket.IO live feeds: the dashboard and channel feeds carry IDs, states and counts; the log feed carries log entries.
- Reading channels, code templates, resources, data sources and settings. Channel export is audited.
- Listing a message's attachments. Downloads are audited.
- Test Connection, and the data source connection test. Sending a test message into a channel is recorded fail-closed before it is sent (`MESSAGE_SENT`), so a refusal means nothing was sent, as is a script test run that returns a result (`SCRIPT_TEST_RUN`).
- Resetting channel statistics and unlocking an account. Enabling or disabling an extension writes a `SETTINGS_CHANGED` event with no user or client address.
- Token refreshes.

**Refused requests.** A request the API refuses for its credential or its permission writes an `ACCESS_DENIED` row to the audit log (outcome FAILURE). It records the method, the route template (`/api/v1/channels/:id`, never the URL or query string), the reason, the status, the user when known, the client address and the request id; never the body or the token. The reasons are `no_credentials`, `bad_token`, `user_not_found` and `session_revoked` (401), and `account_disabled`, `password_change_required` and `no_permission` (403). A refusal of the credential happens before the request is routed, so it carries no route. The first refusal for a user (or an anonymous caller), method, route and reason writes an event, and further ones in the next minute are counted rather than written: when the minute ends, one more event carries their number in `repeatsSinceLast`. The route's mount path is recorded in lower case, so changing the case of a URL does not open a new minute.

Sign-ins, sign-outs, failed sign-ins, refused requests and the best-effort reads above are written to the audit log in the background, as are the events in the `events` table. If a write fails, the server logs a warning, counts it (System Info shows the count since the server started) and the record is lost; the action itself still succeeds.

An admin (`settings:write`) can purge events from the `events` table older than any number of days down to 1 (`DELETE /api/v1/events?olderThanDays=N`). The purge is first recorded in the audit log as `EVENTS_PURGED`, and refused with 503 `AUDIT_UNAVAILABLE` when that record cannot be written. A purge never touches the audit log, and the message pruner does not delete events.

Every role, viewer included, holds `events:read` and can read and export the `events` table. Only `audit:read` reads the audit log.

## Endpoints any signed-in user, or anyone, can call

These have no permission check.

Anyone, without signing in:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Overall status only (`ok` or `degraded`), for load balancers; 503 only while the database is unreachable |
| `GET /health/live` | Liveness: the process answers |
| `GET /health/ready` | Readiness: whether the database is reachable, and the names of any startup steps that failed (no error text) |
| `GET /api/v1/health` | Returns `ok` |
| `GET /metrics` | Prometheus metrics, only when `METRICS_PUBLIC=true`. Otherwise it needs `system:info`. |
| `GET /api-docs`, `GET /api-docs/spec.json` | Swagger UI and the OpenAPI description, served when `API_DOCS_ENABLED=true`, or by default when `NODE_ENV` is not `production` |
| `POST /api/v1/auth/login` | Sign in (rate limited, see [Signing in](#signing-in)) |
| `POST /api/v1/auth/refresh` | Exchange the refresh cookie for new tokens |

Any signed-in user:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth/logout` | End the current session |
| `POST /api/v1/users/me/password` | Change your own password (needs the current one) |
| `GET`, `PUT`, `DELETE` under `/api/v1/users/me/preferences` | Read and change your own UI preferences |
| Socket.IO connection | Receives channel state changes (channel ID and state). Joining the dashboard, channel or log feed needs a permission. |

## Per-endpoint permissions

The Swagger UI at `/api-docs` describes part of the API and does not name the permission each endpoint needs, so the `requirePermission` call on each route in `packages/server/src/routes/` is the authority.
