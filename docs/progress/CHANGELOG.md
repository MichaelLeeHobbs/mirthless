# Implementation Changelog

> Session-by-session log of what was built. Enables any future Claude instance to pick up where we left off.

## 2026-03-03 — Phase 28: Deep Polish

### What was done:
- **ScriptEditor Language Toggle** — Added `language` prop (javascript/typescript) and `showLanguageToggle` prop. JS/TS toggle via ToggleButtonGroup toolbar. Separate `registerJsDefaults()` and `registerTsDefaults()` for Monaco IntelliSense. Theme syncs with app dark/light mode via `useUiStore().themeMode`. Added bracket pair colorization, auto-closing brackets, format on paste.
- **ScriptEditor Type Definitions** — Added IO bridge function types (`httpFetch`, `dbQuery`, `routeMessage`, `getResource`), map shortcut types (`$c`, `$r`, `$g`, `$gc`), `globalMap`/`configMap` globals, `HttpFetchResponse`/`DbQueryResult` interfaces to sandbox-types.ts.
- **Language Prop Threading** — `showLanguageToggle` passed to ScriptEditor in ScriptsTab, FilterRuleEditor, TransformerStepEditor, GlobalScriptsPage.
- **Per-Channel Script Timeout** — `scriptTimeoutSeconds` (1-300s, default 30) added to Zod channel properties schema, Drizzle channels table (migration 0003), channel service create/update/clone, `PipelineConfig` interface, `MessageProcessor` constructor. UI: numeric input in AdvancedTab.
- **Default Channel Group** — Seed script creates "Default" group idempotently. Channel service `create()` auto-assigns new channels to "Default" group (non-blocking try-catch). Channel group service `delete()` protects "Default" group from deletion.
- **Reusable ConfirmDialog** — Generic MUI Dialog component with severity-colored confirm button, isPending support.
- **Replace window.confirm** — CodeTemplatePage (2 confirms), ChannelStatisticsPage (1 confirm), GlobalScriptsPage (blocker confirm) all migrated to ConfirmDialog.
- **Centralized Notification Store** — Zustand store with auto-dismiss (4s), `useNotification()` hook, `NotificationSnackbar` component wired into App.tsx.
- **Migrate Snackbars** — CodeTemplatePage, GlobalScriptsPage, MessageBrowserPage migrated from per-page Snackbar state to centralized `notify()`.
- **ErrorBoundary** — Class component wrapping RouterProvider in App.tsx. Catches render errors with MUI-styled error card and "Reload Page" button.
- **Channel Group Membership UI** — ChannelGroupsPage: "Manage Members" dialog with checkbox list, real-time add/remove member mutations, delete confirmation via ConfirmDialog.
- **Channel Editor Group Assignment** — ChannelGroupChips component: shows group chips with remove, add menu for available groups.
- **CertificatesPage Refactor** — Replaced inline DeleteConfirmDialog with shared ConfirmDialog component.

### Files changed:
- `packages/web/src/components/editors/ScriptEditor.tsx` (language toggle, theme sync, enhanced options)
- `packages/web/src/lib/sandbox-types.ts` (IO bridge + map types)
- `packages/web/src/components/channels/ScriptsTab.tsx` (showLanguageToggle)
- `packages/web/src/components/channels/source/FilterRuleEditor.tsx` (showLanguageToggle)
- `packages/web/src/components/channels/source/TransformerStepEditor.tsx` (showLanguageToggle)
- `packages/web/src/components/channels/AdvancedTab.tsx` (script timeout input)
- `packages/web/src/components/channels/ChannelGroupChips.tsx` (new)
- `packages/web/src/components/common/ConfirmDialog.tsx` (new)
- `packages/web/src/components/common/NotificationSnackbar.tsx` (new)
- `packages/web/src/components/common/ErrorBoundary.tsx` (new)
- `packages/web/src/stores/notification.store.ts` (new)
- `packages/web/src/App.tsx` (ErrorBoundary + NotificationSnackbar)
- `packages/web/src/pages/CodeTemplatePage.tsx` (ConfirmDialog + notify)
- `packages/web/src/pages/ChannelStatisticsPage.tsx` (ConfirmDialog)
- `packages/web/src/pages/GlobalScriptsPage.tsx` (ConfirmDialog + notify + language toggle)
- `packages/web/src/pages/MessageBrowserPage.tsx` (notify migration)
- `packages/web/src/pages/CertificatesPage.tsx` (shared ConfirmDialog)
- `packages/web/src/pages/ChannelGroupsPage.tsx` (member management + delete confirm)
- `packages/web/src/pages/ChannelEditorPage.tsx` (timeout + group chips)
- `packages/core-models/src/schemas/channel.schema.ts` (scriptTimeoutSeconds)
- `packages/server/src/db/schema/channels.ts` (scriptTimeoutSeconds column)
- `packages/server/src/db/migrations/0003_add_script_timeout.sql` (new)
- `packages/server/src/services/channel.service.ts` (timeout + auto-assign)
- `packages/server/src/services/channel-group.service.ts` (delete protection)
- `packages/server/src/db/seeds/run-seed.ts` (Default group seed)
- `packages/engine/src/pipeline/message-processor.ts` (scriptTimeoutMs config)
- `packages/server/src/services/__tests__/channel.service.test.ts` (fixture update)
- `packages/server/src/services/__tests__/channel-clone.service.test.ts` (fixture update)

---

## 2026-03-03 — Phase 27: Polish & Testing

### What was done:
- **Dashboard Redesign** — Default to grouped-by-default view (Mirth Connect style). Added search/filter toolbar to GroupedChannelTable. Added inline deploy/start/stop/pause icon buttons on channel rows (alongside three-dot menu). Added "Queued" summary card with colored top border on all cards.
- **Right-Click Context Menus** — Reusable `useContextMenu<T>` hook + `ChannelContextMenu` component. Dashboard table rows and channels list rows support right-click with state-aware deployment actions (Edit, Messages, Statistics, Deploy/Start/Stop/Pause, Clone, Delete).
- **Sidebar Grouping** — 18 flat nav items reorganized into 5 labeled sections (Overview, Channels, Configuration, Administration, System) with MUI `ListSubheader` headings. Tooltips on collapsed icon-only mode.
- **Mobile Responsive Drawer** — Sidebar converts from permanent to temporary drawer on mobile breakpoint (`md`). Closes on nav click. `useMediaQuery` for breakpoint detection.
- **Dark/Light Theme Toggle** — IconButton in AppBar toggles theme. Persisted to localStorage via `THEME_STORAGE_KEY`. Initial theme loaded from storage on app start.
- **Breadcrumbs** — Generic `PageBreadcrumbs` component (MUI Breadcrumbs + RouterLink). Added to ChannelEditorPage, MessageBrowserPage, ChannelStatisticsPage, AlertEditorPage.
- **Keyboard Shortcuts** — `useKeyboardShortcuts` hook with `?` for help dialog, `g d` dashboard, `g c` channels, `g s` settings, `g a` alerts, `g u` users. Ignores input/textarea focus. `KeyboardShortcutHelp` dialog component.
- **Bulk Operations Toolbar** — `useChannelSelection` hook (Set-based), checkbox column on ChannelStatusTable (optional props), floating `BulkActionsToolbar` (Deploy All, Start All, Stop All, Undeploy All) with selection count.
- **E2E Test Expansion** — 9 new Playwright specs: channel-groups (6 tests), tags (6), resources (6), global-map (5), config-map (5), system-info (3), statistics (5), cross-channel-search (5), message-flow rewrite (5 tests that actually send MLLP messages). Total: ~100+ E2E tests across 20 spec files.

### Files changed:
- `packages/web/src/pages/DashboardPage.tsx` (grouped default, bulk selection props)
- `packages/web/src/components/dashboard/GroupedChannelTable.tsx` (search toolbar, inline actions)
- `packages/web/src/components/dashboard/SummaryCards.tsx` (queued card, colored borders)
- `packages/web/src/components/dashboard/ChannelStatusTable.tsx` (context menu, checkbox column)
- `packages/web/src/components/dashboard/BulkActionsToolbar.tsx` (new)
- `packages/web/src/components/layout/AppLayout.tsx` (grouped sidebar, mobile responsive, theme toggle, keyboard shortcuts)
- `packages/web/src/components/common/ChannelContextMenu.tsx` (new)
- `packages/web/src/components/common/PageBreadcrumbs.tsx` (new)
- `packages/web/src/components/common/KeyboardShortcutHelp.tsx` (new)
- `packages/web/src/hooks/use-context-menu.ts` (new)
- `packages/web/src/hooks/use-keyboard-shortcuts.ts` (new)
- `packages/web/src/hooks/use-channel-selection.ts` (new)
- `packages/web/src/stores/ui.store.ts` (localStorage theme persistence)
- `packages/web/src/pages/ChannelsPage.tsx` (context menu)
- `packages/web/src/pages/ChannelEditorPage.tsx` (breadcrumbs)
- `packages/web/src/pages/MessageBrowserPage.tsx` (breadcrumbs)
- `packages/web/src/pages/ChannelStatisticsPage.tsx` (breadcrumbs)
- `packages/web/src/pages/AlertEditorPage.tsx` (breadcrumbs)
- `e2e/channel-groups.spec.ts` (new)
- `e2e/tags.spec.ts` (new)
- `e2e/resources.spec.ts` (new)
- `e2e/global-map.spec.ts` (new)
- `e2e/config-map.spec.ts` (new)
- `e2e/system-info.spec.ts` (new)
- `e2e/statistics.spec.ts` (new)
- `e2e/cross-channel-search.spec.ts` (new)
- `e2e/message-flow.spec.ts` (rewritten)

---

## 2026-03-03 — Phase 24: Sandbox Completeness & Pipeline Context

### What was done:
- **Deploy/Undeploy Script Execution** — Channel and global deploy/undeploy scripts now execute during channel lifecycle. `compileChannelScripts()` compiles DEPLOY/UNDEPLOY script types. Global deploy runs before channel deploy; channel undeploy runs before global undeploy. Scripts are stored in `DeployedChannel` for undeploy access. Failures are logged but do not block deployment.
- **Sandbox Bridge Functions** — 4 new IO bridge functions via dependency injection: `httpFetch` (with SSRF private IP blocking), `dbQuery` (parameterized only), `routeMessage` (channel name lookup), `getResource` (resource content by name). `BridgeDependencies` interface, `createBridgeFunctions(deps?)` backward compatible. Sandbox executor accepts deps in constructor.
- **Map Shortcuts** — `$()` cascading lookup (responseMap → connectorMap → channelMap → globalChannelMap → globalMap → configMap → sourceMap), `$r()` responseMap get/set, `$g()` globalMap get/set, `$gc()` configMap read-only. All injected into sandbox object.
- **globalMap/configMap in Sandbox** — `globalMap` (read-write) and `configMap` (Object.freeze, read-only) added to SandboxContext and sandbox object. globalMap mutations captured in `mapUpdates.globalMap`.
- **Pipeline Map Continuity** — `PipelineMapState` tracks `channelMap` and `responseMap` across all pipeline stages. `runScript()` receives map state, merges updates after execution. responseMap populated with `{ status, content }` per destination after send. configMap/globalMap/globalMapProxy wired from PipelineConfig into sandbox context.
- **GlobalMapProxy** — In-memory cache with dirty tracking. `load()`, `toRecord()`, `applyUpdates()`, `flush()`, `dispose()`. Debounced periodic flush to DB via `FlushCallback`. Created per-channel at deploy, disposed at undeploy.
- **configMap/globalMap Loading** — `deploy()` loads ConfigMapService.list() and GlobalMapService.list() in parallel with existing loads. ConfigMap built as `category.name` keyed frozen record. GlobalMapProxy created with upsert callback.
- **Attachment Handler** — `AttachmentHandler` class with REGEX (pattern extraction + `${ATTACH:id}` placeholder replacement), JAVASCRIPT (sandbox script returning `{ content, attachments }`), and NONE modes. `ExtractedAttachment` with UUID ID, mimeType, content, size. `MessageService.storeAttachment()` added.
- **Async IIFE Support** — When IO bridge deps are present, sandbox wraps code in `async function()` IIFE and awaits the Promise result.
- **Template Injector** — Added deploy/undeploy/globalDeploy/globalUndeploy to CONTEXT_MAP.

