# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mirthless** — A modern, open-source healthcare integration engine built from scratch in Node.js/TypeScript. Spiritual successor to NextGen Connect (Mirth Connect), redesigned natively for the Node.js ecosystem.

> The project name "mirthless" is a working title. Centralized in package.json `name` field.

Mirthless is a message routing and transformation engine for healthcare systems. Core concepts:

- **Channels** — message processing pipelines with a source connector (inbound) and destination connectors (outbound)
- **Connectors** — protocol adapters: TCP/MLLP (HL7), HTTP/REST, File, Database, DICOM, FHIR, SMTP, JavaScript
- **Transformers** — JavaScript/TypeScript steps that convert messages between formats (HL7v2, XML, JSON, FHIR, DICOM, delimited)
- **Filters** — JavaScript conditions controlling message flow through the pipeline
- **Code Templates** — reusable JavaScript functions shared across channels
- **Alerts** — configurable notifications triggered by channel events/errors

---

## CRITICAL PRINCIPLES

### This Is Healthcare Software

Every line of code you write may be part of a system that routes patient lab results, medication orders, or emergency alerts. Bugs don't just cause 500 errors — they can delay treatment. Keep this in mind always.

- **Data integrity is non-negotiable.** Messages must never be silently lost, duplicated, or corrupted.
- **HIPAA compliance matters.** PHI (Protected Health Information) access must be auditable. Message content is PHI.
- **Fail safe, not silent.** If something goes wrong, surface it loudly (error status, alerts, logs). Never swallow errors.
- **Defensive at boundaries.** Validate all external input (API requests, connector data, user scripts) with Zod. Trust nothing from outside.

### YAGNI (You Aren't Gonna Need It)

Do NOT build features, abstractions, or flexibility that aren't explicitly required by the current task.

- No "just in case" parameters, config options, or extension points
- No premature abstractions — three similar lines are better than a clever helper used once
- No speculative generalization — design for today's requirements, not hypothetical futures
- If you find yourself saying "this might be useful later" — stop and don't build it

### KISS (Keep It Simple, Stupid)

The simplest solution that works correctly is the best solution.

- Prefer boring, obvious code over clever code
- Minimize indirection — a reader should understand the flow without jumping through 5 files
- One clear way to do things, not multiple overlapping approaches
- If a solution needs a paragraph to explain why it's better, it's probably not

### Security First

- **No raw SQL** — Always parameterized queries via Drizzle ORM
- **No `eval()`, `new Function()`** — User code runs in isolated-vm sandbox only
- **No credential logging** — Never log passwords, tokens, API keys, or PHI in plain text
- **Input validation at every boundary** — API endpoints, WebSocket messages, file uploads, user scripts
- **XSS prevention** — React handles this by default; never use `dangerouslySetInnerHTML`
- **CSRF protection** — JWT in Authorization header, not cookies
- **Rate limiting** — On auth endpoints and any public-facing routes
- **Principle of least privilege** — RBAC enforced at the API layer, not just the UI

---

## Testing Requirements

Tests are mandatory, not optional. This is healthcare software.

### Rules

1. **Every new function/module gets tests.** No exceptions. Write tests alongside implementation, not as an afterthought.
2. **Test behavior, not implementation.** Tests should survive refactoring. Test what a function does, not how it does it.
3. **Target 95%+ branch coverage.** This is the floor, not the ceiling.
4. **Test the unhappy path.** Error cases, edge cases, invalid inputs, timeouts, and failures matter more than the happy path.
5. **No mocking of things you own.** If you need to mock your own service, the design is wrong. Mock external boundaries (DB, network, filesystem).
6. **Tests must be fast.** Unit tests should run in <100ms each. Use in-memory or faked dependencies.
7. **Test names describe behavior.** `it('returns error when channel ID is invalid')` not `it('test1')`.

### Test Structure

```bash
pnpm test                             # Run all tests
pnpm test:coverage                    # Run with coverage report
pnpm vitest run src/path/to/file.test.ts  # Single test file
pnpm --filter @mirthless/engine test  # Test a specific package
```

### What To Test

- **Services:** All Result<T> return paths (success and every error variant)
- **Validators:** Zod schemas with valid, invalid, and edge-case inputs
- **Pipeline:** Message flow through filter → transform → route with various statuses
- **Sandbox:** Script execution, timeout enforcement, map isolation
- **Connectors:** Protocol-specific behavior (frame parsing, connection lifecycle, retry)
- **API routes:** Auth enforcement, RBAC, input validation, response format

---

## Target Stack

- **Runtime:** Node.js (latest LTS)
- **Language:** TypeScript (strict mode)
- **Backend:** Express
- **Database:** PostgreSQL only (deliberate design choice — no multi-DB support)
- **ORM:** Drizzle ORM
- **Frontend:** React 18+ with Vite
- **UI Library:** Material UI 6
- **State:** TanStack Query + Zustand
- **Validation:** Zod
- **Testing:** Vitest
- **Logging:** Pino (pino + pino-http)
- **Errors:** standardize-error (npm: `stderr-lib`) + Result<T> pattern
- **Code Editor:** Monaco Editor (@monaco-editor/react)
- **Monorepo:** pnpm workspaces

## Development Commands

```bash
pnpm install                          # Install all dependencies
pnpm dev                              # Run all packages in dev mode
pnpm dev:server                       # Run only server
pnpm dev:web                          # Run only web UI
pnpm build                            # Build all packages
pnpm lint                             # ESLint across all packages (--max-warnings 0)
pnpm lint:fix                         # ESLint with auto-fix
pnpm test                             # Run all tests
pnpm test:coverage                    # Run with coverage

# Single package
pnpm --filter @mirthless/server dev
pnpm --filter @mirthless/engine test

# Single test file
pnpm vitest run src/path/to/file.test.ts

# Database (Drizzle)
pnpm db:generate                      # Generate migration from schema changes
pnpm db:migrate                       # Apply migrations
pnpm db:studio                        # Open Drizzle Studio GUI
pnpm db:seed                          # Seed database

# Docker
pnpm docker:up                        # Start Postgres + services
pnpm docker:down                      # Stop containers
pnpm docker:reset                     # Reset volumes and restart
```

