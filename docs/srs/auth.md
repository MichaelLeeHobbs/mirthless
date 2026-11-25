# Authentication

How people and programs prove who they are: accounts and passwords, sign-in and lockout, sessions, second factors, single sign-on, API keys, cutting someone off, emergency access and the notice before sign-in. Area code `AUTH`. Who may do what, and where, is Access control (`ACC`); what the audit log holds is Audit (`AUD`).

## Accounts and passwords (USR)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-USR-01 | Apart from the first administrator of a new install, the system shall create an account for a person only when a signed-in user with permission to manage users creates it, or through single sign-on after an administrator has turned that on, and shall offer no self-registration. | P1 | Test | Proposed |
| AUTH-USR-02 | When an account is deleted, the system shall disable it, keep its username and email address, and refuse to give either to another account, so that every audit record made under it always names the same person. | P1 | Test | Proposed |
| AUTH-USR-03 | The system shall refuse a new password shorter than the minimum length an administrator sets, which is 15 characters on a new install and cannot be set below 8, at account creation, at a reset by another user and at a user's own change. | P1 | Test | Proposed |
| AUTH-USR-04 | The system shall accept a password of up to 128 characters and shall refuse a sign-in whose password differs from the stored one in any single character, at any position. | P1 | Test | Proposed |
| AUTH-USR-05 | After a new install creates its first administrator, or someone other than the user sets a user's password, the system shall refuse every request and live connection of that user except signing out and changing the password, until the user changes it to a different one. | P1 | Test | Proposed |
| AUTH-USR-06 | The system shall change a user's own password only when the user gives the current one, and shall refuse a reset aimed at the caller's own account, whatever the letter case of the identifier in the request. | P1 | Test | Proposed |
| AUTH-USR-07 | The system shall store passwords, credentials that renew a session, and API key secrets only as one-way hashes, with passwords salted and no cheaper to check than bcrypt at cost 12. | P1 | Inspection | Proposed |
| AUTH-USR-08 | After a new install creates its first administrator, or someone other than the user sets a user's password, the system shall refuse everything in that user's sessions except signing out and changing the password, until the user changes it to a different one, while API keys that user issued keep working. | P1 | Test | Proposed |
| AUTH-USR-09 | The system shall store passwords only salted and one-way, by a method and cost accepted by the edition of the OWASP password storage guidance that the documentation names. | P1 | Inspection | Proposed |
| AUTH-USR-10 | The system shall store session-renewal credentials, recovery codes and API key secrets only as one-way hashes. | P1 | Inspection | Proposed |
| AUTH-USR-11 | The system shall change a user's own password only when the user gives the current one, and shall refuse a reset aimed at the caller's own account. | P1 | Test | Proposed |