### Files changed (15+):
- `packages/engine/src/sandbox/bridge-functions.ts` (added BridgeDependencies, HttpFetchOptions, HttpFetchResult, RouteMessageResult, SSRF blocking, 4 new bridge functions)
- `packages/engine/src/sandbox/sandbox-executor.ts` (BridgeDependencies in constructor, async IIFE, globalMap/configMap/$/$r/$g/$gc injection, mapUpdates.globalMap)
- `packages/engine/src/sandbox/sandbox-context.ts` (added globalMap, configMap to SandboxContext)
- `packages/engine/src/sandbox/template-injector.ts` (4 new CONTEXT_MAP entries)
- `packages/engine/src/sandbox/index.ts` (new type exports)
- `packages/engine/src/pipeline/message-processor.ts` (PipelineMapState, refactored runScript, responseMap population, configMap/globalMap/globalMapProxy in PipelineConfig, AttachmentConfig, storeAttachment on MessageStore)
- `packages/engine/src/pipeline/attachment-handler.ts` (new)
- `packages/engine/src/runtime/global-map-proxy.ts` (new)
- `packages/engine/src/index.ts` (new exports: GlobalMapProxy, AttachmentHandler, ATTACHMENT_MODE, AttachmentConfig)
- `packages/server/src/engine.ts` (deploy/undeploy script execution, GlobalMapProxy creation, configMap/globalMap loading, storeAttachment adapter)
- `packages/server/src/services/message.service.ts` (storeAttachment method)
- `packages/server/src/services/__tests__/engine-deploy-scripts.test.ts` (new, ~12 tests)
- `packages/engine/src/sandbox/__tests__/bridge-io-functions.test.ts` (new, ~20 tests)
- `packages/engine/src/sandbox/__tests__/map-shortcuts.test.ts` (new, ~16 tests)
- `packages/engine/src/pipeline/__tests__/map-continuity.test.ts` (new, ~8 tests)
- `packages/engine/src/pipeline/__tests__/attachment-handler.test.ts` (new, ~15 tests)
- `packages/engine/src/runtime/__tests__/global-map-proxy.test.ts` (new, ~12 tests)

---

## 2026-03-03 — Phase 23: Preferences, Attachments, Stats, Batch, Recovery, Response Transformers

### What was done:
- User preferences API (5 endpoints), attachments API (2 endpoints), channel statistics page, batch processor (delimiter/regex/JS), recovery manager, response transformer (CT_RESPONSE_TRANSFORMED=7)
- See PR #13 for full details

---

## 2026-03-03 — Phase 22: History, Generator, Extensions, Reprocessing, Search

### What was done:
- Channel history, message generator, extensions, reprocessing, cross-channel search
- See PR #12 for full details

---

## 2026-03-02 — Phase 21: Server Backup/Restore, Pruner Scheduling, Monaco DX, Server Logs

### What was done:
- **Server Backup/Restore** (full stack) — Zod schemas for backup payload (version, exportedAt, 16 entity sections) + restore input (collisionMode: SKIP/OVERWRITE), ServerBackupService (exportBackup + restoreBackup with per-section processing), controller, routes (`/system/backup`, 2 endpoints), ~20 service tests, TanStack Query hooks (download blob + upload restore), BackupRestoreSection UI (download button, file upload dialog, collision mode selector, per-section result table)
- **Data Pruner Scheduling** (full stack) — PrunerSchedulerService using pg-boss `schedule()`/`work()`, controller, routes (`/admin/prune/schedule`, 2 endpoints), ~10 service tests, pruner settings seeded (pruner.enabled, pruner.cron_expression), TanStack Query hooks (status polling, update schedule, run now), PrunerSection UI (enable toggle, cron input, run now button, last run info), server.ts init on startup
- **Monaco Sandbox TypeScript Definitions** — `SANDBOX_TYPE_DEFS` string constant with `.d.ts` for all sandbox globals (msg, tmp, rawData, sourceMap, channelMap, connectorMap, responseMap, globalChannelMap, logger, parseHL7, createACK, Hl7MessageProxy, SandboxLogger), ScriptEditor wrapper with `beforeMount` configuration, all 5 Monaco usages replaced (ScriptsTab, FilterRuleEditor, TransformerStepEditor, TemplateEditor, GlobalScriptsPage), 4 tests
- **Server Logs Backend** — LogStreamService with in-memory ring buffer (10,000 entries), Pino tee stream integration (JSON line parsing), Socket.IO `logs` room handlers (join:logs/leave:logs), query endpoint with level/search/pagination filters, controller, routes (`/system/logs`, 1 endpoint), ~10 service tests, Pino logger refactored for log capture (setLogCaptureStream)
- **Server Logs UI** — useHistoricalLogs hook (initial load), useLogStream hook (Socket.IO subscription with pause/resume/buffer), LogViewer component (monospace log list, color-coded levels, ToggleButtonGroup level filter, debounced search, pause/resume, download as .log, clear)
- **SystemInfoPage enhancements** — Added PrunerSection, LogViewer, and BackupRestoreSection sections below existing cards
- **Manual test docs** — 4 new checklists (41-server-backup, 42-pruner-scheduling, 43-monaco-sandbox-types, 44-server-logs)
- **Design decisions** — D-103 through D-111

### Files changed (30+):
- `packages/core-models/src/schemas/server-backup.schema.ts` (new)
- `packages/core-models/src/schemas/index.ts` (1 new export)
- `packages/server/src/services/server-backup.service.ts` (new)
- `packages/server/src/services/pruner-scheduler.service.ts` (new)
- `packages/server/src/services/log-stream.service.ts` (new)
- `packages/server/src/controllers/server-backup.controller.ts` (new)
- `packages/server/src/controllers/pruner-scheduler.controller.ts` (new)
- `packages/server/src/controllers/log.controller.ts` (new)
- `packages/server/src/routes/server-backup.routes.ts` (new)
- `packages/server/src/routes/pruner-scheduler.routes.ts` (new)
- `packages/server/src/routes/log.routes.ts` (new)
- `packages/server/src/routes/index.ts` (4 new route mounts)
- `packages/server/src/lib/logger.ts` (refactored for log capture stream)
- `packages/server/src/lib/socket.ts` (added join:logs/leave:logs handlers)
- `packages/server/src/server.ts` (pruner scheduler init + log capture init)
- `packages/server/src/db/seeds/settings.ts` (2 new pruner settings)
- `packages/server/src/services/__tests__/server-backup.service.test.ts` (new)
- `packages/server/src/services/__tests__/pruner-scheduler.service.test.ts` (new)
- `packages/server/src/services/__tests__/log-stream.service.test.ts` (new)
- `packages/web/src/lib/sandbox-types.ts` (new)
- `packages/web/src/components/editors/ScriptEditor.tsx` (new)
- `packages/web/src/components/editors/__tests__/sandbox-types.test.ts` (new)
- `packages/web/src/components/system/BackupRestoreSection.tsx` (new)
- `packages/web/src/components/system/PrunerSection.tsx` (new)
- `packages/web/src/components/system/LogViewer.tsx` (new)
- `packages/web/src/hooks/use-backup.ts` (new)
- `packages/web/src/hooks/use-pruner.ts` (new)
- `packages/web/src/hooks/use-logs.ts` (new)
- `packages/web/src/pages/SystemInfoPage.tsx` (3 new sections)
- `packages/web/src/pages/GlobalScriptsPage.tsx` (replaced Editor with ScriptEditor)
- `packages/web/src/components/channels/ScriptsTab.tsx` (replaced Editor with ScriptEditor)
- `packages/web/src/components/channels/source/FilterRuleEditor.tsx` (replaced Editor with ScriptEditor)
- `packages/web/src/components/channels/source/TransformerStepEditor.tsx` (replaced Editor with ScriptEditor)
- `packages/web/src/components/code-templates/TemplateEditor.tsx` (replaced Editor with ScriptEditor)

---

## 2026-03-02 — Phase 20: Config Management, System Info & Dashboard Enhancements

### What was done:
- **Global Map** (full stack) — Zod schemas, service (list/get/upsert/delete/clear with onConflictDoUpdate), controller, routes (`/global-map`, 5 endpoints), 11 service tests, TanStack Query hooks, GlobalMapPage UI (key-value table + create/edit dialog + "Clear All" with confirmation)
- **Configuration Map** (full stack) — Zod schemas (composite key params, category filter, bulk upsert), service (list/get/upsert/bulkUpsert/delete), controller, routes (`/config-map`, 5 endpoints), 10 service tests, TanStack Query hooks, ConfigMapPage UI (table with category tabs + create/edit dialog)
- **System Info** (full stack) — Service aggregating health.service.ts functions (DB, memory, engine stats) + version/Node.js/OS/uptime/PID, controller, routes (`/system`, 1 endpoint), 6 service tests, TanStack Query hook (10s polling), SystemInfoPage UI (info cards + memory bars + DB status chip)
- **Dashboard Tag Filtering** — TagFilter component (MUI Autocomplete with colored Chips), client-side filtering via tag assignments, `useTagAssignments()` hook, `GET /tags/assignments` API endpoint
- **Dashboard Grouped View** — GroupedChannelTable component (collapsible group sections with aggregate stats + "Ungrouped" section), flat/grouped view toggle, `useGroupMemberships()` hook, `GET /channel-groups/memberships` API endpoint
- **Tag service** — Added `listAssignments()` method + controller handler + route
- **Channel group service** — Added `listMemberships()` method + controller handler + route
- **Event name constants** — Added `GLOBAL_MAP_UPDATED` and `CONFIG_MAP_UPDATED` to `EVENT_NAME` const
- **Code reuse** — Exported `getStateColor`/`getStatusDotColor` from ChannelStatusTable, imported in GroupedChannelTable (eliminated duplication)
- **Manual test docs** — 4 new checklists (37-global-map, 38-config-map, 39-system-info, 40-dashboard-filtering)

### Test results:
- 1,320 tests passing (184 schema + 68 HL7 + 196 engine + 321 connectors + 529 server + 22 CLI)
- Build: 0 errors, Lint: 0 warnings
- 31 new tests: 11 global-map + 10 config-map + 6 system-info + 2 tag-assignments + 2 group-memberships