---

## Coding Standards

Follow **mission-critical-ts** standards strictly. Full standards are in `docs/standards/`:

- [`docs/standards/CodingStandard.md`](docs/standards/CodingStandard.md) — TypeScript rules for mission-critical systems
- [`docs/standards/LoggingStandard.md`](docs/standards/LoggingStandard.md) — Structured logging, correlation, audit trails
- [`docs/standards/ReferenceConfigs.md`](docs/standards/ReferenceConfigs.md) — tsconfig, ESLint, utility type reference

Key rules:

- No `any` (use `unknown` + type guards)
- No enums (use const objects + `as const`)
- No `var` (use `const` by default, `let` only when needed)
- No recursion (rewrite as iterative with explicit stacks)
- No `throw` for control flow — Result<T> pattern mandatory for all services
- All async operations need timeouts (30s default, AbortController)
- All promises explicitly handled (no floating promises)
- Input validation at all boundaries (Zod)
- Branded types for domain primitives (`ChannelId`, `ConnectorId`, `MessageId`, `UserId`)
- Functions ≤40 lines, ≤4 parameters, single responsibility
- Immutability by default (`readonly`, `ReadonlyArray<T>`, `ReadonlyMap<K,V>`)
- Exhaustive switch with `default: assertUnreachable(x)`
- Explicit function return types
- Cyclomatic complexity ≤10
- TSDoc on all public APIs
- Full source: `C:\Users\mhobb\WebstormProjects\mission-critical-ts`

---

## Architecture Patterns

### Backend: 4-Layer Architecture

```
Router → Controller → Service → Database (Drizzle)
```

- **Router** — Route definitions, validation middleware (Zod), auth guards
- **Controller** — Request/response handling, calls services, maps to HTTP status
- **Service** — Business logic, returns `Result<T>` (never throws), database queries
- **Database** — Drizzle ORM schema and queries

### Frontend: Component → Hook → API → Backend

```
React Component → Custom Hook (TanStack Query) → API Client (fetch) → Express API
```

### API Response Format

```typescript
// Success
{ success: true, data: T }
// Error
{ success: false, error: { code: string, message: string, details?: unknown } }
```

### Result<T> (via stderr-lib)

```typescript
import { tryCatch, type Result } from 'stderr-lib';

const result: Result<User> = await tryCatch(db.query.users.findFirst({ where: eq(users.id, id) }));
if (!result.ok) { return result; }
return { ok: true, value: result.value };

// All service functions return Result<T> — never throw
async function getChannel(id: ChannelId): Promise<Result<Channel>> { ... }
```

### Branded Types

```typescript
type ChannelId = BrandedString<'ChannelId'>;
type ConnectorId = BrandedString<'ConnectorId'>;

// Factory functions return Result<BrandedType>
const createChannelId = makeStringFactory<'ChannelId'>('ChannelId', (v) => uuidRegex.test(v));
```

### Const Objects (instead of enums)

```typescript
const CHANNEL_STATE = {
  UNDEPLOYED: 'UNDEPLOYED',
  STARTED: 'STARTED',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
} as const;
type ChannelState = typeof CHANNEL_STATE[keyof typeof CHANNEL_STATE];
```

---

## TypeScript Configuration

All packages extend the base tsconfig with these strict settings:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

## Module Structure

```
mirthless/
├── packages/
│   ├── core-models/     — Shared TS types, Zod schemas, branded types
│   ├── core-util/       — Shared utilities (HL7 parsing, serialization, date helpers)
│   ├── engine/          — Message processing: channel runtime, routing, queuing, sandbox
│   ├── connectors/      — Protocol adapters (tcp-mllp, http, file, database, dicom, fhir, smtp, js)
│   ├── server/          — Express API, auth, channel deployment, config management
│   ├── web/             — React + MUI admin: channel editor, message browser, dashboard
│   └── cli/             — CLI for server management
├── docker/              — Docker Compose (Postgres, server, web)
├── docs/design/         — Design documents (00-08)
├── docs/standards/      — Coding, logging, and config standards
├── scripts/             — DB init, benchmarks, migration utilities
├── reference/           — Mirth Connect source + code samples (git-ignored)
└── pnpm-workspace.yaml
```

## Related Projects

| Project | Location | Use For |
|---|---|---|
| **fullstack-template** | `C:\Users\mhobb\WebstormProjects\fullstack-template` | Base monorepo structure, Express patterns, React+MUI, auth, Drizzle |
| **mission-critical-ts** | `C:\Users\mhobb\WebstormProjects\mission-critical-ts` | Coding standards (apply strictly) |
| **standardize-error** | `C:\Users\mhobb\WebstormProjects\_published\standardize-error` | Error normalization (npm: `stderr-lib`) |
| **dcmtk.js** | `C:\Users\mhobb\WebstormProjects\dcmtk.js` | DICOM connector foundation |

## Reference Source

The original NextGen Connect source is at `reference/connect/` for architecture study. This is a spiritual remake — we keep the core concepts but redesign everything for Node.js. Do not replicate Connect's Java patterns, XML config formats, or API quirks.

## Diagrams

When creating diagrams, use **Mermaid** format with dark-mode-friendly colors.

## GitHub

- CLI: `"/c/Program Files/GitHub CLI/gh.exe"`
- Account: MichaelLeeHobbs
