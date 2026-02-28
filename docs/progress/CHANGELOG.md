# Implementation Changelog

> Session-by-session log of what was built. Enables any future Claude instance to pick up where we left off.

## 2026-02-25 — Initial Scaffolding

### What was done:
- Created progress tracking system (`docs/progress/`)
- Set up monorepo root configuration (package.json, tsconfig, eslint, prettier, etc.)
- Docker setup with PostgreSQL 17
- Scaffolded all 7 packages:
  - `@mirthless/core-models` — branded types, constants, Zod schemas from design doc 01
  - `@mirthless/core-util` — Result re-export, validation utils
  - `@mirthless/engine` — empty shell
  - `@mirthless/connectors` — empty shell with base interface
  - `@mirthless/server` — Express app, config, middleware, Drizzle schema, auth, seeds
  - `@mirthless/web` — React+MUI shell, auth flow, login page
  - `@mirthless/cli` — empty shell
- Adapted auth system from fullstack-template (JWT + sessions + RBAC)
- Wrote Drizzle schema for all tables from design doc 07
- Verified: pnpm install (833 packages), build (0 errors), lint (0 warnings), test (framework runs)

### Build fixes applied:
- Zod v4: `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` (2-arg requirement)
- stderr-lib Result<T>: Success needs `error: null`, Failure needs `value: null`
- Web tsconfig: `module: "ESNext"`, `moduleResolution: "bundler"` (for MUI + Vite)
- `exactOptionalPropertyTypes`: conditional property inclusion instead of `undefined` assignment
- Vitest: `passWithNoTests: true` in all 6 configs
- Drizzle bigint: `mode: 'number'` instead of `mode: 'bigint'` (BigInt JSON.stringify error in Drizzle Kit)
- Replaced `bcrypt` with `bcryptjs` (native binding missing for Node.js v24 on Windows)
- Web API base URL: `/api/v1` (matches server route mount)

### Key decisions made:
- See DECISIONS.md D-001 through D-012

### What's next:
- Channel CRUD API endpoints
- Channel list page in web UI
- Engine message pipeline (Phase 2)

## 2026-02-26 — Channel CRUD API + Channel List UI

### What was done:
- **Channel CRUD API** (6 endpoints):
  - `GET /channels` — paginated list
  - `POST /channels` — create with default scripts
  - `GET /channels/:id` — full detail with scripts/destinations/tags
  - `PUT /channels/:id` — update with optimistic locking (revision)
  - `DELETE /channels/:id` — soft-delete
  - `PATCH /channels/:id/enabled` — toggle enabled flag
- **Server files created:**
  - `channel.service.ts` — business logic (list, getById, create, update, delete, setEnabled)
  - `channel.controller.ts` — HTTP adapter (error code → HTTP status mapping)
  - `channel.routes.ts` — route definitions with auth/permission/validation middleware
  - `channel.service.test.ts` — 18 unit tests covering all methods and error paths
- **Server files modified:**
  - Added `CONFLICT` error code to `service-error.ts`
  - Added `updateChannelSchema`, `channelListQuerySchema`, `patchChannelEnabledSchema` to `channel.schema.ts`
  - Registered `/channels` routes in `routes/index.ts`
- **Channel List UI** (web package):
  - `use-channels.ts` — TanStack Query hooks (useChannels, useChannel, useCreateChannel, useUpdateChannel, useDeleteChannel, useToggleChannelEnabled)
  - `ChannelsPage.tsx` — MUI Table with pagination, search, enable/disable toggle, delete confirmation
  - `NewChannelDialog.tsx` — modal form for creating channels (React Hook Form)
  - Added `api.patch()` convenience method to API client
  - Registered `/channels` route in App.tsx

### Build notes:
- Express 5 `req.params` returns `string | string[]` — cast to `string` after validation middleware
- `CreateChannelInput` (Zod inferred type) requires `enabled` and `responseMode` even though they have Zod defaults — must be explicit in client-side calls

### What's next:
- Channel editor page (Summary + Source tabs)
- Channel deployment/lifecycle API
- Dashboard with channel statistics

## 2026-02-28 — Channel Editor: Summary + Source Tabs

### What was done:
- **Channel Editor page** with tabbed interface (5 tabs, 2 implemented):
  - `ChannelEditorPage.tsx` — react-hook-form, useBlocker for unsaved changes, create + edit modes
  - `SummaryTab.tsx` — name, description, enabled, data types, initial state
  - `SourceTab.tsx` — connector settings dispatch + response settings