### Files changed (40+):
- `packages/core-models/src/schemas/global-map.schema.ts` (new)
- `packages/core-models/src/schemas/config-map.schema.ts` (new)
- `packages/core-models/src/schemas/event.schema.ts` (added 2 EVENT_NAME entries)
- `packages/core-models/src/schemas/index.ts` (2 new exports)
- `packages/server/src/services/global-map.service.ts` (new)
- `packages/server/src/services/config-map.service.ts` (new)
- `packages/server/src/services/system-info.service.ts` (new)
- `packages/server/src/services/tag.service.ts` (added listAssignments)
- `packages/server/src/services/channel-group.service.ts` (added listMemberships)
- `packages/server/src/controllers/global-map.controller.ts` (new)
- `packages/server/src/controllers/config-map.controller.ts` (new)
- `packages/server/src/controllers/system-info.controller.ts` (new)
- `packages/server/src/controllers/tag.controller.ts` (added listAssignments)
- `packages/server/src/controllers/channel-group.controller.ts` (added listMemberships)
- `packages/server/src/routes/global-map.routes.ts` (new)
- `packages/server/src/routes/config-map.routes.ts` (new)
- `packages/server/src/routes/system-info.routes.ts` (new)
- `packages/server/src/routes/tag.routes.ts` (added GET /assignments)
- `packages/server/src/routes/channel-group.routes.ts` (added GET /memberships)
- `packages/server/src/routes/index.ts` (3 new route mounts)
- `packages/server/src/services/__tests__/global-map.service.test.ts` (new, 11 tests)
- `packages/server/src/services/__tests__/config-map.service.test.ts` (new, 10 tests)
- `packages/server/src/services/__tests__/system-info.service.test.ts` (new, 6 tests)
- `packages/server/src/services/__tests__/tag.service.test.ts` (added 2 tests)
- `packages/server/src/services/__tests__/channel-group.service.test.ts` (added 2 tests)
- `packages/web/src/hooks/use-global-map.ts` (new)
- `packages/web/src/hooks/use-config-map.ts` (new)
- `packages/web/src/hooks/use-system-info.ts` (new)
- `packages/web/src/hooks/use-tags.ts` (added useTagAssignments)
- `packages/web/src/hooks/use-channel-groups.ts` (added useGroupMemberships)
- `packages/web/src/pages/GlobalMapPage.tsx` (new)
- `packages/web/src/pages/ConfigMapPage.tsx` (new)
- `packages/web/src/pages/SystemInfoPage.tsx` (new)
- `packages/web/src/pages/DashboardPage.tsx` (tag filter + grouped view)
- `packages/web/src/components/dashboard/TagFilter.tsx` (new)
- `packages/web/src/components/dashboard/GroupedChannelTable.tsx` (new)
- `packages/web/src/components/dashboard/ChannelStatusTable.tsx` (exported getStateColor/getStatusDotColor)
- `packages/web/src/App.tsx` (3 new routes)
- `packages/web/src/components/layout/AppLayout.tsx` (3 new nav items)
- `docs/testing/37-global-map.md`, `38-config-map.md`, `39-system-info.md`, `40-dashboard-filtering.md` (new)

---

## 2026-03-02 — Phase 19: Channel Groups, Tags, Dependencies & Resources

### What was done:
- **Channel Groups** (full stack) — Zod schemas, service (CRUD + member management with optimistic locking), controller, routes (`/channel-groups`), 16 service tests, TanStack Query hooks, ChannelGroupsPage UI (table + create/edit dialog)
- **Channel Tags** (full stack) — Zod schemas (with hex color validation), service (CRUD + assignment), controller, routes (`/tags`), 12 service tests, TanStack Query hooks, TagsPage UI (table with colored chips + create/edit dialog with native color picker)
- **Channel Dependencies** (API only) — Zod schemas, service (get/set dependencies + DAG validation via iterative DFS), routes (`/channels/:id/dependencies|dependents`), 15 service tests including cycle detection (direct, transitive, valid DAG)
- **Resources** (full stack) — Zod schemas, service (CRUD with auto-computed sizeBytes), controller, routes (`/resources`), 12 service tests, TanStack Query hooks, ResourcesPage UI (table + create/edit dialog with monospace content editor)
- **DB schema** — Added `content text` column to resources table
- **Route wiring** — 4 new route modules mounted in route aggregator (channel-groups, tags, channel-dependencies before greedy /:id, resources)
- **UI wiring** — 3 new pages in App.tsx router, 3 new nav items in AppLayout sidebar (Channel Groups, Resources, Tags)
- **Zod schema barrel** — 4 new exports in core-models schemas index

### Test results:
- 1,289 tests passing (184 schema + 68 HL7 + 196 engine + 321 connectors + 498 server + 22 CLI)
- Build: 0 errors, Lint: 0 warnings
- 55 new tests: 16 channel-group + 12 tag + 15 channel-dependency + 12 resource

### Files changed (31):
- `packages/core-models/src/schemas/channel-group.schema.ts` (new)
- `packages/core-models/src/schemas/tag.schema.ts` (new)
- `packages/core-models/src/schemas/channel-dependency.schema.ts` (new)
- `packages/core-models/src/schemas/resource.schema.ts` (new)
- `packages/core-models/src/schemas/index.ts` (4 new exports)
- `packages/server/src/db/schema/resources.ts` (added content column)
- `packages/server/src/services/channel-group.service.ts` (new)
- `packages/server/src/services/tag.service.ts` (new)
- `packages/server/src/services/channel-dependency.service.ts` (new)
- `packages/server/src/services/resource.service.ts` (new)
- `packages/server/src/controllers/channel-group.controller.ts` (new)
- `packages/server/src/controllers/tag.controller.ts` (new)
- `packages/server/src/controllers/resource.controller.ts` (new)
- `packages/server/src/routes/channel-group.routes.ts` (new)
- `packages/server/src/routes/tag.routes.ts` (new)
- `packages/server/src/routes/channel-dependency.routes.ts` (new)
- `packages/server/src/routes/resource.routes.ts` (new)
- `packages/server/src/routes/index.ts` (4 new route mounts)
- `packages/server/src/services/__tests__/channel-group.service.test.ts` (new, 16 tests)
- `packages/server/src/services/__tests__/tag.service.test.ts` (new, 12 tests)
- `packages/server/src/services/__tests__/channel-dependency.service.test.ts` (new, 15 tests)
- `packages/server/src/services/__tests__/resource.service.test.ts` (new, 12 tests)
- `packages/web/src/hooks/use-channel-groups.ts` (new)
- `packages/web/src/hooks/use-tags.ts` (new)
- `packages/web/src/hooks/use-resources.ts` (new)
- `packages/web/src/pages/ChannelGroupsPage.tsx` (new)
- `packages/web/src/pages/TagsPage.tsx` (new)
- `packages/web/src/pages/ResourcesPage.tsx` (new)
- `packages/web/src/App.tsx` (3 new routes)
- `packages/web/src/components/layout/AppLayout.tsx` (3 new nav items)
- `docs/testing/33-channel-groups.md`, `34-channel-tags.md`, `35-channel-dependencies.md`, `36-resources.md` (new)

---

## 2026-03-02 — Phase 18: Message Storage Policies

### What was done:
- **sourceMap persistence** (`packages/engine/src/pipeline/message-processor.ts`) — Pipeline now stores `input.sourceMap` as JSON string with contentType=9 (CT_SOURCE_MAP) and dataType='JSON' after raw content storage. Stored before filter stage, so filtered messages also have sourceMap. Maps automatically appear in message browser UI (MessageQueryService already maps contentType 9→sourceMap).
- **Per-channel storage policy adapter** (`packages/server/src/engine.ts`) — `createMessageStoreAdapter()` now accepts optional `StorageConfig` with `messageStorageMode`, `removeContentOnCompletion`, `removeAttachmentsOnCompletion`. `shouldStoreContent()` enforces content rules per storage mode (DEVELOPMENT=all, PRODUCTION=errors only, RAW=raw+errors, METADATA/DISABLED=nothing). Adapter silently returns OK for filtered content types.
- **Content/attachment cleanup on completion** — When `removeContentOnCompletion=true`, the adapter's `markProcessed()` calls `MessageService.deleteContent()` after marking processed. Same for `removeAttachmentsOnCompletion` with `deleteAttachments()`.
- **Per-channel adapter in deploy()** — EngineManager no longer has a shared `this.store`. Each channel gets its own adapter created during `deploy()` with the channel's storage settings. QueueConsumer and MessageProcessor use the per-channel store.
- **MessageService.deleteContent/deleteAttachments** (`packages/server/src/services/message.service.ts`) — Two new static methods that delete all message_content or message_attachments rows for a given channelId+messageId.

### Test results:
- 1,234 tests passing (184 schema + 68 HL7 + 196 engine + 321 connectors + 443 server + 22 CLI)
- Build: 0 errors, Lint: 0 warnings

### Files changed (6):
- `packages/engine/src/pipeline/message-processor.ts` (added CT_SOURCE_MAP constant, sourceMap storage)
- `packages/engine/src/pipeline/__tests__/message-processor.test.ts` (+7 tests for sourceMap persistence)
- `packages/server/src/engine.ts` (StorageConfig, shouldStoreContent, per-channel adapter, removed this.store)
- `packages/server/src/services/message.service.ts` (added deleteContent, deleteAttachments methods)
- `packages/server/src/services/__tests__/message.service.test.ts` (+4 tests for delete methods)
- `packages/server/src/services/__tests__/engine-storage.test.ts` (new, +5 tests for shouldStoreContent)
- `packages/server/src/services/__tests__/engine-integration.test.ts` (updated mock)
- `packages/server/src/services/__tests__/queue-consumer-wiring.test.ts` (updated mock)

---

## 2026-03-02 — Phase 17: DICOM Connector

### What was done:
- **DICOM Receiver** (`packages/connectors/src/dicom/dicom-receiver.ts`) — Source connector wrapping `@ubercode/dcmtk` DicomReceiver for C-STORE SCP. Factory injection pattern for testability (ReceiverFactory). Supports PER_FILE and PER_ASSOCIATION dispatch modes. Post-action: DELETE, MOVE, or NONE. Content = file path, metadata in sourceMap.
- **DICOM Dispatcher** (`packages/connectors/src/dicom/dicom-dispatcher.ts`) — Destination connector wrapping `@ubercode/dcmtk` DicomSender for C-STORE SCU. Factory injection (SenderFactory). Single/multiple association modes with configurable retries and timeouts.
- **Registry** — Added DICOM source + destination factory entries to connector registry.
- **Server Validation** — Added `dicomSourceSchema` (port + storageDir) and `dicomDestSchema` (host + port) to connector-validation.service.ts.
- **Source UI Form** (`DicomSourceForm.tsx`) — 2-column layout: DICOM Listener (port, AE title, storage dir) + Processing (pool sizes, timeout, dispatch mode, post action with conditional move-to directory).
- **Destination UI Form** (`DicomDestinationForm.tsx`) — 2-column layout: Remote SCP (host, port, called/calling AE titles) + Sending (mode with conditional max associations, timeout, retries, retry delay).
- **Defaults** — DICOM_SOURCE_DEFAULTS and DICOM_DEST_DEFAULTS added to both source and destination connector-defaults.ts.
- **Manual test checklist** — `docs/testing/31-dicom-connector.md` (45 scenarios).

