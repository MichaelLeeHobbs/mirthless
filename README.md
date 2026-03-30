# Mirthless

> A modern, open-source healthcare integration engine. Think Mirth Connect, but built from scratch for Node.js — no Java, no desktop client, no paywall tiers.

**Status: Experimental** — This is a working prototype by a developer with ADD. It might become something great, or it might end up as a really well-architected pile of good intentions. Either way, the code is here and it's free.

## Why?

Mirth Connect (NextGen Connect) is the de facto standard for healthcare integration. It's also:

- **Java** — heavyweight, slow startup, JVM tuning required
- **Swing desktop client** — it's 2026, why do I need a desktop app?
- **Paywalled** — RBAC, MFA, channel history, cross-channel search? That'll be $$$ for the Gold tier
- **Closed direction** — increasingly proprietary with each release

Mirthless keeps what works (channels, transformers, filters, the pipeline model) and rebuilds everything else for the modern era.

## What's Different

- **TypeScript/Node.js** — not Java. Fast startup, npm ecosystem, familiar to web developers
- **Web-based admin** — React + Material UI. No client install. Works on any device with a browser
- **Everything is free** — RBAC, MFA, channel history, cross-channel search, alerting — all built-in, no tiers
- **TypeScript in transformers** — write channel scripts in TypeScript with full Monaco editor + autocomplete
- **13ms message processing** — batched CTE queries on native Postgres. Mirth does ~70ms for comparable workloads
- **Real-time dashboard** — WebSocket-driven updates, not polling

## Quick Start

```bash
# Prerequisites: Node.js 22+, PostgreSQL 18, pnpm 9+

# Clone and install
git clone https://github.com/MichaelLeeHobbs/mirthless.git
cd mirthless
pnpm install

# Set up database
cp .env.example .env        # edit DATABASE_URL if needed
pnpm db:init                # creates user + database
pnpm db:migrate             # applies schema
pnpm db:seed                # seeds admin user + 10 example channels

# Run
pnpm dev                    # starts server (:3000) + web UI (:5173)

# Login: admin / Admin123!
```

## Architecture

```
packages/
├── core-models/     — TypeScript types, Zod schemas, branded types
├── core-util/       — HL7v2 parser, utilities
├── engine/          — Message pipeline, sandbox, channel runtime
├── connectors/      — TCP/MLLP, HTTP, File, Database, JS, SMTP, FHIR, DICOM, Email
├── server/          — Express API (131 endpoints), auth, deployment
├── web/             — React + MUI admin UI
└── cli/             — Command-line interface
```

**Stack:** Node.js, TypeScript (strict), Express, PostgreSQL, Drizzle ORM, React 18, Material UI 6, Vite, Vitest, pnpm workspaces

## Current State

This is a working system with ~1,640 automated tests. You can create channels, write transformers in TypeScript, deploy them, send messages, and watch them flow through the pipeline. The 10 seeded example channels demonstrate HL7v2, JSON, XML, channel-to-channel routing, filtering, error handling, and more.

What works: channels, pipeline, sandbox, 10 connector types, RBAC, audit logging, message browser, code templates, alerts, groups, tags, dark mode, CLI.

What's next: visual flow builder (think Node-RED for healthcare), plugin system, clustering. See [ROADMAP](docs/progress/ROADMAP.md).

## License

MIT

---

*Built with an mass amounts of coffee, mass amounts of ADHD, and mass amounts of AI. Healthcare data deserves better tools.*
