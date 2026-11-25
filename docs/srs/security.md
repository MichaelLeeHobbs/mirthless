# Security

How the product keeps secrets, encrypts traffic, limits what it can reach and what can reach it, and proves what it ships. Area code `SEC`. What scripts may do inside the sandbox is in Scripting, encryption of message content is in Messages, sign-in is in Authentication, and the protected record is in Audit.

## Credentials and secrets (CRD)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-CRD-01 | The system shall store every credential it has to present to another system (connector passwords, tokens and keys, data source passwords, mail passwords and certificate private keys) encrypted with a key that is not in the database, and shall refuse to save one while no such key is configured, naming the missing setting. | P1 | Test | Proposed |
| SEC-CRD-02 | The system shall return a fixed mask in place of every stored credential to every person and API key, except that a holder of permission to change a channel may read that channel's connector credentials. | P1 | Test | Proposed |
| SEC-CRD-03 | The system shall write a fixed mask in place of every connector credential, mail password, data source password and certificate private key in every channel export and server backup. | P1 | Test | Proposed |
| SEC-CRD-04 | When settings are imported or restored from a file, or saved by someone who cannot read the stored credential, the system shall keep that credential only if nothing that decides which server it is sent to, over what protection, or as which user has changed, and shall otherwise discard it. | P1 | Test | Proposed |

- SEC-CRD-01: source: docs/ops/hipaa-security-checklist.md "Encryption at rest" and "Known gaps" 2; docs/user/capabilities.md "Certificate store with issuer and expiry" (private keys in plaintext); docs/design/11-datasources.md "Open follow-ups"; D-178 for data source passwords, which already refuse to save without a key. A known gap, written as the rule that must hold.
- SEC-CRD-02: source: D-145; docs/user/access-control.md "Where PHI and secrets can leave" (connector credentials, data sources). D-145 says credentials are only masked on read; access-control.md says channel writers read them in clear. The later page is kept.
- SEC-CRD-03: source: D-145; docs/ops/api-automation.md "Credentials"; docs/ops/hipaa-security-checklist.md "Retention and disposal". A credential typed into a script, query, URL or header text is not recognised (api-automation.md), so it is outside this row.
- SEC-CRD-04: source: D-335 (import and restore); D-332 (alert email password and its server); docs/ops/api-automation.md "Credentials".

## Encryption keys (KEY)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-KEY-01 | The system shall let an operator replace the data encryption key with no stored message or credential becoming unreadable and with no message refused while the change runs. | P1 | Test | Proposed |
| SEC-KEY-02 | In production the system shall refuse to start when the secret that signs sign-in tokens is shorter than 32 characters, is an example value from the shipped configuration, or has fewer than 10 distinct characters, and shall say which secret to change. | P1 | Test | Proposed |

- SEC-KEY-01: source: docs/user/capabilities.md "Encrypt message content at rest" ("one key, no rotation"); docs/ops/hipaa-security-checklist.md "Encryption at rest"; docs/user/access-control.md "Cutting someone off", which tells the operator to rotate the key with no way to do it. Messages owns which content is encrypted.
- SEC-KEY-02: source: server configuration checks in packages/server/src/config; docs/ops/deployment.md "First install". The limits come from code only.

## Certificates (CRT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-CRT-01 | The system shall let every connector and connection that offers TLS take its certificate, private key and trusted certificate authorities from one certificate store that shows each certificate's subject, issuer, fingerprint and expiry. | P2 | Test | Proposed |
| SEC-CRT-02 | The system shall send an alert 30 days before a stored certificate expires, another 7 days before, and another at expiry, for each certificate used by a deployed channel, naming the certificate and those channels. | P1 | Test | Proposed |

- SEC-CRT-01: source: docs/user/capabilities.md "Certificate store with issuer and expiry" (HTTP, Kafka and AMQP only); docs/ops/tls-and-phi.md "Connector-level TLS" (inline certificates for TCP/MLLP, and none for DATABASE, SMTP, EMAIL and FHIR); D-274 calls a store lookup for TCP/MLLP a feature to add. Which protocols have TLS at all is in Connectors.
- SEC-CRT-02: source: docs/user/capabilities.md "Alert before a certificate expires" (No); #204. 30 days is where the Certificates page turns red today; 7 days and at expiry are the drafter's numbers. How an alert is delivered is in Monitoring and alerts.