### Test results:
- 1,218 tests passing (184 schema + 68 HL7 + 189 engine + 321 connectors + 434 server + 22 CLI)
- Build: 0 errors, Lint: 0 warnings

### Files changed (16):
- `packages/connectors/package.json` (added @ubercode/dcmtk dependency)
- `packages/connectors/src/dicom/dicom-receiver.ts` (new)
- `packages/connectors/src/dicom/dicom-dispatcher.ts` (new)
- `packages/connectors/src/dicom/index.ts` (new)
- `packages/connectors/src/dicom/__tests__/dicom-receiver.test.ts` (new, 18 tests)
- `packages/connectors/src/dicom/__tests__/dicom-dispatcher.test.ts` (new, 21 tests)
- `packages/connectors/src/registry.ts` (added DICOM entries)
- `packages/connectors/src/index.ts` (added DICOM exports)
- `packages/server/src/services/connector-validation.service.ts` (added DICOM schemas)
- `packages/server/src/services/__tests__/connector-validation.service.test.ts` (added 6 tests)
- `packages/web/src/components/channels/source/DicomSourceForm.tsx` (new)
- `packages/web/src/components/channels/source/connector-defaults.ts` (added DICOM defaults)
- `packages/web/src/components/channels/source/ConnectorSettingsSection.tsx` (added DICOM form)
- `packages/web/src/components/channels/destinations/DicomDestinationForm.tsx` (new)
- `packages/web/src/components/channels/destinations/connector-defaults.ts` (added DICOM defaults)
- `packages/web/src/components/channels/destinations/DestinationConnectorSettings.tsx` (added DICOM form)

---

## 2026-03-02 — Phase 16 Simplify Fixes (Batch)

