# 08 — Paid Plugin Analysis

> Breakdown of NextGen Connect's commercial plugins and how Mirthless handles each.

## Context

NextGen Connect (Mirth Connect) sells extensions in bundled license tiers:

| Tier | Price | Key Extensions |
|---|---|---|
| **Enterprise** | Entry-level | SSL Manager, Channel History, Message Generator, Command Center access |
| **Gold** | Mid-tier | Everything in Enterprise + RBAC, MFA, FHIR, Advanced Alerting, Enhancement Bundle, Interop Suite, Cures Extension, Serial, ASTM |
| **Platinum** | Top-tier | Everything in Gold + Advanced Clustering |

As of v4.6 (2025), Connect transitioned from open-source to fully commercial/proprietary. Community frustration around paywalled features is significant — this is our competitive opportunity.

---

## Security & Access

### SSL Manager (Certificate Management)

**What Connect charges for:** GUI for managing TLS certificates — create, import, export, track expiry, apply to connectors. Without it, users manage Java keystores via command-line `keytool`.

**Mirthless: Built-in (P1).** Per-connector TLS config is already in our design. We add a certificate management page in the web admin (upload certs, track expiry, test connections). Expiry warnings integrate with our alerting system. TLS is mandatory in healthcare — paywalling it is indefensible.

### RBAC (Role-Based Access Control)

**What Connect charges for:** Granular role-based permissions. Open-source Connect has no authorization — every user is admin. Supports LDAP integration.

**Mirthless: Built-in (P1).** Already designed in `05-server-api.md` with 4 default roles (admin, deployer, developer, viewer) and channel-scoped permissions. LDAP/AD integration via pluggable auth providers. This is the #1 community complaint about Connect.

### Multi-Factor Authentication

**What Connect charges for:** TOTP or Duo second factor. Has significant limitations — doesn't work with web dashboard or REST API basic auth.

**Mirthless: Built-in (P1).** TOTP via `otpauth` library. No limitations since our auth is JWT-based from the start — MFA is part of the login flow, tokens work everywhere after that.

### Cures Extension

**What Connect charges for:** ONC certification compliance bundle (RBAC + MFA + SSL + FHIR packaged for regulatory checkbox). US-specific.

**Mirthless: Not a plugin — documentation.** Since RBAC, MFA, TLS, and FHIR are all built-in, Cures compliance is a documentation/certification effort. We publish a compliance matrix against ONC 2015 Edition Cures Update criteria.

---

## Administration & Development

### Channel History (Version Control)

**What Connect charges for:** Revision snapshots on channel changes, diff comparison, rollback. Without it, changes are destructive — previous version is gone.

**Mirthless: Built-in (P1).** Revision tracking with full config stored per revision. Monaco diff editor for side-by-side comparison (`06-web-admin.md` decision #5). Better than Connect's XML blob diffs — we show structured diffs of normalized data.

### Message Generator

**What Connect charges for:** Generate realistic HL7v2 test messages with pseudo-data from spec code tables. HL7 v2.1–2.6, configurable segments.

**Mirthless: Built-in tool (P2).** Web admin page for generating test messages. Since the HL7 parser is bundled in the sandbox, we can produce messages matching any HL7 v2 type with realistic random data. Extends naturally to other data types (FHIR, JSON) later.

### Enhancement Bundle (Cross-Channel Message Search)

**What Connect charges for:** Search messages across multiple channels in one unified view. Connect charges for this because their per-channel table architecture makes cross-channel queries genuinely hard.

**Mirthless: Built-in (P1) — free from our data model.** Single partitioned message table means cross-channel queries are just a `WHERE` clause change. Our architecture gives us this for free. No plugin needed.

---

## Monitoring & Performance

### Advanced Alerting

**What Connect charges for:** Threshold alerts, channel state alerts, escalation chains, on-call schedules, notification throttling. Open-source only has "error → email."

**Mirthless: Built-in with phased rollout.**
- **P1:** Error alerts + threshold alerts (message count above/below threshold within time window)
- **P2:** Channel state alerts (channel stopped for X minutes), escalation chains, on-call scheduling, throttling

Connect's "basic" alerting is so limited that "advanced" is really just "competent."

### Advanced Clustering

**What Connect charges for:** HA with automatic failover, message takeover, heartbeat monitoring, unified cluster management. Platinum-only (most expensive tier).

**Mirthless: Built-in (P3).** We already design for horizontal scaling (server_id columns, per-server statistics). Actual clustering implementation (heartbeat, leader election via Postgres advisory locks, message takeover) is built when scale demands it.

---

## Connectors & Protocols

### Interop Suite (IHE Profiles)

**What Connect charges for:** Pre-built IHE connectors for HIE participation — PIX (patient identity), PDQ (demographics query), XDS.b (document sharing), XCA (cross-community access), XCPD (patient discovery). Includes SAML/WS-Security for eHealth Exchange compliance.

**Mirthless: Plugin (P3/P4).** `@mirthless/connector-ihe`. Specialized use case for large health systems. SOAP/WS-Security complexity is significant. Good test of our plugin API.

### Serial Connector

**What Connect charges for:** RS-232 serial port communication with legacy lab instruments and medical devices.

**Mirthless: Plugin (P4).** `@mirthless/connector-serial`. Hardware-dependent, irrelevant in Docker/cloud. Most lab instruments moving to TCP. Low priority but validates the plugin system.

### ASTM E1394 (Data Type)

**What Connect charges for:** Parse/serialize ASTM E1394 messages from clinical lab analyzers (chemistry, hematology, blood gas).

**Mirthless: Plugin (P3).** `@mirthless/datatype-astm`. Validates that data types are pluggable in our plugin API.

### ASTM E1381 (Transmission Mode)

**What Connect charges for:** ASTM E1381 framing protocol (ENQ/ACK/NAK handshaking, checksums) over TCP or serial. Paired with E1394.

**Mirthless: Plugin (P3).** `@mirthless/transmission-astm-e1381`. Validates that transmission modes are pluggable.

### Secure Email (POP3/IMAP Receiver)

**What Connect charges for:** POP3/IMAP source connector for receiving emails. Open-source only has SMTP sending.

**Mirthless: Built-in connector (P2).** `@mirthless/connector-email`. Uses `nodemailer` for sending, `imapflow` for receiving. Common in healthcare workflows (lab results, referrals, reports).

---

## Summary

| Feature | Connect | Mirthless | Phase |
|---|---|---|---|
| TLS/Certificate Management | Paid (SSL Manager) | **Built-in** | P1 |
| RBAC | Paid | **Built-in** | P1 |
| MFA | Paid | **Built-in** | P1 |
| Channel History + Diff | Paid | **Built-in** | P1 |
| Cross-Channel Message Search | Paid (Enhancement Bundle) | **Built-in** (free from data model) | P1 |
| Alerting (threshold + escalation) | Paid (Advanced Alerting) | **Built-in** | P1/P2 |
| Message Generator | Paid | **Built-in tool** | P2 |
| Email Connector (receive) | Paid (Secure Email) | **Built-in connector** | P2 |
| Cures Compliance | Paid bundle | **Documentation** | P2 |
| Clustering | Paid (Platinum only) | **Built-in** | P3 |
| ASTM E1394/E1381 | Paid | **Plugin** | P3 |
| IHE Profiles | Paid (Interop Suite) | **Plugin** | P3/P4 |
| Serial Connector | Paid | **Plugin** | P4 |

**Competitive positioning:** Everything Connect charges for in their Gold tier ships as built-in open-source in Mirthless. The community frustration around paywalled essential features (RBAC, MFA, channel history, cross-channel search) is our biggest opportunity.