## Encryption in transit (TLS)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-TLS-01 | The system shall refuse to deploy a connector whose TLS settings are incomplete or unreadable (a missing certificate, a certificate without its private key, or a key without its certificate), naming what is missing, and shall never run it in plaintext instead. | P1 | Test | Proposed |
| SEC-TLS-02 | The system shall verify the certificate and host name of every server it connects to over TLS unless that one connection is explicitly set not to. | P1 | Test | Proposed |
| SEC-TLS-03 | The system shall refuse any TLS version older than 1.2 on every TLS connection it opens or accepts. | P1 | Test | Proposed |
| SEC-TLS-04 | The shipped production deployment shall accept console, API and live-feed connections from other machines only over TLS, unless the operator states that TLS ends in front of it. | P1 | Test | Proposed |
| SEC-TLS-05 | In production the system shall refuse to start when its own database is on another machine and that connection is not over verified TLS, unless the operator has explicitly accepted it. | P1 | Test | Proposed |
| SEC-TLS-06 | The system shall not send a stored mail password, for alert email or a mail destination, over a connection that is not encrypted. | P1 | Test | Proposed |

- SEC-TLS-01: source: docs/ops/tls-and-phi.md "Receivers (server side)" and "Dispatchers (client side)"; D-277.
- SEC-TLS-02: source: docs/ops/tls-and-phi.md "Dispatchers (client side)", "Connectors with a TLS switch but no certificate options" and "PHI-in-Transit Checklist"; D-216 for databases.
- SEC-TLS-03: source: docs/ops/tls-and-phi.md "PHI-in-Transit Checklist" ("TLS 1.2+ only"). Written there as an operator's check; no test or setting in the product states it.
- SEC-TLS-04: source: docs/ops/tls-and-phi.md "Edge TLS"; docs/ops/hipaa-security-checklist.md "Known gaps" 1 ("a code fix would ship nginx with TLS on"). Today the shipped port answers only on the host itself, and TLS needs an edited file.
- SEC-TLS-05: source: docs/ops/hipaa-security-checklist.md "Known gaps" 1 ("refuse to start in production") and operator checklist (database TLS).
- SEC-TLS-06: source: D-332 for alert email; docs/ops/hipaa-security-checklist.md operator checklist for mail destinations. Conflict: the checklist documents that a mail destination may send its password in plaintext; the rule of D-332 is kept for both.

## Network exposure (NET)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-NET-01 | The system shall refuse a script's HTTP call and a Test Connection to any loopback, link-local, cloud metadata, multicast or reserved address, judged by the address actually connected to, so that neither a name that resolves there nor a redirect reaches it; the one exception is an internal host the operator has listed for script calls. | P1 | Test | Proposed |
| SEC-NET-02 | The system shall refuse a script's HTTP call to a private network address unless the operator has listed that exact host in the server's own configuration, which no person, API key, channel or import can change. | P1 | Test | Proposed |
| SEC-NET-03 | In the shipped production deployment with default settings, the system shall answer a caller who has not signed in only with the console's static files, sign-in and session renewal, health status without error detail, and the published channel listeners; metrics, the API description and the database shall not be reachable. | P1 | Test | Proposed |
| SEC-NET-04 | The system shall open no network connection that no administrator, operator or channel author configured, and the console shall load nothing from any host but its own server. | P1 | Test | Proposed |

- SEC-NET-01: source: D-185 and D-235 (script calls); D-262 (Test Connection). Test Connection may reach private networks, because the endpoints an administrator tests are there.
- SEC-NET-02: source: D-185, D-235; docs/user/capabilities.md "Call HTTP, databases, collections and other channels from scripts". D-235 rejects ranges and wildcards.
- SEC-NET-03: source: SECURITY.md "Security Model Notes"; docs/user/access-control.md "Endpoints any signed-in user, or anyone, can call"; docs/ops/deployment.md "Listener ports"; docs/ops/resource-and-observability.md "Metrics". Permission checks behind sign-in are in Access control.
- SEC-NET-04: source: D-260 ("no phone-home"); docs/design/18-voice-of-the-user.md LIC5; D-283. Conflict: docs/user/capabilities.md "Write scripts in JavaScript or TypeScript" says the script editor loads from a public CDN; D-283 says it is bundled, and the console's code holds no such address. D-283 kept.

## Privileges and files (PRV)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-PRV-01 | In the shipped production deployment the system shall run with a database account that owns no application table, cannot alter, empty or drop one and cannot disable its protections, and shall refuse to start with any account that can. | P1 | Test | Proposed |
| SEC-PRV-02 | The system shall read and write files for File and DICOM connectors only under directories the operator has listed in the server's own configuration, resolved through links, at deploy and before every read, write and move, and never in its own install or working directory or the operating system's device and process directories; with no directory listed those connectors shall refuse to deploy. | P1 | Test | Proposed |