- **Source connector forms** (dynamic dispatch pattern):
  - `ConnectorSettingsSection.tsx` — component map by connector type
  - `TcpMllpSourceForm.tsx` — listener settings (host, port, max connections, charset, etc.)
  - `HttpSourceForm.tsx` — listener settings (host, port, context path, methods, response content type)
  - `UnsupportedConnectorPlaceholder.tsx` — fallback for unimplemented types
  - `connector-defaults.ts` — default property objects per type
  - `ResponseSettingsSection.tsx` — response mode, response connector name
- **Bug fixes across 3 sessions:**
  - Auth error responses: `{ code, message }` object format
  - Switched to `createBrowserRouter` (data router) for `useBlocker` support
  - API client: handle 204 No Content responses
  - Layout: flex overflow with `minWidth: 0`, vertical scroll fixes
  - React effect ordering: `isResettingRef` guard for form population
- **Manual test suite:** 8 test files, 81 scenarios, all passing
- **Schema + controller tests:** 29 schema + 13 controller tests added

### Build notes:
- `useBlocker` requires data router (`createBrowserRouter` + `RouterProvider`), not `BrowserRouter`
- API 204: check `response.status === 204` before `response.json()`
- MUI Grid: use `<Grid item xs={12} md={6}>`, not `size` prop
- Flex overflow: add `minWidth: 0` to flex children for `textOverflow: ellipsis`

### What's next:
- Destinations tab, Scripts tab (Monaco), Advanced tab

## 2026-02-28 — Complete Channel Editor: Destinations, Scripts, Advanced

### What was done:
- **Destinations tab** — two-panel layout:
  - `DestinationsTab.tsx` — main container with list + settings panels
  - `DestinationListPanel.tsx` — sidebar with add/remove/move-up/move-down controls
  - `DestinationSettingsPanel.tsx` — name, enabled, connector type, connector form, queue settings
  - `DestinationConnectorSettings.tsx` — dynamic form dispatch (same pattern as source)
  - `TcpMllpDestinationForm.tsx` — client settings (remote host, port, send timeout, keep-alive)
  - `HttpDestinationForm.tsx` — client settings (URL, method, headers, content type, response timeout)
  - `QueueSettingsSection.tsx` — queue mode, retry count/interval, rotate, thread count, wait-for-previous
  - `connector-defaults.ts` — default properties for destination connectors
  - `types.ts` — DestinationFormValues, DestConnectorFormProps interfaces
- **Scripts tab:**
  - `ScriptsTab.tsx` — 4 MUI Accordions with Monaco `<Editor>` instances (deploy, undeploy, preprocessor, postprocessor)
  - Installed `@monaco-editor/react` dependency
- **Advanced tab:**
  - `AdvancedTab.tsx` — message storage (radio group), encrypt/remove switches, pruning settings, custom metadata columns table
- **Schema changes** (`core-models`):
  - Added `destinationInputSchema` (name, connectorType, properties, queue settings)
  - Added `metadataColumnInputSchema` (name, dataType, mappingExpression)
  - Added pruning fields to `channelPropertiesSchema` (pruningEnabled, pruningMaxAgeDays, pruningArchiveEnabled)
  - Extracted `connectorTypeSchema` for reuse
  - Added `destinations` and `metadataColumns` arrays to `createChannelSchema`
  - **22 new schema tests** (51 total)
- **Service changes** (`server`):
  - Expanded `ChannelDestination` interface with full fields (properties, queue settings)
  - Expanded `ChannelDetail` with removeContent/removeAttachments/pruning fields
  - `fetchChannelRelations` now selects all connector columns, ordered by metaDataId
  - Destination sync in `create()` and `update()`: delete-and-reinsert with auto metaDataId
  - Metadata column sync: same delete-and-reinsert pattern
  - Pruning fields wired through create/update
  - **5 new service tests** (23 total)
- **ChannelEditorPage wiring:**
  - Expanded form state: destinations (useState), scripts (useState), advanced (useState)
  - Manual dirty tracking (`extraDirty`) for non-react-hook-form state
  - `onSubmit` builds full payload including destinations, scripts, metadataColumns, expanded properties
  - Replaced 3 `PlaceholderTab` instances with real components
- **Expanded `ChannelDetail` type** in `use-channels.ts` (full destination fields, pruning)
- **5 new manual test files:** destinations tab, dest TCP/MLLP, dest HTTP, scripts tab, advanced tab
- Updated data roundtrip tests to cover all new features

### Key decisions:
- D-013: Destinations inline with channel save (no separate CRUD endpoints)
- D-014: Delete-and-reinsert for destination sync (simplest within transaction, no external refs yet)
- D-015: Monaco from the start (core purpose of Scripts tab is code editing)
- D-016: Separate source vs destination connector forms (TCP/MLLP listener ≠ client)
- D-017: Defer filters, transformers, code templates, script validation to engine phase

### What's next:
- Engine pipeline (filters, transformers, sandbox)
- Dashboard with channel statistics
- Channel deployment/lifecycle API
