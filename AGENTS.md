# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex and others) working in this repository. `CLAUDE.md` imports this file, so edit this one.

## Project Overview

**GalvaniFlow** — A modern, open-source healthcare integration engine built from scratch in Node.js/TypeScript. Spiritual successor to NextGen Connect (Mirth Connect), redesigned natively for the Node.js ecosystem.

> The project is named GalvaniFlow (formerly Mirthless). The name is centralized in the package.json `name` field.

GalvaniFlow is a message routing and transformation engine for healthcare systems. Core concepts:

- **Channels** — message processing pipelines with a source connector (inbound) and destination connectors (outbound)
- **Connectors** — protocol adapters: TCP/MLLP (HL7), HTTP/REST, File, SFTP, Database, DICOM, FHIR, SMTP, Email, JavaScript, Kafka, AMQP (RabbitMQ)
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
- No premature abstractions: don't build a helper for one caller. Before writing a helper, search `lib/` and `packages/core-util` for one that already does the job. A second copy of an existing helper is a defect. The helpers below each had copies before. Lint (`eslint.config.js`, `SHARED_HELPERS`) fails a non-exported function, or a const holding a function, named like one of them. `formatTimestamp` is the exception, because core-util's HL7 formatter uses the name for another format.
  - `mapErrorToStatus` and `errorResponse` in `server/src/lib/controller-helpers.ts`: ServiceError code to HTTP status (500 otherwise), and the `{ code, message }` body (`INTERNAL` otherwise). A controller with a different status for one code wraps `mapErrorToStatus`, as `user.controller.ts` does.
  - `escapeCsvField` in `server/src/lib/csv.ts`.
  - `isBlockedHostname`/`isBlockedAddress` (script `httpFetch`) and `isReservedHostname`/`isReservedAddress` (Test Connection) in `engine/src/sandbox/ssrf.ts`: both SSRF policies, built from one set of ranges.
  - `isPlainObject` and `errorInfo` in `core-util`. `errorInfo` builds the `{ errMsg, name, stack }` log record for any thrown value.
  - `formatBytes` in `web/src/lib/system-health.ts`, `formatTimestamp` in `web/src/lib/format.ts` (the caller passes the label for a missing time), and the certificate `expiry*` helpers in `web/src/lib/certificate-expiry.ts`.
  - `getStr`, `getNum`, `getBool`, `getTls*` and `propertyUpdaters` in `web/src/components/channels/common/connector-properties.ts` for connector forms.
  - `compileScript` and `compileErrorMessages` in `engine/src/sandbox/script-compiler.ts`: compile a user script the way deploy does, and turn its errors into `Line N: <text>` on the script's own lines. Script validation uses both.
  - `wrapScriptBody` and `scriptBodyPosition` in `core-models/src/scripting/script-check.ts`: a script as the body of the function the engine runs it in, and a position in that wrapped text back on the script's own lines. The compiler, the deploy type check and the editor's type check use both (D-297).
  - `toPoolConfig` in `connectors/src/database/connection-pool.ts`: a database connector's pool config from its connection fields.
  - `QuarantineLedger` and `dispatchQuarantined` in `connectors/src/quarantine-ledger.ts`: the quarantine set, its sidecar ledger and the dispatch-then-quarantine step, for any polling file source. The source supplies only the storage.
  - `connectFresh` and `closeQuietly` in `connectors/src/client-lifecycle.ts`: connect a polling receiver's remote client, or close it, under a timeout.
  - `createNodemailerTransport` in `connectors/src/smtp/smtp-dispatcher.ts` (exported from `@galvaniflow/connectors`): builds a nodemailer transport for the SMTP connector and the server's own mail. SMTP Test Connection (`connection-test.service.ts`) still builds its own; see #92.
  - `unescapeControlChars` (typed `\n`, `\r`, `\t`, `\\` to the characters) and `isSecretSetting` (which settings hold secrets) in `core-util`. The web depends on core-util.
  - `fillPlaceholders`, `recordLookup` and `placeholderNames` in `core-util/src/placeholders.ts`: every `${name}` template (D-275). A template with built-in names looks those up first and passes the rest to it.
  - `formatTimestampWith` in `web/src/lib/format.ts`: the missing/unparseable rule for any time on screen, with the screen's own view of a valid time (D-278).
  - `num` in `connectors/src/registry.ts` and `getNum` read only finite numbers (D-276); `readTlsServerOptions`/`readTlsClientOptions` in `connectors/src/tls.ts` refuse a non-object `tls` (D-277).
  - `containsPattern` in `server/src/lib/like.ts` (a LIKE pattern from user text), `emitSuccessEvent` in `server/src/lib/event-emitter.ts` (an INFO/SUCCESS audit event), and `buildEventWhereConditions` in `server/src/services/event.service.ts` (the event list and export filters).
  - `errorMessage` in `web/src/lib/error-message.ts` (text for an unknown thrown value, with the caller's fallback), `definedSearchParams` in `web/src/lib/search-params.ts` (query params without the unset ones), `messageFilterParts` in `web/src/lib/message-filter-query.ts` (the message search and export filters), and `updateTls` on `propertyUpdaters` for a connector form's TLS fields.
  - `parseHeaderLines` in `core-models/src/schemas/http-connector.schema.ts`: header text (`Name: value` per line) to a map, for the HTTP schema and the web headers editor. `optionalTlsSchema`, `withoutKeys` and `charsetSchema` in `core-models/src/schemas/connector-property-fields.ts`: a connector schema's optional `tls` object, its dropped legacy keys, and a payload charset with the old names (`UTF-8`, `ISO-8859-1`) mapped; the editor's list of those charsets is `CHARSET_OPTIONS` in `web/src/components/channels/common/charset-options.ts`.
  - `GlobalChannelMap` in `engine/src/runtime/global-channel-map.ts` is the in-memory script map; `GlobalMapProxy` keeps its entries in one rather than its own `Map`.
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
- **No `eval()`, `new Function()`** — User code runs only in the engine sandbox (hardened `node:vm`, see `packages/engine/src/sandbox/README.md`)
- **No credential logging** — Never log passwords, tokens, API keys, or PHI in plain text
- **Input validation at every boundary** — API endpoints, WebSocket messages, file uploads, user scripts
- **XSS prevention** — React handles this by default; never use `dangerouslySetInnerHTML`
- **CSRF protection** — JWT in Authorization header, not cookies
- **Rate limiting** — On auth endpoints and any public-facing routes
- **Principle of least privilege** — RBAC enforced at the API layer, not just the UI

---

## Working Agreement

Michael tests this project by hand, and it is too big for that. Every change you make should reduce what he has to click through, not add to it.

1. **Prove it, don't claim it.** "Done" means you ran the checks in the verification matrix below for what you touched and they passed. Say which commands you ran. A passing typecheck is not a test.
2. **Finish with a verdict.** End a task with the `verify-and-finish` skill: **DONE** (verified), **NEEDS YOU** (verified except for a named step only a person can do) or **NOT DONE** (what failed and why). Never leave the user to discover that something wasn't checked.
3. **A bug gets a failing test first.** Reproduce it in a test, watch it fail, then fix it. The test stays.
4. **A new flow gets an automated check.** UI: a `pnpm shots` page and, for a multi-step flow, a Playwright spec in `e2e/`. Server: a route test, plus an integration test when it touches SQL.
5. **Small, reviewable steps.** One concern per commit. Don't mix refactors with behaviour changes.
6. **Ask before anything you can't undo**: production data, force pushes, deleting branches, publishing.
7. **Keep the docs true.** If you change a command, a rule or a decision, update this file, `docs/progress/` and any doc that names it in the same change. User pages that restate code are checked by docs guards in `packages/server/src/__tests__/docs/`, which run in `pnpm gate`: `docs/user/connector-reference.md` must list every connector type with the right directions and section headings, and `docs/user/access-control.md` must carry the role matrix exactly as the role seed grants it. `role-access.test.ts` checks over HTTP that each PHI or destructive endpoint answers each role as that matrix says. `docs/user/capabilities.md` is the one place a capability's status lives (D-279): when you ship, change or decide against a capability, update its row, and when you add a ROADMAP item, add or cite a row, because its guard fails on an open ROADMAP item no row cites, a Yes with no gate or CI test, and a No with no plan. When a guard fails, fix the page, not the guard.
8. **Security defects go to an advisory, not an issue.** A defect where the code protects less than the docs or config promise, and an outsider or a lower role can use it (a route serving PHI without its permission check, a sandbox escape, a TLS or host-key check that fails open, a revoked session that still works), goes to a draft GitHub security advisory as `SECURITY.md` says. The agent drafts it and tells Michael, and the fix lands from the advisory's private fork. Design limits and defaults ("no MFA", "no per-channel scope") are documented and filed publicly. A finding that is already public stays public, and the docs carry its mitigation until the fix ships.

## Verification Matrix

Run what matches the files you touched. `pnpm gate` runs build, lint and every package's tests with coverage minimums. On a pull request, CI runs the same steps but only the jobs and package tests the diff needs: a docs-only change runs just the tests that read the changed docs. A push to `main` runs everything. [`docs/ops/ci.md`](docs/ops/ci.md) lists what runs when; `node scripts/ci/classify-changes.mjs origin/main` shows it for your branch. A pull request is green when the `ci-ok` check passes; branch protection on `main` requires it.

| You changed | Run | Also |
|---|---|---|
| Anything | `pnpm gate` | |
| `packages/web` UI | `pnpm shots --only <pages>` with `pnpm dev:web` running | Look at the light, dark and phone images (`create-ui` skill) |
| A multi-step UI flow | `pnpm test:e2e` (needs Postgres, migrated and seeded) | Add or extend a spec in `e2e/`. Spec files run in parallel against one database, so a spec uses rows with names of its own and puts back any server-wide setting it changes (D-289). A step waits on a condition (`await expect(...)`), never a fixed sleep or an `if (await x.isVisible())` guard; lint fails both (D-293) |
| `packages/server/src/db/schema` | `pnpm db:generate`, commit the migration | `pnpm test:integration` against Postgres |
| SQL, queues, pruning, partitions | `pnpm test:integration` | |
| Engine pipeline or a connector | The package's tests (`pnpm --filter @galvaniflow/engine test`) | A real-message E2E suite in `packages/connectors/src/__tests__/e2e/` for protocol changes. For a connector, `pnpm --filter @galvaniflow/connectors test:integration` with the compose `test` profile up (CI job `connector-integration` runs it, D-273) |
| A connector's type, direction or properties | `pnpm --filter @galvaniflow/server test` (the docs guards) | Update `docs/user/connector-reference.md`; for a new connector, work through "Adding a connector" below |
| A role, a permission, or the permission a route checks | `pnpm --filter @galvaniflow/server test` (the access guard and `role-access.test.ts`) | Update `docs/user/access-control.md`; add a PHI or destructive endpoint to `ENDPOINTS` in `role-access.test.ts` |
| Throughput or memory | `pnpm soak` (see `docs/ops/soak-test.md`) | Compare with the recorded baseline |
| The Mirth importer, or behaviour a migrated channel relies on | `pnpm test:scenarios` (needs Postgres and the test containers, see `docs/testing/migration-scenarios.md`) | Compare the score with the last recorded one; nothing that passed may fail |
| `.github/workflows/ci.yml` or `scripts/ci/` | `pnpm test:ci` | Update `docs/ops/ci.md` when what runs changes |
| Docs only | Check the commands and paths you mention exist | |

If a check can't run in your environment (no Postgres, no browser), say so in your verdict. Don't mark it passed.

---

## Testing Requirements

Tests are mandatory, not optional. This is healthcare software.

### Rules

1. **Every new function/module gets tests.** No exceptions. Write tests alongside implementation, not as an afterthought.
2. **Test behavior, not implementation.** Tests should survive refactoring. Test what a function does, not how it does it.
3. **Aim for 95% branch coverage in code you write or change.** The gate enforces lower, per-package minimums (below), because several packages are well short of the target. Those minimums only move up.
4. **Test the unhappy path.** Error cases, edge cases, invalid inputs, timeouts, and failures matter more than the happy path.
5. **No mocking of things you own.** If you need to mock your own service, the design is wrong. Mock external boundaries (DB, network, filesystem).
6. **Tests must be fast.** Unit tests should run in <100ms each. Use in-memory or faked dependencies.
7. **Test names describe behavior.** `it('returns error when channel ID is invalid')` not `it('test1')`.

### Coverage Minimums

`pnpm gate` fails a package whose coverage drops below these. Each sits one point under what that package measured when its numbers were last raised. When your change raises a package's coverage, raise its numbers in `packages/<name>/vitest.config.ts` and here. Never lower one to get green: add the missing tests.

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| engine | 93 | 89 | 96 | 96 |
| core-util | 93 | 83 | 92 | 96 |
| connectors | 89 | 78 | 85 | 91 |
| server | 57 | 58 | 71 | 57 |
| core-models | 40 | 49 | 54 | 39 |
| web | 26 | 29 | 23 | 26 |

The server number is low because the controllers, `engine.ts` and several services have few unit tests (the Postgres integration and Playwright suites exercise some of that code but are not counted here). The web number is low because most pages have no component tests. Raising both is on `docs/progress/ROADMAP.md`.

### Test Structure

```bash
pnpm test                             # Run all tests
pnpm test:coverage                    # Run with coverage report
pnpm vitest run src/path/to/file.test.ts  # Single test file
pnpm --filter @galvaniflow/engine test  # Test a specific package
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
pnpm lint                             # ESLint across all packages and e2e/ (--max-warnings 0)
pnpm lint:fix                         # ESLint with auto-fix
pnpm gate                             # build + lint + tests with coverage (what CI runs)
pnpm test                             # Run all tests
pnpm test:coverage                    # Run with coverage
pnpm shots                            # Screenshot web pages against a fake API (needs pnpm dev:web)
pnpm test:scenarios                   # Mirth migration scenario suite and score (needs SCENARIO_DATABASE_URL)

# Single package
pnpm --filter @galvaniflow/server dev
pnpm --filter @galvaniflow/engine test

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
- The copies in `docs/standards/` are what applies here. Their upstream is the mission-critical-ts project (see Related Projects).

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

### Adding a connector

Start with the type lists in `packages/core-models/src/constants.ts` (`SOURCE_CONNECTOR_TYPES`, `DESTINATION_CONNECTOR_TYPES`). From there the compiler or a test names most of what is missing: the registry factory (`registry-types.test.ts`), the docs page (the docs guard), the destination dropdown label and the dashboard label (typed by connector type). These places are keyed by a plain string, so nothing tells you when one is missing:

- Deploy validation schemas (`SOURCE_SCHEMAS`, `DEST_SCHEMAS`) in `packages/server/src/services/connector-validation.service.ts`. A type with no schema in a direction fails every deploy with `Unknown source connector type` or `Unknown destination connector type`, so add one for each direction the connector has.
- Test Connection testers (`TESTERS`) in `packages/server/src/services/connection-test.service.ts`. Without one, Test Connection fails with `Unknown connector type`.
- Certificate-ID resolvers in `packages/server/src/engine.ts` (`SOURCE_TLS_RESOLVERS`, `DESTINATION_TLS_RESOLVERS`), if the connector takes certificates from the store.
- Editor forms and defaults: `SOURCE_CONNECTOR_FORMS` in `packages/web/src/components/channels/source/ConnectorSettingsSection.tsx`, `DEST_CONNECTOR_FORMS` in `destinations/DestinationConnectorSettings.tsx`, and the defaults maps in both `connector-defaults.ts` files.
- The Mirth importer in `packages/server/src/services/mirth-import.service.ts`, if Mirth has an equivalent: the class map (`CONNECTOR_TYPE_MAP`), the `transportMap` in `mapTransportName`, and a case in the `extractConnectorProperties` switch. A connector missing from the maps imports as JAVASCRIPT with a warning. One with no case in the switch keeps Mirth's own property names, which the connector does not read, so its settings are lost on import.
- The property tables in `docs/user/connector-reference.md`. Their keys are checked only for connectors whose properties have a core-models schema, by `packages/core-models/src/schemas/__tests__/connector-reference-docs.test.ts` (TCP_MLLP, HTTP, DATABASE and FILE today); add the connector there when its schema lands ([#115](https://github.com/MichaelLeeHobbs/mirthless/issues/115)).

---

## Agent Tooling

Lives in `.claude/` and is checked in, so every agent and teammate gets the same setup.

| What | Where | Does |
|---|---|---|
| `verify-and-finish` skill | `.claude/skills/verify-and-finish/` | Runs the matrix above and reports DONE / NEEDS YOU / NOT DONE |
| `write-tests` skill | `.claude/skills/write-tests/` | Which test layer to use and how to write it |
| `create-ui` skill | `.claude/skills/create-ui/` | Builds and screenshots UI in the visual language |
| Session start hook | `.claude/hooks/session-start.mjs` | In cloud sessions only, installs dependencies and builds core-models and core-util |
| Reminder hook | `.claude/hooks/schema-changed.mjs` | After an edit, reminds the agent what else must change: a migration after a schema edit, the connector reference after a registry edit |
| Permissions | `.claude/settings.json` | Allows the routine checks without prompts; denies force pushes, `rm -rf` and real `.env` files |

---

## Visual Language

The web UI follows [`docs/design/15-visual-language.md`](docs/design/15-visual-language.md). Use the `create-ui` skill for any page or layout change. In short:

- Colours and fonts come from `packages/web/src/styles/tokens.ts` through the MUI theme. Lint fails hex/rgb literals, inline font stacks and `window.confirm`/`alert`/`prompt` in `packages/web/src`.
- Status colours mean the same thing everywhere: decide the level with `lib/status.ts` and render it with `StatusChip`/`StatusDot`.
- A UI change isn't done until you've run `pnpm shots` and looked at the light, dark and phone images of the pages you touched.

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
galvaniflow/             — repository root (the GitHub repository is still named mirthless)
├── packages/
│   ├── core-models/     — Shared TS types, Zod schemas, branded types
│   ├── core-util/       — Shared utilities (HL7 parsing, serialization, date helpers)
│   ├── engine/          — Message processing: channel runtime, routing, queuing, sandbox
│   ├── connectors/      — Protocol adapters (tcp-mllp, http, file, sftp, database, dicom, fhir, smtp, email, js, kafka, amqp)
│   ├── server/          — Express API, auth, channel deployment, config management
│   └── web/             — React + MUI admin: channel editor, message browser, dashboard
├── e2e/                 — Playwright specs (`pnpm test:e2e`)
├── docker/              — Dockerfiles, Compose (development and production), nginx
├── docs/design/         — Design documents and dated analyses (00-18)
├── docs/ops/            — Deployment, TLS, backup, upgrade, soak test
├── docs/progress/       — Roadmap, decisions
├── docs/standards/      — Coding, logging, and config standards
├── docs/testing/        — Manual test scenarios
├── docs/user/           — User documentation (connector reference, quickstart, scripting API)
├── scripts/             — DB init, benchmarks, soak test, screenshots (`scripts/shots`)
├── .claude/             — Agent skills, hooks and settings (see Agent Tooling)
├── reference/           — Mirth Connect source + code samples (git-ignored)
└── pnpm-workspace.yaml
```

## Related Projects

These live on Michael's Windows machine under `C:\Users\mhobb\WebstormProjects\`. They are not in this repository, so a cloud session or another contributor cannot read them; everything this project needs from them is already here.

| Project | Folder | Used For | In this repository as |
|---|---|---|---|
| **fullstack-template** | `fullstack-template` | Base monorepo structure, Express patterns, React+MUI, auth, Drizzle | The package layout |
| **mission-critical-ts** | `mission-critical-ts` | Coding standards (apply strictly) | `docs/standards/` |
| **standardize-error** | `_published\standardize-error` | Error normalization | npm dependency `stderr-lib` |
| **dcmtk.js** | `dcmtk.js` | The first DICOM connector | No longer used: the connector runs on `dcmjs-dimse` |

## Reference Source

The original NextGen Connect source is at `reference/connect/` for architecture study. This is a spiritual remake — we keep the core concepts but redesign everything for Node.js. Do not replicate Connect's Java patterns, XML config formats, or API quirks.

## Progress Tracking

**You MUST actively maintain these docs during every session:**

| Doc | Purpose | When to Update |
|-----|---------|---------------|
| [`docs/progress/ROADMAP.md`](docs/progress/ROADMAP.md) | What's planned, not started | Check off items as they ship, add new items as they emerge |
| [`docs/progress/DECISIONS.md`](docs/progress/DECISIONS.md) | Why we chose X over Y | Add whenever a non-obvious architectural or design choice is made |

**Do NOT duplicate what git tracks.** These docs capture what git cannot: plans and rationale. What was built, what was checked and what was left out go in the pull request description, not a log file (D-291).

Add a decision at the end of `DECISIONS.md` with the next `D-NNN` number. Git merges the file with `merge=union`, so two branches that add a decision both keep theirs, and a test in `pnpm gate` (`packages/server/src/__tests__/docs/decisions.test.ts`) fails when two decisions share a number. The branch that merges second renumbers its decision and every place that cites it.

Git is the source of truth for what changed and when. Use `git log` for that, not STATUS.md.

## Diagrams

When creating diagrams, use **Mermaid** format with dark-mode-friendly colors.

## GitHub

- CLI on Michael's Windows machine: `"/c/Program Files/GitHub CLI/gh.exe"`. Elsewhere use `gh` from the PATH, or the GitHub tools the session provides.
- Account: MichaelLeeHobbs