- SEC-PRV-01: source: D-307; SECURITY.md "Security Model Notes"; docs/ops/upgrade.md "Database roles". What that account may do to audit records is in Audit.
- SEC-PRV-02: source: D-315, D-326; docs/ops/deployment.md "First install" (connector directories). D-315 records one remaining limit, a link swapped between the check and the use by someone with access to the host.

## Logs (LOG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-LOG-01 | The system shall never write a password, token, API key, private key or other credential to a server, web or proxy log at any log level, at any depth of a logged value. | P1 | Test | Proposed |
| SEC-LOG-02 | The system shall never write message content, a search term, a patient identifier or a request's query values to a server, web or proxy log at any log level, including in the text of an error raised by a script, a connector or the database. | P1 | Test | Proposed |

- SEC-LOG-01: source: docs/ops/hipaa-security-checklist.md "Logging hygiene" and "Known gaps" 10 (fixed paths only today); AGENTS.md "No credential logging".
- SEC-LOG-02: source: docs/ops/hipaa-security-checklist.md "Logging hygiene" (error text may carry PHI); docs/ops/resource-and-observability.md "PHI in logs" and "nginx logs"; #229, #321. A known gap, written as the rule that must hold. What a script deliberately writes with its logger is in Monitoring and alerts.

## Web and input (WEB)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-WEB-01 | The system shall send with every console page the browser instructions that run scripts only from the console's own origin, refuse framing by other sites and, over TLS, require TLS on later visits. | P1 | Test | Proposed |
| SEC-WEB-02 | The system shall let browser pages from no origin but the one configured console address read API responses, open a live feed or act with a signed-in person's session. | P1 | Test | Proposed |
| SEC-WEB-03 | The system shall check every API request, live-feed message, imported file and set of connector settings against its declared shape before acting on it, and shall refuse one that does not match, naming each bad field and changing nothing. | P1 | Test | Proposed |
| SEC-WEB-04 | The system shall treat text that comes from a message, partner, person or file as data: it shall never run it as a database statement, render it as page markup, or write it to a CSV file in a form a spreadsheet runs as a formula. | P1 | Test | Proposed |

- SEC-WEB-01: source: docs/ops/hipaa-security-checklist.md "Browser security" and "Known gaps" 3 (the web application sends none of these); D-283 notes that the editor and component styles need inline styles, which this row allows.
- SEC-WEB-02: source: docs/ops/hipaa-security-checklist.md "Browser security" (one allowed origin, bearer token, same-site cookie); docs/user/access-control.md "Sessions and tokens"; docs/ops/tls-and-phi.md (console address).
- SEC-WEB-03: source: AGENTS.md "Defensive at boundaries" and "Security First"; D-274 for connector settings; docs/design/05-server-api.md "Server backup/restore" for files.
- SEC-WEB-04: source: AGENTS.md "Security First" (no raw SQL, no raw markup); D-318 (spreadsheet formula guard); docs/design/11-datasources.md "Security summary" (parameterised queries). Scripts and queries a channel author writes are code, not data.

## Supply chain (SUP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SEC-SUP-01 | The project shall scan its production dependencies and both shipped images for known vulnerabilities on every change to them and at least every 7 days, and shall not publish a release with a high or critical finding that has a fix, other than one on an exceptions list with a reason and an expiry date not yet passed. | P1 | Test | Proposed |
| SEC-SUP-02 | The project shall publish with each release a software bill of materials for each image and for the product's packages, in which no production dependency in the lock file is missing. | P2 | Test | Proposed |
| SEC-SUP-03 | The project shall publish how to report a vulnerability privately, and shall publish a fix within 7 days for a critical and 30 days for a high vulnerability in the product or a shipped dependency, counted from when a fix exists, naming each one fixed in the release notes. | P2 | Inspection | Proposed |
| SEC-SUP-04 | Before version 1.0 is released, a party outside the project shall test the product's security, and every high or critical finding shall be fixed or accepted in writing by the developer. | P2 | Inspection | Proposed |

- SEC-SUP-01: source: #341 (audit on pushes only; images not scanned); #100 (what went unseen before alerts were on); docs/user/capabilities.md "Published CVE process, SBOM and outside pen test" (No); ROADMAP V5.
- SEC-SUP-02: source: #341; ROADMAP V5; docs/design/18-voice-of-the-user.md LIC6.
- SEC-SUP-03: source: SECURITY.md "Reporting a Vulnerability" and "What to Expect"; #341 (no written rule for dependency fixes). Conflict: SECURITY.md calls its times best effort and not contractual; #341 asks for a written rule. The rule is drafted; the day counts are the drafter's.
- SEC-SUP-04: source: docs/progress/ROADMAP.md "Remaining for v1.0" ("penetration testing not done") and V5; docs/design/18-voice-of-the-user.md SEC12. #341 leaves it to a budget decision.