### What was done:
- **Unit 1 — Engine Performance & Cleanup (PR #8):**
  - `engine.ts` — JS connector scripts compiled once at deploy time, not per-message. `wireJavaScriptSource()` and `wireJavaScriptDestinations()` now async, pre-compile script and capture in closure
  - `engine.ts` — `dispose()` changed from `void` to `async Promise<void>` for proper async cleanup
  - `engine.ts` — N+1 alert loading fixed: replaced `AlertService.list()` + N × `getById()` with single `AlertService.getByIds()` batch query
  - `alert.service.ts` — New `getByIds(ids)` method using `inArray()` for batch alert fetching (3 queries instead of 1+2N)
  - 4 new alert service tests, updated engine integration and queue consumer wiring tests
- **Unit 2 — Socket & Deployment Type Safety (PR #7):**
  - `core-models/constants.ts` — New `SOCKET_EVENT` const object (`CHANNEL_STATE`, `STATS_UPDATE`, `MESSAGE_NEW`)
  - `deployment.service.ts` — `ChannelStatus.state` typed as `ChannelState` instead of `string`, extracted `emitStateChange()` helper replacing 7 hardcoded `emitToAll()` calls
  - `message.service.ts` — Replaced hardcoded event strings with `SOCKET_EVENT` constants
  - Updated socket emission tests to use constants
- **Unit 3 — Web Socket Hooks (PR #6):**
  - `use-socket.ts` — Generic `useSocketEvent<T>` typing, new `useSocketRoom` hook extracting room join/leave/reconnect pattern
  - `DashboardPage.tsx` — Replaced 10-line useEffect with `useSocketRoom('join:dashboard', 'leave:dashboard')`
  - `MessageBrowserPage.tsx` — Replaced 11-line useEffect with `useSocketRoom('join:channel', 'leave:channel', channelId)`

### Test results:
- 1,173 tests passing (184 schema + 68 HL7 + 189 engine + 282 connectors + 428 server + 22 CLI)
- Build: 0 errors, Lint: 0 warnings

### Files changed (12):
- `packages/core-models/src/constants.ts`
- `packages/server/src/engine.ts`
- `packages/server/src/services/alert.service.ts`
- `packages/server/src/services/deployment.service.ts`
- `packages/server/src/services/message.service.ts`
- `packages/server/src/services/__tests__/alert.service.test.ts`
- `packages/server/src/services/__tests__/engine-integration.test.ts`
- `packages/server/src/services/__tests__/queue-consumer-wiring.test.ts`
- `packages/server/src/services/__tests__/socket-emission.test.ts`
- `packages/web/src/hooks/use-socket.ts`
- `packages/web/src/pages/DashboardPage.tsx`
- `packages/web/src/pages/MessageBrowserPage.tsx`

---

## 2026-03-01 — QueueConsumer Wiring + WebSocket Real-Time Updates (Phase 16)

### What was done:
- **QueueConsumer Wiring (Unit 1):**
  - `engine.ts` — QueueConsumer instances created for each queued destination during `deploy()`
  - Config uses per-destination `retryCount`, `retryIntervalMs`, `batchSize: 10`, `pollIntervalMs: 1000`
  - Consumers stored in `DeployedChannel` interface, started/stopped with channel lifecycle
  - `deployment.service.ts` — `start()` starts queue consumers, `stop()`/`halt()` stops them, `undeploy()` stops before cleanup
  - 10 new tests in `queue-consumer-wiring.test.ts`
- **Socket.IO Server Auth + Room Management (Unit 2):**
  - `packages/server/src/lib/socket.ts` — JWT auth middleware validating `auth.token` handshake parameter
  - Channel-based rooms (`join:channel`, `leave:channel`, `join:dashboard`, `leave:dashboard`)
  - `emitToRoom`/`emitToAll` helpers, `_resetIO` for testing
  - 12 new tests in `socket.test.ts`
- **Server-Side Socket.IO Emission (Unit 3):**
  - `deployment.service.ts` — `emitToAll('channel:state', { channelId, state })` after every state change
  - `message.service.ts` — `emitToRoom('dashboard', 'stats:update', ...)` after `incrementStats()`, `emitToRoom('channel:${channelId}', 'message:new', ...)` after `createConnectorMessage()`
  - 9 new tests in `socket-emission.test.ts`
- **WebSocket Client (Unit 4):**
  - `packages/web/src/lib/socket.ts` — socket.io-client singleton with JWT auth, auto-reconnect, token refresh via Zustand subscribe
  - `packages/web/src/hooks/use-socket.ts` — `useSocketConnection()` (connects on auth, disconnects on logout, invalidates queries on reconnect), `useSocketEvent()` (subscribe/unsubscribe to events)
  - `AppLayout.tsx` — `useSocketConnection()` added
  - `QueryProvider.tsx` — `queryClient` exported
- **Dashboard + Message Browser Real-Time (Unit 5):**
  - `DashboardPage.tsx` — joins dashboard room, `useSocketEvent` for `channel:state` and `stats:update` cache invalidation, keeps `refetchInterval` as fallback
  - `MessageBrowserPage.tsx` — joins channel room, `useSocketEvent` for `message:new` cache invalidation
  - `use-deployment.ts` — exported `DEPLOYMENT_KEYS`
  - `use-statistics.ts` — exported `STATS_KEYS`

### Test counts:
- core-models: 184, core-util: 68, engine: 189, connectors: 282, server: 423, cli: 22
- **Total: 1,168 tests** (was 1,137 → +31)

### Key decisions:
- See DECISIONS.md D-075 through D-079

### What's next:
- DICOM connector (dedicated phase)
- Persistent message store

## 2026-03-01 — Production Readiness (Phase 15)

### What was done:
- **Email Service + AlertManager Wiring (Unit 1):**
  - `email.service.ts` — Reads SMTP settings from DB, sends mail via nodemailer, Result<T> pattern
  - Wired `emailSender` callback into `AlertManager` constructor in `engine.ts` — EMAIL alert actions now functional
  - 13 tests (getSmtpConfig + sendMail success/failure paths)
- **SMTP Settings Seed Data (Unit 2):**
  - 6 new settings: `smtp.host`, `smtp.port`, `smtp.secure`, `smtp.from`, `smtp.auth_user`, `smtp.auth_pass`
- **SMTP Settings UI (Unit 3):**
  - Added 'smtp' category tab to Settings page
  - Password masking for `smtp.auth_pass` field
- **Connector Property Validation (Unit 4):**
  - `connector-validation.service.ts` — Zod schemas for 6 source + 8 destination connector types
  - Wired into `deployment.service.ts` — validates before `engine.deploy()`
  - `INVALID_INPUT` → HTTP 400 in deployment controller
  - 35 validation tests + 3 deployment integration tests
- **Enhanced Health Check (Unit 5):**
  - `health.service.ts` — DB connectivity, engine stats, memory usage
  - `GET /health` — full health info (backwards compatible), 200 or 503
  - `GET /health/live` — Kubernetes liveness probe (always 200)
  - `GET /health/ready` — Kubernetes readiness probe (DB check)
  - 17 health service tests
- **Auth Rate Limiting (Unit 6):**
  - Added `authRateLimiter` to `POST /refresh` endpoint (was unprotected)
  - 3 route middleware tests
- **Script Syntax Validation (Unit 7):**
  - `POST /api/v1/scripts/validate` — esbuild-based JS/TS syntax checking
  - Service + Controller + Route (3 new files)
  - 11 validation tests

### Test counts:
- core-models: 184, core-util: 68, engine: 189, connectors: 282, server: 392, cli: 22
- **Total: 1,137 tests** (was 1,055 → +82)

### Key decisions:
- See DECISIONS.md D-068 through D-074

### What's next:
- DICOM connector (dedicated phase)
- Persistent message store
- WebSocket-based real-time updates

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

## 2026-02-28 — Engine Foundation: Sandbox, Pipeline, Connectors, Deployment

### What was done:
- **Sandbox** (`engine`):
  - `VmSandboxExecutor` — vm-based script execution with `runInNewContext`, timeout enforcement
  - `ScriptCompiler` — esbuild TypeScript → JavaScript transpilation
  - `SandboxContext` — channel/connector maps, logger, message helpers exposed to user scripts
- **8-stage message pipeline** (`engine`):
  - `MessageProcessor` — preprocessing → source filter → source transformer → per-destination (filter → transformer → send → response transformer) → postprocessing
  - Each stage produces `MessageStatus` (TRANSFORMED, FILTERED, SENT, ERROR, QUEUED)
- **Channel runtime** (`engine`):
  - `ChannelRuntime` — state machine (UNDEPLOYED → DEPLOYING → STOPPED → STARTING → STARTED → PAUSING → PAUSED → STOPPING → HALTING)
  - `QueueConsumer` — pulls messages from queue, dispatches through pipeline
  - `InMemoryMessageStore` — implements `MessageStore` interface for tests
- **TCP/MLLP connectors** (`connectors`):
  - `TcpMllpReceiver` — TCP server with MLLP framing, connection tracking, graceful shutdown
  - `TcpMllpDispatcher` — TCP client pool with round-robin allocation, MLLP framing, response timeout
  - `MllpFrameParser` — streaming MLLP frame reassembly (VT prefix, FS+CR suffix)
  - `SourceConnectorRuntime` / `DestinationConnectorRuntime` interfaces in `base.ts`
  - Connector registry with factory pattern
- **Deployment API** (`server`, 8 endpoints):
  - `POST /deploy/:id` — deploy channel (compile scripts, create connectors, wire pipeline)
  - `POST /undeploy/:id` — undeploy channel
  - `POST /start/:id`, `/stop/:id`, `/halt/:id`, `/pause/:id`, `/resume/:id` — lifecycle control
  - `GET /status/:id` — channel runtime status with statistics
  - `DeploymentService`, `DeploymentController`, deployment routes
  - Engine manager singleton bridges server → engine
- **Message Query API** (`server`, 4 endpoints):
  - `GET /channels/:id/messages` — search/filter with server-side pagination
  - `GET /channels/:id/messages/:messageId` — full message detail with content
  - `DELETE /channels/:id/messages/:messageId` — delete message
  - `DELETE /channels/:id/messages` — bulk delete with filters
  - `MessageQueryService`, `MessageController`, message routes
- **Statistics API** (`server`, 3 endpoints):
  - `GET /statistics` — all-channels summary
  - `GET /statistics/:id` — per-channel statistics
  - `POST /statistics/:id/reset` — reset channel statistics
  - `StatisticsService`, `StatisticsController`, statistics routes
- **E2E test:** ADT^A01 message flows TCP (port 17661) → pipeline → TCP (port 17662) with in-memory store
- **Tests:** 68 engine + 26 connector + 13 deployment + 19 message-query + 9 statistics = **135 new tests**

### Key decisions:
- D-018: vm-based sandbox (node:vm) — isolated-vm fails on Windows/Node.js v24
- D-019: esbuild for script compilation — <1ms TypeScript transpilation
- D-020: 8-stage pipeline — matches Mirth Connect's proven model
- D-021: Channel runtime as state machine — prevents invalid transitions
- D-022: In-memory message store for v1 — no DB dependency for engine tests
- D-023: Connection pooling for TCP/MLLP dispatcher — round-robin socket pool
- D-024: MLLP framing in dedicated module — testable independently

### Build notes:
- `isolated-vm` native bindings fail on Windows/Node.js v24 — use node:vm fallback
- `db.execute()` returns `QueryResult<T>` with `.rows`, not raw array
- TCP connect to non-listening port hangs on Windows — use abort signals instead
- MLLP framing: VT=0x0B prefix, FS+CR=0x1C+0x0D suffix

### What's next:
- Dashboard with channel statistics
- Message browser UI
- HTTP connector, HL7 parser

## 2026-02-28 — Dashboard, Message Browser, and Supporting API

### What was done:
- **Dashboard page** (`web`):
  - `DashboardPage.tsx` — summary cards (total channels, received, sent, errored) + channel status table
  - `SummaryCards.tsx` — 4 stat cards with MUI Paper
  - `ChannelStatusTable.tsx` — channel name, state chip, received/sent/filtered/errored counts, quick actions
  - Quick actions: deploy/undeploy, start/stop/pause/resume per channel
  - Auto-refresh via TanStack Query polling (5s `refetchInterval`)
- **Message Browser page** (`web`):
  - `MessageBrowserPage.tsx` — search bar + paginated table + detail panel
  - `MessageSearchBar.tsx` — status filter, date range, text search
  - `MessageTable.tsx` — message ID, status chip, received date, connector name, content preview
  - `MessageDetailPanel.tsx` — full message content with Raw/Encoded/Transformed tabs, copy-to-clipboard
  - Server-side pagination, filter by status/date/text
- **Supporting hooks** (`web`):
  - `use-deployment.ts` — TanStack Query mutations for deploy/undeploy/start/stop/pause/resume
  - `use-statistics.ts` — useAllStatistics, useChannelStatistics queries
  - `use-messages.ts` — useMessages (paginated), useMessageDetail, useDeleteMessage queries
- **API client additions** (`web`):
  - Deployment methods: deploy, undeploy, start, stop, halt, pause, resume, getStatus
  - Statistics methods: getAllStatistics, getChannelStatistics, resetStatistics
  - Message methods: getMessages, getMessageDetail, deleteMessage, bulkDeleteMessages
- **App routing:** Added `/channels/:id/messages` route for message browser
- **Layout:** Added navigation links for Dashboard and Messages in AppLayout sidebar

### Key decisions:
- D-025: Auto-refresh via TanStack Query polling (5s) — no WebSocket for v1
- D-026: Statistics API returns per-channel + all-channels summary
- D-027: Message browser with server-side pagination

### What's next:
- HTTP connector (second protocol)
- HL7v2 parser for user scripts
- User management UI

## 2026-02-28 — HTTP Connector, HL7v2 Parser, User Management

### What was done:

**Phase 1 — HTTP Connector** (`connectors`):
- `HttpReceiver` — HTTP source connector using `node:http`. Implements `SourceConnectorRuntime`. Validates method/path, reads body, builds `sourceMap` with HTTP metadata (remoteAddress, method, path, headers, queryString, contentType).
- `HttpDispatcher` — HTTP destination connector using native `fetch`. Uses `AbortSignal.any()` for combined timeout+abort. Returns `ConnectorResponse` with SENT/ERROR status.
- Registry updated with HTTP factories for both source and destination
- Re-exported from `connectors/index.ts`
- **23 tests** (12 receiver + 11 dispatcher)

**Phase 2 — HL7v2 Parser** (`core-util`):
- `hl7-encoding.ts` — Delimiter detection from MSH segment, escape/unescape with all standard sequences (`\F\`, `\S\`, `\T\`, `\R\`, `\E\`, `\Xnn\` hex)
- `hl7-path.ts` — Path parsing (`PID.3.1` → structured `Hl7Path`), auto-resolve of missing indices
- `hl7-message.ts` — Core parser class: `parse()`, `get()`, `set()`, `delete()`, `toString()`, `getSegmentString()`, `getSegmentCount()`. Nested numeric-indexed internal representation. MSH special handling. Round-trip preserving.
- `hl7-ack.ts` — ACK/NAK message generation (AA/AE/AR), sender/receiver swap, MSA + optional ERR segment
- `hl7/index.ts` — Public re-exports
- Re-exported from `core-util/index.ts`
- **68 tests** (19 encoding + 10 path + 32 message + 7 ACK)

**Phase 3 — User Management** (`server` + `web`):
- **API** (7 endpoints):
  - `GET /users` — list all users (admin only)
  - `POST /users` — create user (admin only)
  - `GET /users/:id` — get user detail
  - `PUT /users/:id` — update user (admin only)
  - `DELETE /users/:id` — soft-delete via enabled=false (admin only)
  - `POST /users/:id/password` — change password (admin or self)
  - `POST /users/:id/unlock` — unlock locked account (admin only)
- `UserService` — 7 static methods with self-protection (cannot disable own account, cannot change own role, cannot delete last admin), bcryptjs password hashing
- `UserController` — HTTP adapter with error code → status mapping
- Schema additions: `changePasswordSchema`, `userIdParamSchema`
- **20 server tests** (user service)
- **Users page** (`web`):
  - `UsersPage.tsx` — Table with username, email, full name, role chip, enabled status, last login, actions (edit/disable/unlock)
  - `UserDialog.tsx` — Create/edit dialog with username, email, password, first/last name, role select
  - `use-users.ts` — TanStack Query hooks (useUsers, useUser, useCreateUser, useUpdateUser, useDeleteUser, useChangePassword, useUnlockUser)
  - API client: added `UserSummary`, `UserDetail` interfaces and 7 API methods
  - App.tsx: added `/users` route

### Key decisions:
- D-028: Native `fetch` for HTTP dispatcher — Node.js 18+ built-in, no extra dependency
- D-029: node:http for HTTP receiver — lightweight, no Express dependency in connectors package
- D-030: No connection pooling for HTTP dispatcher — fetch manages connections internally
- D-031: HL7 parser in `core-util` not `engine` — general utility, used in sandbox scripts + server
- D-032: 1-based indexing for HL7 paths — matches HL7 spec
- D-033: Soft-delete users (enabled: false) — preserve audit trail, referential integrity
- D-034: Admin-only user management — matches Mirth Connect pattern, self-protection rules

### Build notes:
- Registry Map type inference: `exactOptionalPropertyTypes` required explicit `new Map<string, Factory>()` and return type annotations on lambdas
- `let` → `const` in hl7-path.ts (field never reassigned)
- Removed unused eslint-disable directives in hl7-message.ts

### Verification:
- `pnpm build` — 0 errors
- `pnpm lint` — 0 warnings
- `pnpm test` — **369 tests passing** (258 existing + 111 new)

### What's next:
- Code templates (reusable JavaScript functions shared across channels)
- Alert system (configurable notifications on channel events/errors)
- File connector, Database connector
- Persistent message store (Drizzle-backed, replacing in-memory)

## 2026-02-28 — Production Readiness: Queue Fix, Code Templates, Global Scripts, E2E Tests

### What was done:

**Deliverable 1 — Fix Queue Consumer Content Loading** (`engine`, `server`):
- Added `loadContent` method to `MessageStore` interface in `message-processor.ts`
- Queue consumer now loads SENT content (type 5) from DB before dispatching
- Gracefully handles missing/failed content by releasing message as ERROR and incrementing errored stats
- Added `MessageService.loadContent` static method (Drizzle query on `message_content` table)
- Wired `loadContent` into engine adapter in `engine.ts`
- Updated all mock stores (e2e-pipeline, queue-consumer, message-processor tests)
- **3 new engine tests** (loadContent before send, loadContent failure → ERROR, loadContent null → ERROR)

**Deliverable 2 — Code Templates API + UI** (`core-models`, `server`, `web`):
- **Zod schemas** (`code-template.schema.ts`): 15 context values, 2 template types (FUNCTION/CODE_BLOCK), library + template CRUD schemas with optimistic locking
- **Service** (`code-template.service.ts`): 8 static methods — listLibraries, createLibrary, updateLibrary, deleteLibrary, listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate
- **Controller + Routes**: 8 endpoints behind `authenticate` + `requirePermission('code-templates:read'|'code-templates:write')`
- **UI**: Two-panel CodeTemplatePage with LibraryTree (collapsible library list) + TemplateEditor (name, type, contexts checkboxes, Monaco code editor)
- **TanStack Query hooks**: 8 hooks with query key hierarchy for cache invalidation
- **21 schema tests + 20 service tests**

**Deliverable 3 — Global Scripts Page** (`core-models`, `server`, `web`):
- **Zod schema** (`global-script.schema.ts`): `updateGlobalScriptsSchema` with 4 optional string fields
- **Service** (`global-script.service.ts`): `getAll()` returns 4 scripts with empty string defaults, `update()` upserts provided fields
- **Controller + Routes**: GET + PUT behind `authenticate` + `requirePermission('config:read'|'config:write')`
- **UI**: GlobalScriptsPage with 4-tab Monaco editors (Deploy, Undeploy, Preprocessor, Postprocessor), dirty tracking + `useBlocker` navigation warning
- **7 service tests** with thenable mock for dual select patterns

**Deliverable 4 — Playwright E2E Tests** (root):
- **Setup**: `playwright.config.ts`, `e2e/fixtures/auth.ts`, `e2e/fixtures/test-data.ts`
- **7 test suites** (~36 tests):
  - `auth.spec.ts` (5) — login, wrong password, empty fields, session persistence, protected routes
  - `channel-crud.spec.ts` (8) — list, create, validation, edit, toggle, delete, search, pagination
  - `channel-deploy.spec.ts` (5) — deploy, start, stop, pause/resume, undeploy
  - `message-flow.spec.ts` (3) — create TCP/MLLP channel, message browser, detail panel
  - `user-management.spec.ts` (5) — navigate, create, edit role, disable, unlock
  - `code-templates.spec.ts` (6) — navigate, create library, create template, edit, delete template, delete library
  - `global-scripts.spec.ts` (4) — navigate, enter deploy script, persist on refresh, preprocessor tab
- Config: single worker, chromium only, `reuseExistingServer` for local dev, ports 18661/18662 for E2E message flow

### Key decisions:
- D-035: Playwright at monorepo root (E2E spans server + web + DB)
- D-036: `reuseExistingServer` for local dev (avoids port conflicts)
- D-037: TCP/MLLP E2E uses ports 18661/18662 (avoids conflict with engine E2E on 17661/17662)
- D-038: Single Playwright worker, sequential tests (healthcare data integrity)
- D-039: Optimistic locking for code templates (same revision pattern as channels)

### Build notes:
- Drizzle dual select mock: when service uses both `db.select().from(table)` (no `.where()`) and `db.select().from(table).where()`, mock must use thenable pattern with call index counter
- Removed unused `SCRIPT_KEYS` constant (ESLint max-warnings 0)

### Verification:
- `pnpm build` — 0 errors across all packages
- `pnpm lint` — 0 warnings
- `pnpm test` — **420 tests passing** (72 schema + 68 HL7 + 71 engine + 49 connectors + 160 server)

### What's next:
- Alert system (configurable notifications on channel events/errors)
- File connector, Database connector
- DICOM connector, FHIR connector
- Filters/transformers in pipeline
- HL7 parser integration into sandbox context

## 2026-02-28 — Engine Pipeline Completion

### What was done:
- **Filter/Transformer compilation** (`engine`):
  - `compileFilterRulesToScript()` — compiles filter rules into JavaScript boolean expression
  - `compileTransformerStepsToScript()` — sequences transformer steps into executable script
  - Filter/transformer data loaded from DB at deploy time (`loadFilterTransformerData()`)
  - Source + destination filter/transformer execution in pipeline stages 2a/2b/7a/7b
- **Code template injection** (`engine`):
  - `prependTemplates()` in `template-injector.ts` — FUNCTION templates prepended by context
  - Templates injected into filter/transformer scripts before compilation
- **Global scripts** (`engine`):
  - Global deploy/undeploy/preprocessor/postprocessor scripts executed at appropriate lifecycle points
- **HL7 bridge functions** (`engine`):
  - `parseHL7()` and `createACK()` injected into sandbox context as closure-based proxies
  - Available to user scripts in filters, transformers, and all script contexts
- **globalChannelMap** (`engine`):
  - Per-channel persistent `Map<string, unknown>` available across all scripts
  - Map updates tracked in `ExecutionResult.mapUpdates` and applied back after each script
- **destinationSet** (`engine`):
  - Controls which destinations receive a message
  - Proxy-based implementation for cross-realm vm compatibility
  - Available in source transformer scripts
- **71 new engine tests** (71 → 142 total)

### Key decisions:
- VM cross-realm: closure-based proxy objects instead of class instances with private fields
- HL7 `get('MSH.9')` auto-resolves to first subcomponent — use `get('MSH.9.2')` for trigger event
- Only `FUNCTION` type templates are prepended (not `CODE_BLOCK`)

### Verification:
- `pnpm build` — 0 errors
- `pnpm lint` — 0 warnings
- `pnpm test` — **491 tests passing** (72 schema + 68 HL7 + 142 engine + 49 connectors + 160 server)

### What's next:
- Filter/transformer CRUD API + UI
- Alerts, file/database connectors

## 2026-03-01 — Filter/Transformer CRUD + UI (Phase 7)

### What was done:

**Deliverable 1 — Zod Schemas** (`core-models`):
- `filter.schema.ts` — `filterRuleInputSchema` (type: JAVASCRIPT/RULE_BUILDER, operator: AND/OR, script, field/condition/values for rule builder), `filterInputSchema` (connectorId, metaDataId, rules array)
- `transformer.schema.ts` — `transformerStepInputSchema` (type: JAVASCRIPT/MAPPER/MESSAGE_BUILDER, script, sourceField/targetField/defaultValue/mapping), `transformerInputSchema` (connectorId, metaDataId, data types, properties, templates, steps)
- Extended `createChannelSchema` and `updateChannelSchema` with optional `filters` and `transformers` arrays
- Updated `schemas/index.ts` exports
- **25 new schema tests** (12 filter + 13 transformer)

**Deliverable 2 — Channel Service CRUD** (`server`):
- New interfaces: `ChannelFilterDetail`, `ChannelFilterRuleDetail`, `ChannelTransformerDetail`, `ChannelTransformerStepDetail`
- Extended `ChannelDetail` with `filters` and `transformers` readonly arrays
- Extended `fetchChannelRelations()` from 4 to 8 parallel queries (+ filters, filterRules, transformers, transformerSteps)
- Grouping logic using `Map<string, T[]>` for assembling rules by filterId and steps by transformerId
- Filter/transformer sync in `updateChannel()`: delete-and-reinsert pattern with metaDataId-based connectorId resolution
- Destination insert now uses `.returning()` to capture new IDs for `destIdByMetaDataId` Map
- **12 new service tests**

**Deliverable 3 — Source Filter/Transformer UI** (`web`):
- `FilterRuleEditor.tsx` — shared component: accordion with name, type dropdown, operator, enabled toggle, Monaco editor (JS) or field/condition/values (Rule Builder)
- `TransformerStepEditor.tsx` — shared component: accordion with name, type dropdown, enabled toggle, Monaco editor (JS/Message Builder) or mapper fields (Mapper)
- `SourceFilterSection.tsx` — accordion section with rule list, add/remove/reorder
- `SourceTransformerSection.tsx` — accordion section with inbound/outbound data type dropdowns, step list
- Updated `SourceTab.tsx` with filter/transformer sections between connector and response settings
- Updated `source/types.ts` with `FilterRuleFormValues`, `TransformerStepFormValues`, `FilterFormValues`, `TransformerFormValues` + factory functions
- Updated `ChannelEditorPage.tsx` with filter/transformer state, loading, change handlers

**Deliverable 4 — Destination Filter/Transformer UI** (`web`):
- `DestinationFilterSection.tsx` — reuses `FilterRuleEditor`, scoped to destination
- `DestinationTransformerSection.tsx` — reuses `TransformerStepEditor`, scoped to destination
- Updated `DestinationSettingsPanel.tsx` with filter/transformer accordion sections
- Updated `destinations/types.ts` — added filter/transformer to `DestinationFormValues`
- Updated `connector-defaults.ts` — default empty filter/transformer
- Updated `ChannelEditorPage.tsx` — destination filter/transformer embedded in `DestinationFormValues`, `buildFiltersPayload()` and `buildTransformersPayload()` with metaDataId mapping
- Updated `use-channels.ts` — extended `ChannelDetail` interface with filters/transformers

### Key decisions:
- D-040: MetaDataId-based connectorId resolution — UI sends destination array index + 1 as metaDataId, server resolves to actual connector UUID after destination reinsert via `.returning()` + `destIdByMetaDataId` Map
- D-041: Destination filter/transformer embedded in `DestinationFormValues` — simpler than separate Maps, all destination state in one place
- D-042: Shared filter/transformer editor components — `FilterRuleEditor` and `TransformerStepEditor` reused by both source and destination sections

### Build notes:
- Mock `.returning()` chain: `Object.assign(Promise.resolve(undefined), { returning: mockFn })`
- Web `ChannelDetail` in `use-channels.ts` must be updated separately from server type (mirrors server)
- Type assertions needed for `buildFiltersPayload()`/`buildTransformersPayload()` return types

### Verification:
- `pnpm build` — 0 errors across all packages
- `pnpm lint` — 0 warnings
- `pnpm test` — **528 tests passing** (97 schema + 68 HL7 + 142 engine + 49 connectors + 172 server)

### What's next:
- Alert system (API + UI)
- File connector, Database connector
- Persistent message store (Drizzle-backed, replacing in-memory)

## 2026-03-01 — Alerts System (Phase 8)

### What was done:

**Alert Zod Schemas** (`core-models`):
- `alert.schema.ts` — TRIGGER/ACTION const objects, trigger types (ERROR/STATUS_CHANGE/QUEUE_THRESHOLD), action types (EMAIL/LOG/CHANNEL/WEBHOOK), CRUD schemas (createAlertSchema, updateAlertSchema, alertIdParamSchema, alertListQuerySchema, patchAlertEnabledSchema)
- **37 schema tests**

**Alert Service** (`server`):
- `AlertService` — 6 static methods: `list` (with enabled/channelId filters), `getById`, `create`, `update` (optimistic locking), `delete`, `setEnabled`
- Returns `Result<T>` pattern, validates NOT_FOUND/ALREADY_EXISTS/CONFLICT errors
- **21 service tests**

**Alert Controller + Routes** (`server`):
- `AlertController` — 6 static methods mapping service results to HTTP responses
- Routes: GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id`, PATCH `/:id/enabled`
- Permissions: `alerts:read` for GET, `alerts:write` for mutations

**Alert UI** (`web`):
- `AlertsPage.tsx` — Table with name, enabled toggle, trigger type, action count, channel count, edit/delete
- `AlertEditorPage.tsx` — Tabbed editor: General + Trigger + Channels + Actions + Templates sections
- `use-alerts.ts` — TanStack Query hooks with query key hierarchy
- API client: AlertSummary, AlertDetail interfaces + 6 API methods

### Key decisions:
- Alerts CRUD follows same pattern as channels (optimistic locking, setEnabled toggle)
- Trigger/action configs stored as JSON objects in the DB
- No alert evaluation engine yet — alerts are data-only for now

### Verification:
- `pnpm build` — 0 errors
- `pnpm lint` — 0 warnings
- `pnpm test` — **586 tests passing** (134 schema + 68 HL7 + 142 engine + 49 connectors + 193 server)

### What's next:
- Events system (HIPAA audit log)
- Settings system (server configuration)
- Event emission from services

## 2026-03-01 — File/Database Connectors + Message Store (Phases 10-12)

### What was done:

**E2E Test Fixes:**
- `channel-crud.spec.ts`: Click `<a>` link in table row instead of row element
- `code-templates.spec.ts`: Added `test.beforeAll` API cleanup of stale `'E2E Test Library'` data
- `alerts.spec.ts`: Added `test.beforeAll` API cleanup, replaced `.catch()` with `toBeEnabled` assertion
- `AlertEditorPage.tsx`: Added `useRef` guard to prevent form reset on TanStack Query refetch

**File Connector (Phase 10)** (`connectors`):
- `FileReceiver` — Poll-based source: directory listing, glob matching (*, ?), file age filtering, sort (NAME/DATE/SIZE), post-processing (DELETE/MOVE/NONE), charset + binary mode
- `FileDispatcher` — Destination: output filename pattern substitution (`${messageId}`, `${timestamp}`, `${originalFilename}`), temp-file-then-rename, append mode, directory auto-creation
- `FileSourceForm.tsx` + `FileDestinationForm.tsx` — MUI configuration forms
- Registered in connector registry + defaults maps
- **50 connector tests** (29 receiver + 21 dispatcher)

**Database Connector (Phase 11)** (`connectors`):
- `DatabaseReceiver` — Poll-based source: parameterized SELECT query via pg pool, row-to-JSON message conversion, update modes (NEVER/ALWAYS/ON_SUCCESS)
- `DatabaseDispatcher` — Destination: parameterized query execution via QueryBuilder, transaction support (BEGIN/COMMIT/ROLLBACK), return generated keys
- `QueryBuilder.prepare(template, context)` — Converts `${variable}` to positional `$1, $2, ...` params. **No string interpolation of values into SQL — SQL injection safe.**
- `ConnectionPool` — pg.Pool wrapper with create/query/acquireClient/destroy, connectivity verification
- `DatabaseSourceForm.tsx` + `DatabaseDestinationForm.tsx` — MUI configuration forms
- Added `pg` + `@types/pg` dependencies
- Registered in connector registry + defaults maps
- **67 connector tests** (13 query-builder + 12 pool + 22 receiver + 20 dispatcher)

**Partition Manager (Phase 12)** (`server`):
- `PartitionManagerService` — Create/drop/check table partitions per channel (messages, connector_messages, message_content, message_statistics, message_attachments, message_custom_metadata)
- Wired into `ChannelService.create()` and `ChannelService.delete()` (non-fatal warnings on failure)
- **11 service tests**

**Data Pruner (Phase 12)** (`server`):
- `DataPrunerService` — `pruneChannel(id, maxAgeDays)`, `pruneAll()` (iterates pruning-enabled channels), `getStatistics()` (prunable counts per channel)
- `DataPrunerController` + routes at `POST /api/v1/admin/prune` (admin only)
- Dependency-order deletion: attachments → custom_metadata → content → connector_messages → messages
- **17 service tests**

**Queue Manager (Phase 12)** (`server`):
- `QueueManagerService` — `dequeue(channelId, metaDataId, batchSize)` with `FOR UPDATE SKIP LOCKED`, `release(channelId, messageId, metaDataId, newStatus)`, `requeueFailed(channelId, maxRetries)`, `getQueueDepth(channelId, metaDataId)`
- Atomic claiming for concurrent consumers
- **15 service tests**

**Lint Fixes:**
- Fixed 26 pre-existing `no-explicit-any` errors: replaced `(req as any).user?.id` with `req.user?.id` (Express Request already augmented)

### Key decisions:
- D-048: File connector uses `node:fs/promises` only (no SFTP/S3/SMB in v1)
- D-049: Simple glob matching for file connector (*, ? wildcards)
- D-050: PostgreSQL only for database connector (consistent with D-005)
- D-051: QueryBuilder parameterized binding (security-first)
- D-052: Partition-per-channel for message tables
- D-053: Data pruner as admin API (not cron) for v1
- D-054: Queue manager uses FOR UPDATE SKIP LOCKED

### Verification:
- `pnpm build` — 0 errors across all packages
- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test` — **825 tests passing** (184 schema + 68 HL7 + 142 engine + 166 connectors + 265 server)

### What's next:
- DICOM connector, FHIR connector
- Alert evaluation engine (trigger evaluation, action dispatch)
- Channel import/export

## 2026-03-01 — P2 Connectors + Channel Operations (Phase 13)

### What was done:

**Unit 1 — JavaScript Connector (Source + Destination)** (`connectors`):
- `JavaScriptReceiver` — Poll-based source. Executes user script via `ScriptRunner` callback on interval. Script returns string or array of strings, each dispatched as a `RawMessage`. Re-entrance protection via `polling` flag.
- `JavaScriptDispatcher` — Destination. Executes user script with `msg` (content) and `connectorMessage` in scope via `DestScriptRunner` callback. Script return value becomes response content.
- UI forms: `JavaScriptSourceForm.tsx` (script textarea + polling interval), `JavaScriptDestinationForm.tsx` (script textarea)
- **32 tests** (16 receiver + 16 dispatcher)

**Unit 2 — SMTP Connector (Destination Only)** (`connectors`):
- `SmtpDispatcher` — Email delivery destination with `SmtpTransport` abstraction for testability. Template variable substitution (`${msg}`, `${messageId}`, `${channelId}`, `${metaDataId}`) in subject/body. `createNodemailerTransport()` factory for production use.
- UI form: `SmtpDestinationForm.tsx` (2-column: SMTP server settings + email composition)
- Added `nodemailer` + `@types/nodemailer` dependencies
- **25 tests**

**Unit 3 — Channel Connector (Source + Destination)** (`connectors`):
- `ChannelReceiver` — Registers in static channel registry on start, unregisters on stop/halt/undeploy.
- `ChannelDispatcher` — Looks up target channel in registry, dispatches message with source metadata in `sourceMap`. `waitForResponse` config controls response vs messageId return.
- `channel-registry.ts` — Static `Map<string, ChannelDispatchCallback>` for zero-network-overhead inter-channel routing.
- UI forms: `ChannelSourceForm.tsx` (info alert, no config needed), `ChannelDestinationForm.tsx` (target channel ID + wait toggle)
- **25 tests** (9 receiver + 16 dispatcher)

**Unit 4 — FHIR R4 Connector (Destination Only)** (`connectors`):
- `FhirDispatcher` — FHIR REST API client using native `fetch`. Auth types: NONE, BASIC, BEARER, API_KEY. URL construction (`${baseUrl}/${resourceType}`), format-aware headers (application/fhir+json or +xml).
- Exported helpers: `buildFhirUrl()`, `buildHeaders()` for testability.
- UI form: `FhirDestinationForm.tsx` (2-column: FHIR server + auth settings)
- **~20 tests**

**Unit 5 — Channel Import/Export** (`core-models`, `server`, `web`):
- `channel-export.schema.ts` — Zod schemas: `channelExportSchema` (version, exportedAt, channels array with full detail), `channelImportSchema` (+ collision mode: SKIP | OVERWRITE | CREATE_NEW)
- `ChannelExportService` — `exportChannel(id)`, `exportAll()` with `channelToExportEntry()` mapper
- `ChannelImportService` — `importChannels(entries, collisionMode, context)` with SKIP/OVERWRITE/CREATE_NEW handling, relation insert (scripts, destinations, metadata columns, filters, transformers)
- Controller + routes: GET `/channels/export`, GET `/channels/:id/export`, POST `/channels/import`
- UI: `ExportButton.tsx` (blob download), `ImportDialog.tsx` (file picker, collision mode, preview)
- Updated `ChannelsPage.tsx` with Export/Import buttons
- **14 tests** (9 export + 5 import)

**Unit 6 — Alert Evaluation Engine** (`engine`):
- `alert-evaluator.ts` — `evaluateAlerts(event, alerts)` matches channel errors against triggers (channel scope, error type, regex pattern). Returns matched alerts.
- `action-dispatcher.ts` — `dispatchActions(alert, event, deps)` executes LOG and CHANNEL actions. `substituteAlertTemplate()` for variable replacement. EMAIL action deferred (logged as warning).
- `alert-manager.ts` — `AlertManager` class: `loadAlerts()`, `handleEvent()`, `resetAlert()`. Internal throttle state (reAlertIntervalMs, maxAlerts tracking).
- Added `PipelineConfig.onError` callback + `AlertEventHandler` type to `message-processor.ts` for pipeline integration.
- **~37 tests** (15 evaluator + 10 dispatcher + 12 manager)

**Shared file updates (Units 1-4):**
- `registry.ts` — Added JAVASCRIPT, SMTP, CHANNEL, FHIR factories to source/destination Maps
- `connectors/src/index.ts` — Added re-exports for all 4 new connector modules
- Source `connector-defaults.ts` — Added JAVASCRIPT_SOURCE_DEFAULTS, CHANNEL_SOURCE_DEFAULTS
- Dest `connector-defaults.ts` — Added JAVASCRIPT_DEST_DEFAULTS, SMTP_DEST_DEFAULTS, CHANNEL_DEST_DEFAULTS, FHIR_DEST_DEFAULTS
- `ConnectorSettingsSection.tsx` — Added JAVASCRIPT, CHANNEL form mappings
- `DestinationConnectorSettings.tsx` — Added JAVASCRIPT, SMTP, CHANNEL, FHIR form mappings

### Key decisions:
- D-055: JavaScript connector uses callback injection (ScriptRunner/DestScriptRunner) — testable without vm sandbox dependency
- D-056: SMTP connector uses SmtpTransport abstraction — dependency injection for testability, `createNodemailerTransport()` for production
- D-057: Channel connector uses static registry for in-memory routing — zero network overhead for inter-channel pipelines
- D-058: FHIR connector destination-only for v1 — FHIR subscription source deferred
- D-059: Channel import collision modes: SKIP, OVERWRITE, CREATE_NEW — covers all migration workflows
- D-060: Alert evaluation with throttle/max-alerts — prevents alert storms from noisy channels
- D-061: DICOM connector deferred — requires dcmtk.js native bindings and DIMSE protocol, too complex for this batch

### Build notes:
- `exactOptionalPropertyTypes`: FhirAuthConfig optional properties need `| undefined` suffix
- nodemailer: added as runtime dependency + @types/nodemailer as dev dependency
- channel-export.service.ts: `readonly string[] | null` → `string[] | null` via spread `[...r.values]`
- Express route mount ordering: `/channels/export` routes mounted BEFORE greedy `/:id` channel routes

### Verification:
- `pnpm build` — 0 errors across all packages
- `pnpm lint` — 0 warnings
- `pnpm test` — **995 tests passing** (184 schema + 68 HL7 + 182 engine + 282 connectors + 279 server)

### What's next:
- DICOM connector (dedicated phase — requires dcmtk.js native bindings)
- Persistent message store (Drizzle-backed, replacing in-memory)
- Wire alert manager into engine manager for runtime alert evaluation
- FHIR subscription source connector

## 2026-03-01 — Test Coverage Backfill

### What was done:

**Manual Test Documentation (9 new docs, +183 scenarios):**
- `09-dashboard.md` (18 scenarios) — Summary cards, channel status table, quick actions, auto-refresh, empty/error states
- `10-message-browser.md` (20 scenarios) — Navigation, message table, search/filter, pagination, detail panel, empty/error states
- `11-users.md` (21 scenarios) — User list, create/edit/enable/disable/unlock, change password, validation
- `12-code-templates.md` (19 scenarios) — Page layout, library CRUD, template CRUD, template editor, validation
- `13-global-scripts.md` (12 scenarios) — Page layout, script editing, persistence, dirty tracking, tab switching
- `14-filter-transformer.md` (29 scenarios) — Source filter/transformer, destination filter/transformer, persistence
- `15-alerts.md` (27 scenarios) — Alert list, create/edit/enable/disable/delete, editor sections, unsaved changes
- `16-events.md` (18 scenarios) — Events table, filters, detail panel, purge, empty/error states
- `17-settings.md` (19 scenarios) — Category tabs, setting display, type-aware inputs, edit/save, dirty tracking

**Playwright E2E Specs (4 new specs, +21 tests):**
- `dashboard.spec.ts` (4 tests) — Navigate, default page, summary cards, channel status table
- `alerts.spec.ts` (7 tests) — Navigate, create, edit, toggle enabled, delete, empty state, validation
- `events.spec.ts` (5 tests) — Navigate, login events appear, expand detail, filter by level, purge dialog
- `settings.spec.ts` (5 tests) — Navigate, default settings visible, switch tabs, edit/save, boolean toggle

**Test data fixture updated:**
- Added `TEST_ALERT` constant to `e2e/fixtures/test-data.ts`

### Totals after backfill:
- Manual test docs: 13 → 22 files, ~172 → ~355 scenarios
- Playwright E2E: 7 → 11 specs, ~36 → ~57 tests

### What's next:
- File connector, Database connector
- DICOM connector, FHIR connector
- Persistent message store (Drizzle-backed, replacing in-memory)

## 2026-03-01 — Events & Settings Systems (Phase 9)

### What was done:

**Deliverable 0 — Event Zod Schemas** (`core-models`):
- `event.schema.ts` — EVENT_NAME const object (17 event types), `eventListQuerySchema` (paginated + filtered), `eventIdParamSchema`, `createEventInputSchema`, `purgeEventsSchema`
- **32 schema tests**

**Deliverable 1 — Event Service** (`server`):
- `EventService` — 4 static methods: `list` (paginated + filtered by level/name/outcome/userId/channelId/date range), `getById`, `create`, `purge` (delete older than N days)
- Dynamic WHERE via `and()` + `inArray()` for comma-separated filters
- `buildWhereConditions()` helper splits comma-separated level/name filters
- **18 service tests**

**Deliverable 2 — Event Controller + Routes** (`server`):
- `EventController` — 3 static methods: list, getById, purge
- Routes: GET `/events` (events:read), GET `/events/:id` (events:read), DELETE `/events` (settings:write)
- No POST endpoint — events are created internally via `emitEvent()` only

**Deliverable 3 — Events Page UI** (`web`):
- `EventsPage.tsx` — Filter bar + paginated MUI table + expandable detail rows + purge dialog
- `EventFilterBar.tsx` — Level dropdown, event name selector, outcome toggle, date range, channel filter
- `EventDetailPanel.tsx` — Attributes JSON viewer in Collapse panel
- Level/Outcome colored chips, date formatting, truncated UUIDs
- `use-events.ts` — useEvents(params), useEvent(id), usePurgeEvents() hooks

**Deliverable 4 — Settings Zod Schemas** (`core-models`):
- `setting.schema.ts` — SETTING_TYPE const object, `upsertSettingSchema`, `bulkUpsertSettingsSchema`, `settingsListQuerySchema`, `settingKeyParamSchema`
- **18 schema tests**

**Deliverable 5 — Settings Service** (`server`):
- `SettingsService` — 5 static methods: `list` (optional category filter), `getByKey`, `upsert` (Drizzle onConflictDoUpdate), `bulkUpsert` (transaction), `delete`
- **11 service tests**

**Deliverable 6 — Settings Controller + Routes** (`server`):
- `SettingsController` — 5 static methods: list, getByKey, upsert, bulkUpsert, delete
- Routes: GET `/settings` (settings:read), GET `/settings/:key` (settings:read), PUT `/settings/bulk` (settings:write), PUT `/settings/:key` (settings:write), DELETE `/settings/:key` (settings:write)
- `/bulk` route placed before `/:key` to avoid route conflict

**Deliverable 7 — Settings Page UI** (`web`):
- `SettingsPage.tsx` — Category tabs (All/General/Security/Features), type-aware inputs (text/number/Switch/JSON multiline), dirty tracking + bulk save
- `use-settings.ts` — useSettings(category?), useSetting(key), useUpsertSetting(), useBulkUpsertSettings(), useDeleteSetting() hooks

**Deliverable 8 — Event Emission from Existing Services** (`server`):
- `event-emitter.ts` — `emitEvent()` fire-and-forget helper + `AuditContext` interface
- 8 services modified to emit audit events after successful write operations:
  - `auth.service.ts` → USER_LOGIN, USER_LOGIN_FAILED
  - `channel.service.ts` → CHANNEL_CREATED, CHANNEL_UPDATED, CHANNEL_DELETED
  - `deployment.service.ts` → CHANNEL_DEPLOYED, CHANNEL_UNDEPLOYED, CHANNEL_STARTED, CHANNEL_STOPPED, CHANNEL_PAUSED
  - `user.service.ts` → USER_CREATED, USER_UPDATED, USER_DELETED
  - `settings.service.ts` → SETTINGS_CHANGED
  - `code-template.service.ts` → CODE_TEMPLATE_UPDATED
  - `global-script.service.ts` → GLOBAL_SCRIPT_UPDATED
  - `alert.service.ts` → ALERT_UPDATED
- 7 controllers updated to pass AuditContext (`{ userId, ipAddress }`) from `req.user`/`req.ip`
- All service test files mock `event-emitter.js` to isolate event emission

### Key decisions:
- D-043: Events are server-generated, not user-created. No `POST /events` endpoint. Prevents fake audit entries.
- D-044: Fire-and-forget event emission. Non-blocking — original operations never fail due to event recording.
- D-045: Event purge via `DELETE /events?olderThanDays=N`. Admin-only (settings:write permission).
- D-046: Settings use upsert by key (onConflictDoUpdate). No separate create/update endpoints.
- D-047: AuditContext passed as explicit parameter to services — not AsyncLocalStorage. Testable, KISS.

### Build notes:
- `exactOptionalPropertyTypes` in settings controller: conditionally construct `{ category }` argument
- EVENT_LEVEL/EVENT_OUTCOME already in constants.ts — only EVENT_NAME + schemas in event.schema.ts
- `vi.mock('../../lib/event-emitter.js')` required in all 7 affected service test files

### Verification:
- `pnpm build` — 0 errors across all packages
- `pnpm lint` — 0 warnings
- `pnpm test` — **665 tests passing** (184 schema + 68 HL7 + 142 engine + 49 connectors + 222 server)

### What's next:
- File connector, Database connector
- DICOM connector, FHIR connector
- Persistent message store (Drizzle-backed, replacing in-memory)

## 2026-03-01 — Phase 14: Production Integration & CLI Foundation

### What was done:

**Unit 1 — Engine Manager Integration: Alerts + JavaScript Connector Wiring** (`server`):
- Wired `AlertManager` into `EngineManager.deploy()` — loads enabled alerts from DB, filters by channel scope, creates AlertManager instance, passes `onError` callback to `PipelineConfig`
- Wired JavaScript source/destination connectors to sandbox executor via `ScriptRunner`/`DestScriptRunner` callbacks — compiles scripts with esbuild, executes in vm sandbox
- Added `alertManager` to `DeployedChannel` interface
- `undeploy()` now clears alert throttle state
- Three new private methods: `wireJavaScriptSource()`, `wireJavaScriptDestinations()`, `loadAlertsForChannel()`
- **20 integration tests** covering alert loading, JS wiring, undeploy cleanup

**Unit 2 — Wire Email Alert Action to SMTP** (`engine`):
- Added `EmailSender` callback type to `ActionDispatcherDeps` (dependency injection pattern)
- Replaced EMAIL action stub with actual email sending — builds subject from template or default, calls `emailSender` callback, logs warning on failure/missing sender
- Added `LOG` action type to `AlertAction.actionType` union (`'EMAIL' | 'CHANNEL' | 'LOG'`)
- Implemented `LOG` case — writes structured warning with alertId, alertName, channelId
- Exported `EmailSender` type from `@mirthless/engine`
- **8 new tests** (email send, template substitution, no recipients, no sender, sender failure, LOG action)

**Unit 3 — CLI Foundation** (`cli`):
- Full commander-based CLI: `mirthless` with global `--url` and `--token` options
- `ApiClient` class — HTTP client with Bearer auth, JSON serialization, 204 handling
- Output formatters — `formatTable` (ASCII column-aligned), `formatJson`, `printError`, `printSuccess`
- Commands: `channels list|get`, `deploy|undeploy|start|stop|halt|pause|resume|status`, `export|import`, `users list`, `login`
- Config persistence at `~/.mirthless/config.json`
- Added `commander` dependency, `vitest` devDependency, `bin` field in package.json
- **22 tests** (11 output + 11 API client)

**Unit 4 — Channel Clone API + UI** (`server` + `web`):
- `ChannelService.clone(id, newName, context)` — loads source channel, builds `CreateChannelInput` (copies all fields: properties, scripts, destinations, metadata columns), delegates to `create()`, emits clone event with `clonedFrom` attribute. Cloned channels start disabled.
- `ChannelController.clone()` — HTTP adapter returning 201
- `POST /:id/clone` route with `channels:write` permission, validates `{ name: z.string().min(1).max(255) }`
- `useCloneChannel()` TanStack Query mutation hook
- Clone button (ContentCopy icon) in channels table, clone dialog with name field pre-filled "Copy of {name}"
- **11 tests** (clone success, properties/scripts/destinations/metadata copied, not found, duplicate name, disabled by default)

**Unit 5 — Manual Test Documentation** (`docs/testing`):
- 6 new manual test checklist files:
  - `20-javascript-connector.md` — 28 scenarios
  - `21-smtp-connector.md` — 30 scenarios
  - `22-channel-connector.md` — 26 scenarios
  - `23-fhir-connector.md` — 37 scenarios
  - `24-channel-export-import.md` — 27 scenarios
  - `25-alert-evaluation.md` — 33 scenarios
- **181 total new scenarios** (620 cumulative)

### Key decisions:
- D-062: AlertManager created per channel deployment — each channel gets scoped alerts, simpler lifecycle
- D-063: JavaScript connector wiring via closure-based ScriptRunner — engine compiles/executes on demand
- D-064: EmailSender as dependency injection callback — same pattern as ChannelSender, transport-agnostic
- D-065: CLI uses `~/.mirthless/config.json` for persistent config
- D-066: Channel clone starts disabled — prevents accidental duplicate routing
- D-067: CLI communicates via HTTP API — same endpoints as web UI

### Verification:
- `pnpm build` — 0 errors across all 7 packages
- `pnpm lint` — 0 warnings
- `pnpm test` — **1,055 tests passing** (184 schema + 68 HL7 + 189 engine + 282 connectors + 310 server + 22 CLI)
- `node packages/cli/dist/index.js --help` — CLI help displays all commands correctly

### What's next:
- DICOM connector (dedicated phase — requires dcmtk.js native bindings)
- Persistent message store (Drizzle-backed, replacing in-memory)
- Wire emailSender callback in server startup (nodemailer transport → AlertManager deps)
- E2E tests for clone and CLI (requires running server + DB)