- AUTH-USR-01: source: docs/user/capabilities.md "Local user accounts with passwords"; docs/user/access-control.md "What is supported and what is not"; #148 (automatic creation is an opt-in setting). Who holds the permission is ACC's.
- AUTH-USR-02: source: docs/ops/hipaa-security-checklist.md "Unique user identification"; docs/user/access-control.md "Cutting someone off" (Delete the user: the row stays); docs/testing/11-users.md (duplicate username and email refused). D-379 (the email address). The row does not say whether an email address that differs only in letter case is the same one; the product takes it for another.
- AUTH-USR-03: source: #210, #209, ROADMAP V4, capabilities.md "Password rules" (Partial). conflict: capabilities.md and access-control.md say 8 characters with a letter and a digit, not configurable; #210 says a configurable minimum, 15 by default, with composition rules optional and off; intent (#210) kept. The floor of 8 is today's rule carried over; #210 names no floor. By #209 and #210 a stricter rule applies the next time a password is set and does not stop an existing password from signing in. conflict: docs/design/06-web-admin.md lists password expiry as a setting; #210 does not carry it over, so there is no row for it. #210's rule against a password equal to the username and its optional change at next sign-in, and #209's strength rule for inbound connector credentials, have no row.
- AUTH-USR-04: source: access-control.md "Password rules" (8 to 128 characters).
- AUTH-USR-05: source: #362; D-147 (the first administrator); access-control.md "Forced password change"; capabilities.md "Password rules" (an admin reset does not force a change today).
- AUTH-USR-06: source: D-148, D-344, access-control.md "Password rules" and "Cutting someone off".
- AUTH-USR-07: source: access-control.md "What is supported and what is not", "Session record" and "API keys" (the token is shown once); D-313, D-324. One strength is named because users are told it today.
- AUTH-USR-08: source: srs-debate 2026-11-24, finding A1 (Contractor 8; Domain and Tester agree). Read literally, the old row stopped live feeds at a password reset. Replaces AUTH-USR-05: when this row is accepted, that row becomes Superseded by AUTH-USR-08.
- AUTH-USR-09: source: srs-debate 2026-11-24, finding A2 (Scope 10, reworded by Tester after the Contractor's rebuttal that "current" guidance moves). Replaces AUTH-USR-07: when this row is accepted, that row becomes Superseded by AUTH-USR-09.
- AUTH-USR-10: source: srs-debate 2026-11-24, finding A2 (Tester). The other half of AUTH-USR-07, with recovery codes added.
- AUTH-USR-11: source: srs-debate 2026-11-24, finding A3 (Scope 8). The letter-case clause is API-CHG-03's. Replaces AUTH-USR-06: when this row is accepted, that row becomes Superseded by AUTH-USR-11.

## Sign-in and lockout (LOG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-LOG-01 | After 5 failed sign-ins to one account, counted since its last successful sign-in or its last lock, the system shall refuse every sign-in to that account, the correct password included, for 15 minutes or until a user with permission to manage that account unlocks it. | P1 | Test | Proposed |
| AUTH-LOG-02 | The system shall hold the lock against sign-ins sent at the same time: each failed one shall count, and a sign-in whose password was still being checked when the lock was set shall be refused and shall not clear the lock. | P1 | Test | Proposed |
| AUTH-LOG-03 | The system shall count a wrong password, second-factor code or recovery code toward the account's lock at every prompt that asks for one (sign-in, second-factor step, own password change, re-authentication), and shall refuse answers at those prompts while the account is locked. | P1 | Test | Proposed |
| AUTH-LOG-04 | In a production install, the system shall refuse further sign-in attempts from a client address for the rest of a 15-minute window in which 5 attempts from it failed, taking the address only from proxies the operator has declared, and counting neither successful sign-ins nor session renewals. | P1 | Test | Proposed |
| AUTH-LOG-05 | The system shall answer a sign-in with an unknown username exactly as it answers a wrong password for an enabled, unlocked account, after doing the same password-checking work. | P1 | Test | Proposed |
| AUTH-LOG-06 | After 5 failed answers for one account, counted since its last sign-in that completed every required step or its last lock, the system shall refuse every sign-in to that account, the correct password included, for 15 minutes or until a user with permission to manage that account unlocks it. | P1 | Test | Proposed |
| AUTH-LOG-07 | The system shall keep an account's failure count and lock across server restarts. | P1 | Test | Proposed |
| AUTH-LOG-08 | In a production install, the system shall refuse further sign-in attempts from a client address for the rest of a 15-minute window in which a number of attempts from it that the operator sets (20 to 200, 50 by default) failed, counting neither successful sign-ins nor session renewals. | P1 | Test | Proposed |
| AUTH-LOG-09 | The system shall give every failed sign-in the same answer, which says the account may be locked, whether its username is unknown or its account is enabled, disabled or locked. | P1 | Test | Proposed |
| AUTH-LOG-10 | Despite AUTH-LOG-06, failed answers sent without a device credential issued at that user's own completed sign-in in the last 30 days, and since their last password change, shall not lock sign-ins that carry it; failures with it count separately. | P2 | Test | Proposed |
| AUTH-LOG-11 | The system shall do the same password-checking work for a sign-in with an unknown username as for one with a wrong password for an enabled, unlocked account. | P1 | Inspection | Proposed |
| AUTH-LOG-12 | An account lock shall not end that person's open sessions or stop API keys they issued. | P1 | Test | Proposed |

- AUTH-LOG-01: source: capabilities.md "Lock an account after failed sign-ins"; access-control.md "Account lockout". The stated limit that anyone who knows a username can lock it has no plan in any source.
- AUTH-LOG-02: source: #396, #174; access-control.md "Account lockout" (while it is locked, even the correct password is refused).
- AUTH-LOG-03: source: #142 (second-factor failures count towards the existing lockout), #140 (the re-authentication window). Extending the rule to every prompt, and refusing answers while locked, is the drafter's.
- AUTH-LOG-04: source: capabilities.md "Rate-limit sign-in attempts"; access-control.md "Login rate limit". conflict: D-074 gave session renewals the same limit as sign-ins; hipaa-security-checklist.md and access-control.md give them their own, because the shared limit signed users out; the later rule kept. Behind one shared address, 5 failures stop sign-in for everyone there; access-control.md states this.
- AUTH-LOG-05: source: code only (`packages/server/src/services/auth.service.ts`, the reason given beside the check for an unknown user); no page states it.
- AUTH-LOG-06: source: srs-debate 2026-11-24, finding A4 (Tester 1, Contractor 3, Scope). "Successful sign-in" was undefined once a second factor exists. Replaces AUTH-LOG-01: when this row is accepted, that row becomes Superseded by AUTH-LOG-06.
- AUTH-LOG-07: source: srs-debate 2026-11-24, finding A4 (Contractor 3, Tester).
- AUTH-LOG-08: source: srs-debate 2026-11-24, finding A5 (Customer 1, Domain 6, Contractor). Today the number is 5 and fixed. The Customer asked for 30: decision D-A2. Replaces AUTH-LOG-04: when this row is accepted, that row becomes Superseded by AUTH-LOG-08.
- AUTH-LOG-09: source: srs-debate 2026-11-24, finding A6 (Tester 6; Customer, that the answer mention a possible lock). Replaces AUTH-LOG-05: when this row is accepted, that row becomes Superseded by AUTH-LOG-09.
- AUTH-LOG-10: source: srs-debate 2026-11-24, finding A7 (Customer 2, Domain, reworded by Tester; Scope and Contractor against). Decision D-A1.
- AUTH-LOG-11: source: srs-debate 2026-11-24, finding A6 (Tester 6, Scope). The timing half of AUTH-LOG-05; a measured 10% bound was cut because it would fail at random in CI.
- AUTH-LOG-12: source: srs-debate 2026-11-24, finding A8 (Domain 2; Scope keeps).

## Sessions (SES)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-SES-01 | The system shall refuse every API request and live connection, other than those documented as public, unless it carries an unaltered credential issued by this install for a session or API key that is open, and whose owner is enabled, at the time of the request. | P1 | Test | Proposed |
| AUTH-SES-02 | The system shall end a session on the server after it has received no user action for a period an administrator sets, 15 minutes by default; requests the console makes by itself (live updates, polling, session renewals) shall not count as user action. | P1 | Test | Proposed |
| AUTH-SES-03 | The system shall end a session no later than a period after its sign-in that an administrator sets, 12 hours by default, however often the session is renewed. | P1 | Test | Proposed |
| AUTH-SES-04 | When a user signs out, in the console or through the API, the system shall end the session on the server before it confirms, so that neither the access credential nor the renewal credential works again, and shall show an error instead of confirming if it cannot. | P1 | Test | Proposed |
| AUTH-SES-05 | The system shall accept a credential that renews a session at most once, also when several renewals with it arrive at the same time. | P1 | Test | Proposed |
| AUTH-SES-06 | In a production install, the system shall give the browser the renewal credential only in a form that page scripts cannot read and that the browser sends only over TLS, only to the sign-in service, and never in a request another site started. | P1 | Test | Proposed |
| AUTH-SES-07 | The system shall not keep a credential that gives access to the API in browser storage that page scripts can read. | P2 | Inspection | Proposed |
| AUTH-SES-08 | The system shall end a session on the server within 60 seconds after a period without user action that an administrator sets from 1 to 60 minutes, 15 by default; only key, pointer or touch input in the console and API requests the console did not send shall count as user action. | P1 | Test | Proposed |
| AUTH-SES-09 | The system shall end a session no later than a period after its sign-in that an administrator sets, at most 24 hours and 12 hours by default, however often the session is renewed. | P1 | Test | Proposed |
| AUTH-SES-10 | The console shall warn the user at least 60 seconds before inactivity ends the session and let one action keep it open. | P2 | Test | Proposed |
| AUTH-SES-11 | The console shall remove message content from the screen within 60 seconds after its session ends. | P1 | Test | Proposed |
| AUTH-SES-12 | The system shall treat a caller as signed in only on an unaltered credential issued by this install for a session or API key that is open, and whose user or issuer is enabled, at the time of the request. | P1 | Test | Proposed |
| AUTH-SES-13 | The system shall not keep a credential that gives access to the API in browser storage that page scripts can read. | P2 | Test | Proposed |

- AUTH-SES-01: source: access-control.md "Every request is checked against the database" and "Endpoints any signed-in user, or anyone, can call"; D-299. A session is also refused while AUTH-USR-05 applies. Which permission a request needs is ACC's.
- AUTH-SES-02: source: capabilities.md "Idle session timeout" (No); #172; hipaa-security-checklist.md "Automatic logoff" (45 CFR 164.312(a)(2)(iii)). No source gives the number or says what counts as activity; 15 minutes and the activity rule are the drafter's. Without the activity rule an open dashboard never goes idle.
- AUTH-SES-03: source: capabilities.md "Maximum session length" (Partial); #172; hipaa-security-checklist.md known gap 4. conflict: access-control.md "Sessions and tokens" describes 7 days restarted by every renewal, with no end; intent (#172: a session must end) kept. 12 hours is the drafter's number.
- AUTH-SES-04: source: access-control.md "Session record" (logout ends the session) and "Every request is checked against the database"; hipaa-security-checklist.md "Automatic logoff" (logout revokes sessions immediately). The error is the project's fail-loud rule (AGENTS.md).
- AUTH-SES-05: source: access-control.md "Rotation"; #174; checked again in #396.
- AUTH-SES-06: source: access-control.md "Refresh token"; hipaa-security-checklist.md "Browser security".
- AUTH-SES-07: source: hipaa-security-checklist.md "Browser security" and known gap 3. No issue plans it; a content security policy, the other half of that gap, is SEC's.
- AUTH-SES-08: source: srs-debate 2026-11-24, finding A9 (Contractor 6; Tester, Customer and Domain agree). Without the wording a developer typing for 16 minutes would be signed out. Mirth allows 1 to 60 minutes. Replaces AUTH-SES-02: when this row is accepted, that row becomes Superseded by AUTH-SES-08.
- AUTH-SES-09: source: srs-debate 2026-11-24, finding A9 (Customer 6, Scope). Replaces AUTH-SES-03: when this row is accepted, that row becomes Superseded by AUTH-SES-09.
- AUTH-SES-10: source: srs-debate 2026-11-24, finding A10 (Customer 6; Scope keeps at P2).
- AUTH-SES-11: source: srs-debate 2026-11-24, finding A10 (Domain 7, Customer, Scope).
- AUTH-SES-12: source: srs-debate 2026-11-24, finding A11 (Scope 6; Domain agrees provided "at the time of the request" stays). Refusing a caller who is not signed in is ACC-ENF-01's, live connections API-LIV-01's. Replaces AUTH-SES-01: when this row is accepted, that row becomes Superseded by AUTH-SES-12.
- AUTH-SES-13: source: srs-debate 2026-11-24, finding A12 (Tester 8). Same words, Verify changed from Inspection: a browser test can prove it, inspection cannot prove absence. Replaces AUTH-SES-07: when this row is accepted, that row becomes Superseded by AUTH-SES-13.

## Second factors (MFA)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-MFA-01 | When a second factor is due, the system shall answer a correct password only with a credential that lasts at most 5 minutes and is refused for everything except verifying the factor, or enrolling one when the policy requires it and the user has none. | P2 | Test | Proposed |
| AUTH-MFA-02 | The system shall let a user add an authenticator app (RFC 6238 one-time codes) as a second factor, active only after the user enters a valid code, with its secret stored encrypted, sent to no other service and never shown again once active. | P1 | Test | Proposed |
| AUTH-MFA-03 | The system shall accept a one-time code only from the current 30-second step or the step before or after it, and shall refuse a code from the same or an earlier step than the last one it accepted for that user. | P1 | Test | Proposed |
| AUTH-MFA-04 | When a user adds an authenticator app, the system shall show 10 recovery codes once, each of which stands in for the second factor at one sign-in and never again. | P1 | Test | Proposed |
| AUTH-MFA-05 | The system shall let a user sign in with a passkey (WebAuthn), as the second factor after a password or, when the passkey device confirmed the user, in place of both, with passkeys bound to the public host name the operator configured and never to one taken from the request. | P3 | Test | Proposed |
| AUTH-MFA-06 | The system shall let an administrator require a second factor from nobody (the default), administrators, holders of chosen roles or everyone, and choose which kinds of factor count, with no exemption for a single user. | P1 | Test | Proposed |
| AUTH-MFA-07 | The system shall refuse a change to a user's second factors, to the sign-in policy, to a role or an assignment, and the issue or replacement of an API key, unless the caller is a signed-in person who passed a password or factor check in the last 5 minutes. | P2 | Test | Proposed |
| AUTH-MFA-08 | The system shall open no session for a password sign-in until a second factor is verified, when the user has an active factor or the policy covers that user. | P1 | Test | Proposed |
| AUTH-MFA-09 | From a correct password until a due second factor is verified, the system shall refuse that caller everything except verifying it, or enrolling one the policy requires, and shall ask for the password again after 5 minutes. | P1 | Test | Proposed |
| AUTH-MFA-10 | Except under the enrolment AUTH-MFA-09 allows or AUTH-BRK recovery, the system shall refuse a change to second factors, the sign-in policy, a role or an assignment, and the issue or replacement of an API key, unless the caller is a person who, in the last 5 minutes, passed a check of their second factor, else their password, else a fresh sign-in at their identity provider. | P2 | Test | Proposed |

- AUTH-MFA-01: source: #140 (a pending credential of 5 minutes that only the second-factor and enrolment steps accept), #141 (a covered user without a factor reaches nothing but enrolment, with no grace period).
- AUTH-MFA-02: source: #142; capabilities.md "Second factor at sign-in (MFA)" (No); ROADMAP V4.
- AUTH-MFA-03: source: #142 "Verification".
- AUTH-MFA-04: source: #142 "Recovery codes".
- AUTH-MFA-05: source: #143. A passkey whose use counter goes backwards is refused there too.
- AUTH-MFA-06: source: #141. Programs use API keys, so the policy does not reach them. #209 asks whether this sits in a Policies section; where it sits is not a requirement.
- AUTH-MFA-07: source: #140 "A re-authentication window". docs/design/20-rbac-access-plan.md "Won't build and deferred" defers it for access changes until #140 lands. conflict: #144 said an API key never writes settings, where the sign-in policy would live, but D-313 bars keys only from identity permissions; the policy is kept out of a key's reach here.
- AUTH-MFA-08: source: srs-debate 2026-11-24, finding A14 (Contractor 1). "Due" was undefined.
- AUTH-MFA-09: source: srs-debate 2026-11-24, finding A14 (Scope 10). States the behaviour without the credential design. Replaces AUTH-MFA-01: when this row is accepted, that row becomes Superseded by AUTH-MFA-09.
- AUTH-MFA-10: source: srs-debate 2026-11-24, finding A15 (Contractor 2; Customer 4, Tester and Scope agree). The old row shut single sign-on users out of changing a role and contradicted enrolment and recovery. Replaces AUTH-MFA-07: when this row is accepted, that row becomes Superseded by AUTH-MFA-10.

## Single sign-on (SSO)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-SSO-01 | The system shall let a user sign in through an OpenID Connect provider, Microsoft Entra ID among them, as the existing enabled account linked to the identity the provider verified, and shall refuse an identity with no account unless an administrator has turned on account creation. | P2 | Test | Proposed |
| AUTH-SSO-02 | When an administrator requires single sign-on for chosen roles, the system shall refuse those users' passwords, and shall refuse a setting that leaves no enabled administrator able to sign in with a local password and second factor. | P2 | Test | Proposed |
| AUTH-SSO-03 | The system shall skip its own second factor for a single sign-on only when an administrator has allowed that and the provider's answer for that sign-in says it checked a second factor. | P2 | Test | Proposed |
| AUTH-SSO-04 | The system shall let a user sign in through a SAML 2.0 identity provider under the same account rules as AUTH-SSO-06 and AUTH-SSO-07. | P3 | Demonstration | Proposed |
| AUTH-SSO-05 | The system shall let a user sign in with a username and password checked by an LDAP or Active Directory server, over TLS only, under the same account rules as AUTH-SSO-06 and AUTH-SSO-07. | P3 | Demonstration | Proposed |
| AUTH-SSO-06 | The system shall let a person sign in through an OpenID Connect provider, Microsoft Entra ID among them, only as the enabled account linked, by someone who may manage it or under AUTH-SSO-07, to that provider's issuer and subject, and never by matching an email address or a username. | P2 | Test | Proposed |
| AUTH-SSO-07 | The system shall refuse a verified identity with no linked account or, when an administrator has turned on account creation, create one that holds no permission. | P2 | Test | Proposed |
| AUTH-SSO-08 | The system shall refuse a provider answer that is altered, expired, already used, meant for another application, or not for a sign-in the same browser started. | P2 | Test | Proposed |
| AUTH-SSO-09 | The system shall ask the provider at least every 60 minutes to renew each single sign-on session, and shall end the session when the provider refuses. | P2 | Test | Proposed |

- AUTH-SSO-01: source: #148; capabilities.md "Single sign-on (OIDC or SAML)" (No); ROADMAP V4. #148 links by verified email address within allowed domains; the row leaves the link key open. Roles stay assigned in the product (#148, open question 1), which is ACC's.
- AUTH-SSO-02: source: #148 "Policy".
- AUTH-SSO-03: source: #148 "MFA".
- AUTH-SSO-04: source: capabilities.md "Single sign-on (OIDC or SAML)" (No); ROADMAP V4. conflict: #140 puts SAML out of scope of its sign-in structure and no issue plans it; ROADMAP V4 keeps it planned; P3. conflict: ROADMAP "Auth provider plugins" and docs/design/00-architecture-overview.md want sign-in methods as installable packages, and #140 says the structure is not a plugin system; no row for plugins.
- AUTH-SSO-05: source: capabilities.md "LDAP or Active Directory sign-in" (No); ROADMAP V4 (no issue). conflict: as AUTH-SSO-04. The TLS rule is the drafter's.
- AUTH-SSO-06: source: srs-debate 2026-11-24, finding A16 (Tester 3, Contractor 4). conflict: #148 links by verified email address; the panels found that some providers' email claims are not proof of identity. Decision D-A6. Replaces AUTH-SSO-01: when this row is accepted, that row becomes Superseded by AUTH-SSO-06.
- AUTH-SSO-07: source: srs-debate 2026-11-24, finding A16 (Contractor 4).
- AUTH-SSO-08: source: srs-debate 2026-11-24, finding A16 (Tester 3).
- AUTH-SSO-09: source: srs-debate 2026-11-24, finding A17 (Customer 8, reworded by Tester; Scope against). Decision D-A7.

## API keys (KEY)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-KEY-01 | The system shall show an API key's secret only in the answer to the request that issues or replaces the key, and shall return it to no later request. | P1 | Test | Proposed |
| AUTH-KEY-02 | The system shall require an end time when an API key is issued, and once that time has passed or the key is revoked shall refuse every request made with it and refuse to enable it again. | P1 | Test | Proposed |
| AUTH-KEY-03 | The system shall refuse to issue an API key with a permission its issuer does not hold over the key's whole scope until the key ends, and shall refuse every request made with a key while its issuer is disabled or no longer holds what the key holds. | P1 | Test | Proposed |
| AUTH-KEY-04 | The system shall refuse to give an API key any permission over users, roles, API keys, the audit log, backups or restores. | P1 | Test | Proposed |
| AUTH-KEY-05 | The system shall refuse a request that carries an API key in its URL, and one made with an unknown, wrong, ended, revoked, disabled or no longer covered key, with one identical answer that does not say which applied. | P1 | Test | Proposed |
| AUTH-KEY-06 | The system shall let an API key read at most a set number of rows (messages and collection records) in a UTC day, 5,000 by default and counted across restarts, and shall refuse a read that would pass the limit, or whose day's count it cannot determine, before it sends any row. | P1 | Test | Proposed |
| AUTH-KEY-07 | When an API key is replaced, the system shall stop accepting the old secret at once, except that the key's own issuer may keep it working for at most 7 days and never past the key's end. | P1 | Test | Proposed |
| AUTH-KEY-08 | The system shall let an API key read at most a set number of rows (messages and collection records, not messages it submits) in a UTC day, 5,000 by default and counted across restarts, and shall refuse a read that would pass the limit, or whose day's count it cannot determine, before it sends any row. | P1 | Test | Proposed |
| AUTH-KEY-09 | The system shall hold an API key's daily row limit in total across reads sent at the same time. | P1 | Test | Proposed |
| AUTH-KEY-10 | When access an API key's issuer lost only by the passing of time is given back, the system shall accept the key again if it is given back at least until the key's end, and shall otherwise disable the key. | P1 | Test | Proposed |
| AUTH-KEY-11 | An API key disabled because an edit narrowed its issuer's access shall stay disabled until a person enables it. | P1 | Test | Proposed |
| AUTH-KEY-12 | The system shall send an alert, at most hourly per key, when a request carries the correct secret of an ended, revoked, disabled or uncovered key that worked in the last 7 days. | P2 | Test | Proposed |

- AUTH-KEY-01: source: access-control.md "API keys" (the token is shown once); capabilities.md "API tokens for machine callers"; D-313.
- AUTH-KEY-02: source: access-control.md "API keys" (a required end time) and "Cutting someone off" (a revoked or ended key can never be enabled again); D-313.
- AUTH-KEY-03: source: access-control.md "API keys" (within its issuer, when the issuer's access narrows); D-313, D-320. The page says both what an edit that narrows the issuer does (disables the key, until someone enables it) and what access that lapses by itself does (stops the key until it is given back; AUTH-KEY-10).
- AUTH-KEY-04: source: access-control.md "API keys" (within its issuer); D-313.
- AUTH-KEY-05: source: access-control.md "API keys" (bearer only). The plan's refusal of a key sent beside a second credential (docs/design/20-rbac-access-plan.md, section 7) is not stated on that page and is not a row.
- AUTH-KEY-06: source: access-control.md "API keys" (daily row ceiling, with the reads that count); D-313, D-321. Refusing when the count cannot be determined is from the code. The count assumes one server today; it has to hold in total when the product runs on more than one.
- AUTH-KEY-07: source: access-control.md "API keys" (replace); D-322.
- AUTH-KEY-08: source: srs-debate 2026-11-24, finding A18 (Domain 3; Scope agrees). conflict: access-control.md counts sends as rows, because a send's answer carries message content (D-321); as written there, result 5,001 of the day waits until midnight. Decision D-A4. Replaces AUTH-KEY-06: when this row is accepted, that row becomes Superseded by AUTH-KEY-08.
- AUTH-KEY-09: source: srs-debate 2026-11-24, finding A18 (Tester 7).
- AUTH-KEY-10: source: srs-debate 2026-11-24, finding A19 (Contractor 9, split by Tester). Adds the return that AUTH-KEY-03 left unstated. Reworded in place 2026-11-25 to say for how long the access must come back (#419, decided by the developer).
- AUTH-KEY-11: source: srs-debate 2026-11-24, finding A19 (Contractor 9, split by Tester).
- AUTH-KEY-12: source: srs-debate 2026-11-24, finding A20 (Domain 3, reworded by Tester; Scope against). Decision D-A5.

## Cutting someone off (CUT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-CUT-01 | Once it confirms that a user is disabled or deleted, the system shall refuse every request, session renewal and sign-in of that user, by any sign-in method, including those that began before the change. | P1 | Test | Proposed |
| AUTH-CUT-02 | Once it confirms that a user's password was changed or reset, the system shall refuse every session that user signed in to with the old password, whenever that sign-in began, except the session in which the user made the change. | P1 | Test | Proposed |
| AUTH-CUT-03 | The system shall close a user's live connections within 60 seconds after the session behind them ends for any reason or the user is disabled, deleted or given a new password by someone else. | P1 | Test | Proposed |
| AUTH-CUT-04 | When a user is disabled or deleted, the system shall disable in the same change every working API key that user issued, except a key that someone who may manage keys and holds what it holds takes over in that change, which gets a new secret while the old one stops at once. | P1 | Test | Proposed |
| AUTH-CUT-05 | When a disabled user is enabled again, the system shall bring back none of that user's earlier sessions and none of the API keys disabled with the user. | P1 | Test | Proposed |
| AUTH-CUT-06 | The system shall refuse to disable or delete the last enabled administrator, also when several such requests arrive at the same time. | P1 | Test | Proposed |
| AUTH-CUT-07 | The system shall refuse a request in which a user would disable or delete their own account, by any route and whatever the letter case of the identifier in the request. | P1 | Test | Proposed |
| AUTH-CUT-08 | Once it confirms that a user is disabled or deleted, the system shall refuse every request, session renewal and sign-in of that user, by any method, that it had not finished checking by then. | P1 | Test | Proposed |
| AUTH-CUT-09 | The system shall stop sending an answer already under way within 60 seconds after its caller is disabled, deleted or revoked. | P1 | Test | Proposed |
| AUTH-CUT-10 | A resend, reprocess or deployment already accepted when its caller is cut off shall run to its end. | P1 | Test | Proposed |
| AUTH-CUT-11 | Locking, disabling or deleting an account shall not stop, undeploy or change any channel. | P1 | Test | Proposed |
| AUTH-CUT-12 | Once it confirms that a user's password was changed or reset, the system shall refuse every session and unfinished sign-in of that user, by any sign-in method, except the session in which the user made the change. | P1 | Test | Proposed |
| AUTH-CUT-13 | Before a user is disabled or deleted, the console shall list each working API key that will stop, with its name, scope and last use. | P1 | Test | Proposed |
| AUTH-CUT-14 | The system shall let a user, or someone who may manage that account, end all of its sessions without disabling it. | P2 | Test | Proposed |
| AUTH-CUT-15 | The system shall refuse a request in which a user would disable or delete their own account, by any route. | P1 | Test | Proposed |

- AUTH-CUT-01: source: capabilities.md "Cut off a user by disabling the account"; access-control.md "Cutting someone off"; D-148.
- AUTH-CUT-02: source: access-control.md "Cutting someone off" (Reset another user's password); D-148 (an own change keeps the caller's session).
- AUTH-CUT-03: source: access-control.md "Cutting someone off" (re-checked every 60 seconds); capabilities.md "Cut off a user by disabling the account".
- AUTH-CUT-04: source: D-322; access-control.md "API keys" (when the issuer leaves). conflict: D-313 and docs/design/20-rbac-access-plan.md decision 17 gave 7 days to replace a leaver's keys; superseded by D-322, kept. The Users page lists the keys first, so nobody stops a feed unawares.
- AUTH-CUT-05: source: D-322, access-control.md "API keys" (enabling the user again does not enable the keys) and "Cutting someone off" (sessions are deleted).
- AUTH-CUT-06: source: access-control.md "Cutting someone off"; hipaa-security-checklist.md "Emergency access". Demoting the last administrator is ACC's.
- AUTH-CUT-07: source: access-control.md "Cutting someone off" (you cannot delete your own account); #398 (disabling it must be refused too); docs/testing/11-users.md scenario 17; D-344 (letter case). conflict: access-control.md forbids only deleting your own account; #398 and the test scenario forbid disabling it too; kept.
- AUTH-CUT-08: source: srs-debate 2026-11-24, finding A21 (Tester 2; Domain and Contractor agree). "Began before the change" had no observable outcome for a request under way. Replaces AUTH-CUT-01: when this row is accepted, that row becomes Superseded by AUTH-CUT-08.
- AUTH-CUT-09: source: srs-debate 2026-11-24, finding A21 (Tester 2, Domain 1, Contractor).
- AUTH-CUT-10: source: srs-debate 2026-11-24, finding A21 (Domain 1, Tester; Customer would stop it and list what ran). Decision D-A3.
- AUTH-CUT-11: source: srs-debate 2026-11-24, finding A8 (Domain 2; Scope and Tester keep).
- AUTH-CUT-12: source: srs-debate 2026-11-24, finding A22 (Contractor 7; Scope agrees). Replaces AUTH-CUT-02: when this row is accepted, that row becomes Superseded by AUTH-CUT-12.
- AUTH-CUT-13: source: srs-debate 2026-11-24, finding A20 (Customer 5; Scope would make it P2). Only a note said so until now (D-322).
- AUTH-CUT-14: source: srs-debate 2026-11-24, finding A23 (Customer 8; Scope keeps).
- AUTH-CUT-15: source: srs-debate 2026-11-24, finding A3 (Scope 8). The letter-case clause is API-CHG-03's (#397). Replaces AUTH-CUT-07: when this row is accepted, that row becomes Superseded by AUTH-CUT-15.

## Emergency access (BRK)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-BRK-01 | The system shall let a user with permission to manage an account, or an operator with access to the server when no administrator can sign in, clear that account's second factors, and shall change nothing when the clearing cannot be recorded in the audit log. | P2 | Test | Proposed |
| AUTH-BRK-02 | The documentation shall give an emergency access procedure by which a site reaches its messages when no administrator can sign in the normal way, and a person shall be able to complete it with only what the page told the site to prepare. | P1 | Demonstration | Proposed |
| AUTH-BRK-03 | The system shall let an operator with access to the server restore sign-in for one named administrator account when no administrator can sign in, without changing any other account. | P2 | Demonstration | Proposed |
| AUTH-BRK-04 | The system shall let a user with permission to manage an account clear that account's second factors. | P1 | Test | Proposed |
| AUTH-BRK-05 | The system shall let an operator with access to the server enable and unlock one named administrator account, clear its second factors and set its password, changing no other account. | P1 | Test | Proposed |
| AUTH-BRK-06 | The system shall change nothing under AUTH-BRK-04 or AUTH-BRK-05 when it cannot record the change in the audit log. | P1 | Test | Proposed |

- AUTH-BRK-01: source: #141 "Break-glass recovery" (by an operator), #142 "Removal" (by an administrator). Refusing when the record cannot be written follows D-312; #141 asks only that an audit record is written.
- AUTH-BRK-02: source: hipaa-security-checklist.md "Emergency access" (Gap, 45 CFR 164.312(a)(2)(ii)) and known gap 8; capabilities.md "Emergency (break-glass) access" (No), workaround a sealed second administrator account.
- AUTH-BRK-03: source: hipaa-security-checklist.md "Emergency access"; access-control.md "Password rules" (an administrator who forgot their password needs another administrator). #141 covers second factors only; restoring a lost password or a disabled account is the drafter's reading of the gap.
- AUTH-BRK-04: source: srs-debate 2026-11-24, finding A25 (Tester 4, Scope 4). Replaces AUTH-BRK-01: when this row is accepted, that row becomes Superseded by AUTH-BRK-04.
- AUTH-BRK-05: source: srs-debate 2026-11-24, finding A25 (Tester 4; P1 by Customer 3 and Domain 4, conceded by Scope). "When no administrator can sign in" is gone: a forgotten password cannot be detected. Replaces AUTH-BRK-03: when this row is accepted, that row becomes Superseded by AUTH-BRK-05.
- AUTH-BRK-06: source: srs-debate 2026-11-24, finding A25 (Tester 4, Customer, Scope; Domain withdrew recording in the server log instead).

## System use notice (SUN)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| AUTH-SUN-01 | While an administrator has turned a system use notice on, the console shall show its title and text before every sign-in and shall offer no way to sign in until the person agrees. | P2 | Test | Proposed |
| AUTH-SUN-02 | The system shall record in the audit log, against the user who signs in, which version of the system use notice that person agreed to, with every saved change of the text being a new version. | P2 | Test | Proposed |

- AUTH-SUN-01: source: #135; capabilities.md "System use notice before sign-in" (No). Programs never see a screen, so API callers are not asked (#135, open question 2, its own answer kept). The built-in texts (the DoD banner among them) are part of #135 and not a row.
- AUTH-SUN-02: source: #135 "Recording consent". Written here because the notice exists only before sign-in; AUD owns how the record is kept.
