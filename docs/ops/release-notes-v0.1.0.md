# Mirthless v0.1.0 Release Notes

The first tagged release of Mirthless, an open-source healthcare integration engine for
Node.js. Treat it as an early release: it has passed a 3-hour, 1-million-message soak test,
but it is single-node, and several security controls are opt-in (see below).

## What's in it

- **Channels:** source, filter, transformer and destinations, with deploy, start, stop,
  pause and dependency-ordered auto-deploy. Destinations run in parallel or in
  Wait-for-Previous chains, with queue-on-failure and retries.
- **Connectors:** TCP/MLLP (HL7v2, optional TLS), HTTP/REST (optional TLS and mutual TLS),
  File, SFTP, Database, JavaScript, Channel, Email (IMAP), SMTP, FHIR, and DICOM (beta).
- **Scripting:** JavaScript/TypeScript filters, transformers and channel scripts in a
  sandbox with timeouts. It includes Mirth-style maps and shortcuts (`$c`, `$co`, `$r`, `$g`,
  `$gc`, `$s`, `$cfg`), code templates, and SSRF-guarded `httpFetch`.
- **Messages:** a message browser with search, reprocessing, export, pruning, and optional
  AES-256-GCM content encryption per channel.
- **Alerts:** on channel errors, or when a started channel receives no messages for N
  minutes. Actions are email and channel.
- **Administration:** four built-in roles; an audit log of logins, PHI access and
  configuration changes; server backup and restore; Prometheus metrics; and a CLI.

## Before you deploy

Read [deployment.md](deployment.md). In particular:

- Set a strong `JWT_SECRET` (production refuses a weak one) and `CONTENT_ENCRYPTION_KEY`.
- Work through the operator checklist in
  [hipaa-security-checklist.md](hipaa-security-checklist.md). TLS for the web UI, the
  database and each connector, and encryption at rest for each channel, are all **off
  until you turn them on**.
- Size for it: the [soak test](soak-test.md) at 100 msg/s used about 950 MB RAM, and the
  database grew about 17 GB a day with full content storage. Turn on pruning.

## Breaking changes from pre-release builds

- `$gc` now reads and writes `globalChannelMap`, as in Mirth Connect. Scripts that used
  `$gc` for configuration values must switch to `$cfg`.
- Deleting a deployed channel now returns 409. Stop and undeploy it first.
- Demo channels and data are only seeded when `SEED_DEMO_DATA=true`.
- Migration 0007 drops message history from installs that predate it. See
  [upgrade.md](upgrade.md).

## Known limitations

- Single node only; there is no clustering or failover.
- DICOM has no TLS.
- Not built yet: attachment extraction, custom metadata columns, multi-threaded destination
  queues, FTP/SMB/S3/WebDAV transports, and batch splitting.
- Security gaps still open: no MFA, no idle timeout, the access token is kept in browser
  storage, and audit writes are best-effort. The full ranked list is in
  [hipaa-security-checklist.md](hipaa-security-checklist.md#known-gaps-highest-risk-first).

## Verification

- CI: build, lint, `pnpm audit`, unit tests with per-package coverage minimums,
  integration tests against Postgres 17, and Playwright end-to-end tests.
- Soak test: 1,080,004 messages over 3 hours at 100 msg/s with none lost, duplicated or
  untransformed ([soak-test.md](soak-test.md)).
