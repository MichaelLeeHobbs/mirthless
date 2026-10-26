# HIPAA / Security Checklist

What Mirthless does today for the HIPAA Security Rule's technical safeguards
(45 CFR 164.312) and related controls, what an operator must configure, and
the known gaps. Reviewed against the code on 2026-10-09.

> This is an engineering checklist, not legal advice. HIPAA compliance belongs
> to the organisation running Mirthless: its risk analysis, policies, BAAs,
> training and physical safeguards are outside this document.

## Operator checklist (do these before carrying PHI)

| Do this | Why | Where |
|---|---|---|
| Terminate TLS in front of the web UI and API (nginx `:443` or a load balancer) and redirect `:80` | The shipped nginx listens on `:80` only | [tls-and-phi.md](tls-and-phi.md) |
| Set `DATABASE_SSL=true` when Postgres is not on the same host | The example env has it `false` | `.env.production.example` |
| Turn on TLS for every MLLP/HTTP connector that leaves the host | Connector TLS is opt-in per connector | Channel editor, connector settings |
| Set **Encrypt data** on every channel that stores message content, and set `CONTENT_ENCRYPTION_KEY` | Encryption at rest is off by default per channel | Channel summary tab; [deployment.md](deployment.md) |
| Set `secure` or `requireTLS` on SMTP destinations and alert email | SMTP defaults allow plaintext if the server offers no STARTTLS | Connector settings, system SMTP settings |
| Turn on pruning with a retention period that matches your policy | Pruning is off by default per channel | Channel summary tab |
| Encrypt and access-control backup exports and `pg_dump` files | Backup export is plain JSON; dumps contain PHI | [backup-restore.md](backup-restore.md) |
| Give each person their own account with the least role that works; use **viewer** sparingly (it can read and export messages) | Accounts are the audit identity | Users page |
| Change the seeded `admin` password at first login (enforced) and keep at least two admins | Recovery if one admin is locked out | Users page |
| Keep `LOG_HTTP_HEADERS` unset and `LOG_LEVEL` at `info` or quieter | Header logging is for debugging only | Environment |
| Configure a `NO_MESSAGES` alert on critical interfaces | Silent interfaces are a patient-safety risk | Alerts page |

## Technical safeguards

| Safeguard | Status | What the code does |
|---|---|---|
| **Unique user identification** (a)(2)(i) | Met | One account per person, created by an admin (no self-registration). The seeded admin must change its password before any other API call works. Deleting a user disables it, keeping the audit identity. |
| **Emergency access** (a)(2)(ii) | Gap | No break-glass role or procedure. The last enabled admin cannot be disabled or deleted. Operators need a documented procedure (e.g. a sealed second admin account). |
| **Automatic logoff** (a)(2)(iii) | Partial | Access tokens last 15 minutes. Logout, password change, admin reset and disabling a user revoke sessions immediately. **Gap:** no idle timeout in the web UI, and each refresh starts a new 7-day session, so an open tab stays signed in indefinitely. |
| **Encryption at rest** (a)(2)(iv) | Partial | AES-256-GCM per channel when **Encrypt data** is on; deploy refuses an encrypted channel with no key, and a failed encryption never falls back to plaintext. Data source passwords are always encrypted. A cloned channel keeps its encryption setting. **Gaps:** off by default; attachments are not encrypted; connector credentials, the SMTP password and certificate private keys are stored in plaintext (masked in API responses only); one key, no rotation. |
| **Audit controls** (b) | Partial | The `events` table records logins, every rejected login (with reason, including unknown usernames and lockouts), logout, message content views, searches, exports, attachment downloads, reprocessing, deletes, channel/user/settings changes, backup export and restore, and event purges. **Gaps:** events are written fire-and-forget (a DB failure logs a warning and drops the event); `settings:write` can purge events older than 1 day; no tamper evidence on the table; cross-channel search is not audited. |
| **Integrity** (c)(1) | Partial | Encrypted content is authenticated (GCM), so tampering fails decryption. Channel configuration keeps revision snapshots. **Gap:** plaintext content and audit rows have no hash or immutability. |
| **Person or entity authentication** (d) | Partial | bcrypt (cost 12); passwords 8 to 128 characters with a letter and a digit; 5 failed logins lock the account for 15 minutes; 5 failed logins per IP per 15 minutes are rate-limited. **Gaps:** no MFA; admin-created users and admin resets do not force a password change; anyone can lock out a known username. |
| **Transmission security** (e)(1) | Partial | MLLP and HTTP connectors support TLS with certificate verification on by default, and the HTTP receiver supports mutual TLS. The DB pool and migrator verify certificates when `DATABASE_SSL=true`. **Gaps:** TLS is opt-in everywhere (see the operator checklist); DICOM has no TLS. |

## Related controls

| Control | Status | Notes |
|---|---|---|
| Access control (RBAC) | Partial | Four fixed roles (admin, deployer, developer, viewer), checked on every API route. **Gap:** `messages:read`, held by every role including viewer, also allows bulk message export and attachment download; there is no per-channel scoping. Developers can run server-side scripts (`channels:write`). |
| Logging hygiene | Partial | HTTP logs carry only method, URL and status by default; auth headers, cookies, passwords and tokens are redacted. **Gap:** redaction matches fixed paths, not nested keys; user-script `logger` output (which may contain PHI) is readable by the deployer role. |
| Retention and disposal | Partial | Per-channel pruning (audited) and remove-content-on-completion. Backup export excludes messages, events and password hashes, and redacts secrets it knows about, but global/config maps and code templates may hold secrets. |
| Browser security | Partial | `helmet()` on API responses, single-origin CORS, Bearer auth (no CSRF exposure), refresh token in an httpOnly SameSite=strict cookie. **Gap:** the access token is kept in `localStorage`, and nginx sets no CSP or HSTS for the web app, so an XSS bug would expose a token that can read PHI. |

## Known gaps, highest risk first

1. **TLS is opt-in everywhere.** Mitigated by the operator checklist. A code fix would ship nginx with TLS on and refuse to start in production without `DATABASE_SSL`.
2. **Encryption at rest is opt-in and incomplete** (attachments, connector credentials, SMTP password, certificate keys).
3. **No MFA, and no CSP/HSTS** to contain an XSS that could read the `localStorage` token.
4. **No idle timeout or absolute session lifetime.**
5. **Audit events can be dropped** on a DB write failure, and can be purged down to 1 day by `settings:write`.
6. **Viewer can bulk-export PHI**; no per-channel access.
7. **Password policy and resets:** 8-character minimum; admin resets do not force a change.
8. **No break-glass procedure.**
9. **Backup exports are unencrypted** and may contain secrets held in maps or templates.
10. **Log redaction** misses nested keys; script logs visible to deployers.

Fixed during the 2026-10 release-readiness pass: token refreshes no longer
share the login rate limit (which logged users out behind a proxy), every
rejected login, logout and backup export is now audited, and a cloned
encrypted channel stays encrypted.
