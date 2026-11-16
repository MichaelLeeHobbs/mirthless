# Security Policy

GalvaniFlow routes and transforms healthcare messages. Message content is Protected
Health Information (PHI). We take security reports seriously and ask that you help
us keep patients' data safe by disclosing responsibly.

## Supported Versions

GalvaniFlow is pre-1.0 and experimental. Security fixes are applied to the latest
release line only. Until a `1.x` release exists, treat any version below the most
recent tag as unsupported.

| Version | Supported |
|---------|-----------|
| Latest `0.x` release / `main` | Yes |
| Any older `0.x` | No — upgrade to the latest |

## Reporting a Vulnerability

**Do not open a public GitHub issue for a security vulnerability**, and do not
include PHI, real patient data, or production credentials in any report.

Report privately through one of:

1. **GitHub Security Advisories** (preferred) — open a draft advisory at
   <https://github.com/MichaelLeeHobbs/mirthless/security/advisories/new>. This keeps
   the report private and lets us collaborate on a fix and CVE if warranted.
2. **Email** — `michael.lee.hobbs@gmail.com` with subject line `SECURITY: GalvaniFlow`.
   If you want to send sensitive details encrypted, say so in a first plaintext
   message and we will arrange a key exchange.

Please include:

- A description of the vulnerability and its impact (e.g. auth bypass, PHI exposure,
  RCE via the script sandbox, SQL injection, SSRF).
- Steps to reproduce or a proof of concept (using synthetic data only).
- Affected version / commit, and configuration if relevant.

## What to Expect

This is a solo-maintained open-source project, so timelines are best-effort, not
contractual:

- **Acknowledgement** within 3 business days.
- **Initial assessment** (severity, whether we can reproduce) within 10 business days.
- **Fix or mitigation plan** communicated once triaged; critical issues (PHI exposure,
  auth bypass, remote code execution) are prioritized above all feature work.
- **Coordinated disclosure** — we will agree on a disclosure date with you and credit
  you in the release notes unless you prefer to remain anonymous.

## Scope

In scope: the server API, authentication/RBAC, the message pipeline and script
sandbox, connectors, the web admin UI, and the shipped Docker/nginx configuration.

Out of scope: vulnerabilities in third-party dependencies (report those upstream,
though we appreciate a heads-up), issues requiring a pre-compromised host or
physical access, and social-engineering attacks.

## Security Model Notes

For deployers hardening an installation, see
[`docs/ops/tls-and-phi.md`](docs/ops/tls-and-phi.md) and
[`docs/ops/resource-and-observability.md`](docs/ops/resource-and-observability.md).
Key points:

- Channel scripts are isolated on a best-effort basis. The sandbox blocks accidental and casual access to the host, but it is not a security boundary. Treat anyone who can create or edit a channel, code template or global script as able to run code on the GalvaniFlow server.

  Scripts (filters, transformers, pre/postprocessors, JavaScript connectors, code templates, global scripts) run in `node:vm` inside the server process, not in a separate process. The holders of `channels:write` and `code_templates:write` (the admin, deployer and developer roles) and of `global_scripts:write` (admin) must therefore be treated as able to reach whatever the server process can: its environment (`DATABASE_URL`, `JWT_SECRET`), the database and every channel's PHI. In the Docker stack `DATABASE_URL` is the limited server role, not the superuser: it can read and write the application's rows but cannot alter, empty or drop a table, disable a trigger or delete recent audit events ([Database roles](docs/ops/upgrade.md#database-roles)). Give those roles only to people you would trust with a shell on the server. The design and its known limits are in [`packages/engine/src/sandbox/README.md`](packages/engine/src/sandbox/README.md).

  Sandbox escapes are in scope for reports: report them privately as described above, not in a public issue. We fix them as hardening, but the documented guarantee stays best-effort.
- `/metrics` is authentication-gated by default. `/api-docs` is disabled in production
  by default.
- At-rest message-content encryption (`CONTENT_ENCRYPTION_KEY`) and TLS termination are
  the operator's responsibility to configure — see the ops docs.
