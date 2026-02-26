# 06 — Web Admin Design

> React + Material UI admin interface: dashboard, channel editor, message browser, and system management.

## Architecture

Connect's admin is a Java Swing desktop app (15,000+ lines of UI code). We replace it entirely with a React SPA.

### Stack

| Layer | Technology |
|---|---|
| Framework | React 18+ with Vite |
| UI Library | Material UI 6 |
| State (server) | TanStack Query (React Query) |
| State (client) | Zustand |
| Routing | React Router v6 |
| Code Editor | Monaco Editor (@monaco-editor/react) |
| Data Tables | TanStack Table |
| Forms | React Hook Form + Zod resolvers |
| Charts | Recharts (lightweight) |
| Date/Time | date-fns + MUI Date Pickers |
| Real-time | Socket.IO client (or polling fallback) |

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  AppBar: Logo, Search, Notifications, User Menu              │
├────────┬─────────────────────────────────────────────────────┤
│        │                                                     │
│  Nav   │  Content Area                                       │
│  Rail  │                                                     │
│        │  ┌───────────────────────────────────────────────┐  │
│  □ Dash│  │  Page-specific content                        │  │
│  □ Chan│  │                                               │  │
│  □ Msgs│  │  (Dashboard / Channel Editor / Messages /     │  │
│  □ Code│  │   Code Templates / Alerts / Events /          │  │
│  □ Alrt│  │   Users / Settings / Extensions /             │  │
│  □ Evnt│  │   Resources / System)                         │  │
│  □ User│  │                                               │  │
│  □ Sett│  │                                               │  │
│  □ Ext │  │                                               │  │
│  □ Rsrc│  │                                               │  │
│  □ Sys │  │                                               │  │
│        │  └───────────────────────────────────────────────┘  │
└────────┴─────────────────────────────────────────────────────┘
```

Navigation rail (MUI `Drawer` with `variant="permanent"`, collapsible) instead of Connect's task-pane sidebar.

---

## Routes

```typescript
const routes = [
  { path: '/',                     element: <DashboardPage /> },
  { path: '/channels',             element: <ChannelListPage /> },
  { path: '/channels/new',         element: <ChannelEditorPage /> },
  { path: '/channels/:id',         element: <ChannelEditorPage /> },
  { path: '/channels/:id/messages', element: <MessageBrowserPage /> },
  { path: '/code-templates',       element: <CodeTemplatePage /> },
  { path: '/alerts',               element: <AlertListPage /> },
  { path: '/alerts/:id',           element: <AlertEditorPage /> },
  { path: '/events',               element: <EventBrowserPage /> },
  { path: '/users',                element: <UserListPage /> },
  { path: '/users/:id',            element: <UserEditorPage /> },
  { path: '/settings',             element: <SettingsPage /> },
  { path: '/global-scripts',       element: <GlobalScriptsPage /> },
  { path: '/extensions',           element: <ExtensionsPage /> },
  { path: '/resources',            element: <ResourcesPage /> },
  { path: '/system',               element: <SystemInfoPage /> },
  { path: '/login',                element: <LoginPage /> },
];
```

---

## Pages

### 1. Dashboard

The landing page. Real-time overview of all channels.

#### Features

- **Channel status table** — DataGrid (TanStack Table) with columns:
  - Status icon (started/stopped/paused/error/deploying)
  - Name (link to channel editor)
  - Source connector type + icon
  - Destination count
  - Received / Filtered / Sent / Errored / Queued counts
  - Last message time
- **Channel groups** — Collapsible group rows (tree-table)
- **Summary cards** — Total channels, running, stopped, errored, messages/sec
- **Quick actions** — Start/stop/deploy via row action menu
- **Tag filter** — Autocomplete chip input to filter by channel tags
- **Search** — Free-text filter on channel name
- **Auto-refresh** — Polling (5s) or WebSocket push for status + statistics

#### Key Differences from Connect

| Connect | Mirthless |
|---|---|
| Swing JXTaskPaneContainer | MUI DataGrid + Summary Cards |
| Manual refresh button | Auto-refresh with configurable interval |
| Desktop-only | Responsive (works on tablet) |

---

### 2. Channel List

Dedicated channel management page (Connect merges this with the dashboard).

#### Features

- **Channel table** — Same structure as dashboard but with management columns (revision, last deployed, last modified)
- **Bulk operations** — Multi-select + toolbar: deploy, undeploy, enable, disable, delete
- **Import/Export** — Upload JSON channel definitions, download selected channels as JSON
- **Clone** — Duplicate a channel with a new name and ID
- **New channel** — Opens channel editor with defaults
- **Channel groups** — Drag-and-drop channel-to-group assignment (or dialog)

---

### 3. Channel Editor

The most complex page. Multi-tab form for complete channel configuration.

#### Tab Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Channel Name: [___________]  Enabled: [✓]  [Save] [Deploy] │
├──────────┬──────────┬──────────────┬─────────┬──────────────┤
│ Summary  │  Source  │ Destinations │ Scripts │  Advanced    │
├──────────┴──────────┴──────────────┴─────────┴──────────────┤
│                                                             │
│  (Tab-specific content)                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Summary Tab

- Channel name, description (text fields)
- Enabled toggle
- Tags (autocomplete chip input)
- Channel ID (read-only, copyable)
- Revision number
- Data types: inbound and outbound selectors
- Initial state on deploy (started / stopped / paused)
- Dependencies (channel multi-select)

#### Source Tab

- **Connector type selector** — Dropdown that dynamically renders the appropriate settings form
- **Connector settings** — Protocol-specific form (varies by type):
  - TCP/MLLP: host, port, TLS, max connections, charset, transmission mode
  - HTTP: host, port, context path, methods, response settings, TLS
  - File: directory, file filter, polling settings, post-processing action
  - Database: driver, URL, SQL query, post-processing update
  - Channel Reader: (no settings)
  - JavaScript: code editor (Monaco)
- **Response settings** — Response mode selector (None, Auto-generate Before/After Transformer/After Destinations, Postprocessor, Destination), response data type, destination selector (when mode is DESTINATION)
- **Source filter** — Filter editor (see Pipeline Editor below)
- **Source transformer** — Transformer editor (see Pipeline Editor below)

#### Destinations Tab

- **Destination list** — Sidebar list of destinations (add, remove, reorder via drag-and-drop)
- **Active destination** — Selected destination's settings:
  - Connector type selector + dynamic settings form (same as source, different options)
  - Queue settings: enabled, retry count, retry interval, rotate queue
  - Wait for previous: chain mode toggle
  - Destination filter + transformer (Pipeline Editor)
  - Response transformer (Pipeline Editor)

#### Scripts Tab

- **Preprocessor** — Monaco editor
- **Postprocessor** — Monaco editor
- **Deploy script** — Monaco editor
- **Undeploy script** — Monaco editor
- **Attachment script** — Monaco editor

Each script has a "Validate" button that sends the code to the server for syntax checking.

#### Advanced Tab

- **Message storage** — Radio: all, error-only, none (per content type)
- **Custom metadata columns** — Editable table: name, type (string/number/boolean/timestamp), mapping expression
- **Message pruning** — Enabled + days to keep + archive toggle
- **Attachment handler** — Type selector + settings
- **Source queue** — Thread count, response timeout

---

### 4. Pipeline Editor (Filter & Transformer)

Reusable component embedded in the Source and Destination tabs.

#### Filter Editor

```
┌─────────────────────────────────────────────────────────────┐
│ Filter Rules                                     [+] [-]    │
├──────┬────────┬──────────────────────────────────────────────┤
│  #   │ Op     │ Rule                                        │
│  1   │        │ JavaScript: msg.MSH?.MSH9?.MSH91 === 'ADT'  │
│  2   │ AND    │ Rule Builder: msg.PID.PID3 exists            │
│  3   │ OR     │ JavaScript: channelMap.get('override')       │
├──────┴────────┴──────────────────────────────────────────────┤
│ Code Editor (Monaco)                                        │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ return msg.MSH?.MSH9?.MSH91 === 'ADT';                  ││
│ └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

- **Rule list** — DataGrid rows with operator (AND/OR), type (JavaScript/Rule Builder), enabled toggle
- **Rule types**:
  - JavaScript: free-form code that returns boolean
  - Rule Builder: visual field/operator/value selector (dropdown + text input)
- **Code editor** — Monaco with TypeScript language support
- **Add/remove/reorder** — Toolbar buttons + drag-and-drop

#### Transformer Editor

```
┌─────────────────────────────────────────────────────────────┐
│ Transformer Steps                                [+] [-]    │
├──────┬──────────────────────────────────────────────────────┤
│  #   │ Step                                                 │
│  1   │ Mapper: msg.PID.PID5.1 → tmp.patient.lastName        │
│  2   │ JavaScript: tmp.id = generateUUID();                  │
│  3   │ Mapper: msg.PID.PID3.1 → tmp.patient.mrn             │
├──────┴──────────────────────────────────────────────────────┤
│ Code Editor (Monaco)                                        │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ tmp.id = generateUUID();                                 ││
│ └──────────────────────────────────────────────────────────┘│
│                                                             │
│ ┌─ Message Templates ──────────────────────────────────────┐│
│ │ Inbound:              │ Outbound:                        ││
│ │ { MSH: { ... } }      │ { patient: { lastName: '' } }    ││
│ └───────────────────────┴──────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

- **Step list** — Same DataGrid pattern as filter rules
- **Step types**:
  - JavaScript/TypeScript: free-form code
  - Mapper: source field → destination field mapping (visual selector)
  - Message Builder: build output from template + code
  - XSLT: XSLT stylesheet (for XML transforms)
- **Message templates** — Side-by-side preview of inbound (msg) and outbound (tmp) message structure. Helps users see available fields.
- **Inbound/outbound data type selectors** — Control parsing and serialization

---

### 5. Message Browser

Search and inspect messages processed by a channel.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Channel: [Channel Name ▾]                                   │
├─────────────────────────────────────────────────────────────┤
│ Filters: [Date Range] [Status ▾] [Connector ▾] [Search...] │
├─────────────────────────────────────────────────────────────┤
│ Messages                                         Page 1/42  │
│ ┌───┬────────────┬──────────┬────────┬──────────┬─────────┐│
│ │ # │ Message ID │ Status   │ Source │ Received │ Errors  ││
│ │ 1 │ 10042      │ ✓ Sent   │ TCP    │ 12:01:03 │ 0       ││
│ │ 2 │ 10041      │ ✗ Error  │ TCP    │ 12:01:02 │ 1       ││
│ │ 3 │ 10040      │ ◌ Filter │ TCP    │ 12:01:01 │ 0       ││
│ └───┴────────────┴──────────┴────────┴──────────┴─────────┘│
├─────────────────────────────────────────────────────────────┤
│ Message Detail: #10042                                      │
│ ┌──────────┬─────────────┬──────────┬────────────┐         │
│ │ Raw      │ Transformed │ Encoded  │ Response   │         │
│ ├──────────┴─────────────┴──────────┴────────────┤         │
│ │ MSH|^~\&|SRC|FAC|DEST|FAC|20240101120103||...  │         │
│ │                                                 │         │
│ └─────────────────────────────────────────────────┘         │
│ Maps: sourceMap | channelMap | responseMap                   │
│ Errors: (none)                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Features

- **Search filters** — Date range picker, status multi-select, connector filter, free-text content search, metadata column filters
- **Message table** — Paginated (server-side), sortable. Columns: ID, status (icon + text), connector, received date, send attempts, errors
- **Message detail panel** — Bottom panel (collapsible) showing selected message:
  - Content tabs: Raw, Transformed, Encoded, Sent, Response, Response Transformed
  - Syntax highlighting based on data type (HL7, XML, JSON)
  - Maps viewer: expandable JSON tree for sourceMap, channelMap, connectorMap, responseMap
  - Errors: stack trace with line numbers
  - Attachments: list with download links
- **Actions** — Reprocess message, delete message, export messages
- **Bulk operations** — Multi-select: delete, reprocess, export

---

### 6. Code Templates

Tree-based editor for reusable code libraries.

#### Layout

```
┌──────────────────┬──────────────────────────────────────────┐
│ Libraries        │ Template Editor                          │
│ ┌──────────────┐ │ Name: [myHelper]                        │
│ │ ▸ HL7 Helpers│ │ Contexts: [✓ Source] [✓ Dest] [✓ Both]  │
│ │   • parseADT │ │ ┌──────────────────────────────────────┐ │
│ │   • buildACK │ │ │ function parseADT(msg) {             │ │
│ │ ▸ Utilities  │ │ │   const pid = msg.PID;               │ │
│ │   • formatDt │ │ │   return {                           │ │
│ │   • validateM│ │ │     mrn: pid.PID3.PID31,             │ │
│ └──────────────┘ │ │     name: pid.PID5.PID51,            │ │
│ [+ Library]      │ │   };                                 │ │
│ [+ Template]     │ │ }                                    │ │
│                  │ └──────────────────────────────────────┘ │
│                  │ Used by: Channel A, Channel B            │
└──────────────────┴──────────────────────────────────────────┘
```

- **Tree view** — Libraries → Templates hierarchy (MUI TreeView)
- **Template editor** — Name, description, contexts (checkboxes), code (Monaco)
- **Channel usage** — Table showing which channels reference this template
- **Import/export** — JSON format

---

### 7. Alerts

Alert configuration and monitoring.

#### Alert List

- DataGrid: status (enabled/disabled), name, trigger type, last triggered, triggered count
- Quick toggle for enable/disable
- New / Edit / Delete actions

#### Alert Editor

- **Trigger tab** — Channel selector (which channels trigger this alert), trigger type (error, custom JavaScript), condition editor
- **Action tab** — Notification type (email), recipients, subject template, body template (with variable substitution)
- **Settings tab** — Re-alert interval, max alerts per period

---

### 8. Event Browser

Server audit log viewer.

- **Filters** — Date range, event level (info/warn/error), user, outcome (success/failure)
- **Event table** — Paginated DataGrid: date/time, level (colored icon), name, user, outcome, IP address
- **Event detail** — Expandable row or side panel with full attributes JSON

---

### 9. User Management

User CRUD with role assignment.

- **User table** — Username, name, email, role, last login, status (active/locked)
- **User editor** — Dialog or page: username, email, first/last name, role selector, password (set/reset), description
- **Role-based display** — Only admins see this page
- **Bulk operations** — Delete, disable

---

### 10. Settings

Tabbed settings page (admin only).

#### Tabs

| Tab | Content |
|---|---|
| Server | Server name, port, base URL, environment display |
| Security | Password policy (min length, complexity, expiry), session timeout, MFA toggle |
| Email (SMTP) | SMTP host, port, from address, auth, TLS |
| Message Storage | Default retention, archive settings, content removal policies |
| Database | Connection pool status, maintenance tasks |
| Tags | Channel tag CRUD |
| Resources | External resource management |
| Configuration Map | Key-value pairs available to all channels |
| Global Map | View/edit persistent global map entries |

---

### 11. Extensions

Plugin management page (admin only).

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Extensions                                                   │
├─────────────────────────────────────────────────────────────┤
│ Installed Extensions                                         │
│ ┌──────────┬────────────┬──────────┬────────────┬──────────┐│
│ │ Name     │ Version    │ Type     │ Status     │ Actions  ││
│ │ FHIR R4  │ 1.2.0      │ Connector│ ● Enabled  │ [⋮]     ││
│ │ ASTM     │ 0.9.1      │ Connector│ ○ Disabled │ [⋮]     ││
│ │ LDAP Auth│ 1.0.0      │ Auth     │ ● Enabled  │ [⋮]     ││
│ └──────────┴────────────┴──────────┴────────────┴──────────┘│
├─────────────────────────────────────────────────────────────┤
│ Extension Detail: FHIR R4                                    │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ Author: mirthless-contrib      License: MIT               ││
│ │ Description: FHIR R4 client connector for REST endpoints  ││
│ │ Provides: connector (fhir-r4), data type (fhir-bundle)    ││
│ │ Status: Enabled    [Disable]                               ││
│ └───────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

#### Features

- **Extension table** — DataGrid: name, version, type (connector/data-type/auth/transmission-mode), status (enabled/disabled), author
- **Extension detail** — Bottom panel or side drawer showing: description, author, license, capabilities list (what connectors/types it provides), dependencies, configuration options
- **Enable/disable toggle** — Per-extension. Requires engine restart notification (or hot-reload if supported)
- **Capability summary** — At top: count of installed extensions by type (e.g., "3 Connectors, 1 Auth Provider, 2 Data Types")

---

### 12. Resources

Upload and manage external files available to channels (certificates, XSLTs, lookup tables, JARs).

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Resources                                        [Upload]    │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────────┬──────────┬────────┬────────────┬──────────┐│
│ │ Name         │ Type     │ Size   │ Updated    │ Actions  ││
│ │ ca-cert.pem  │ PEM      │ 1.2 KB│ 2025-12-01 │ [⋮]      ││
│ │ lookup.csv   │ CSV      │ 45 KB │ 2025-11-15 │ [⋮]      ││
│ │ transform.xsl│ XSLT     │ 3.8 KB│ 2025-10-22 │ [⋮]      ││
│ └──────────────┴──────────┴────────┴────────────┴──────────┘│
├─────────────────────────────────────────────────────────────┤
│ Resource Detail: ca-cert.pem                                 │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ Description: Root CA certificate for partner SFTP          ││
│ │ MIME Type: application/x-pem-file                          ││
│ │ Size: 1,247 bytes                                          ││
│ │ Used by: Channel "Lab Results", Channel "Radiology Out"    ││
│ │ [Download] [Replace] [Delete]                              ││
│ └───────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

#### Features

- **Upload dialog** — Drag-and-drop or file picker, name field (defaults to filename), optional description
- **Resource table** — DataGrid: name, MIME type, size (formatted), uploaded/updated date, actions menu
- **Resource detail** — Description, MIME type, size, preview (text files shown inline, binary files show hex summary), channel usage list
- **Actions** — Download, replace (upload new version preserving name/ID), delete (with confirmation showing dependent channels)
- **Channel usage** — Shows which channels reference this resource via `getResource()` in their scripts
- **Search/filter** — Name filter, MIME type filter

---

### 13. System Info

Server status, diagnostics, and log viewer.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ System                                                       │
├──────────┬─────────────┬────────────┬──────────┬────────────┤
│ Overview │  Server Logs │ Data Pruner │ Backup   │            │
├──────────┴─────────────┴────────────┴──────────┴────────────┤
│                                                              │
│ (Tab-specific content)                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Overview Tab

System health dashboard:

- **Server info cards** — Server name, version, Node.js version, uptime (formatted), environment
- **Memory usage** — Bar chart: heap used / heap total / RSS. Auto-refresh (10s)
- **Database status** — Connection pool: total / idle / waiting, DB version, migration status
- **Engine status** — Running channels count, total messages processed, worker thread pool utilization

#### Server Logs Tab

Real-time server log viewer (streamed via Socket.IO):

```
┌─────────────────────────────────────────────────────────────┐
│ Log Level: [▾ All]  Search: [__________]  [⏸ Pause] [⬇ DL] │
├─────────────────────────────────────────────────────────────┤
│ 12:03:45.123 INFO  [engine] Channel "ADT Inbound" started   │
│ 12:03:44.891 WARN  [tcp-mllp] Connection timeout from 10.0… │
│ 12:03:44.002 ERROR [sandbox] Script error in "Lab Results":… │
│ 12:03:43.556 INFO  [http] Request POST /api/v1/channels/dep…│
│ 12:03:43.112 DEBUG [engine] Message 10042 routed to 2 dest…  │
│                                                              │
│ ▼ Auto-scroll enabled                                        │
└─────────────────────────────────────────────────────────────┘
```

- **Live streaming** — Socket.IO pushes log entries in real-time. Virtualized list (react-window) for performance
- **Level filter** — Toggle: DEBUG, INFO, WARN, ERROR (multi-select chip toggles)
- **Search** — Free-text filter on log message content
- **Pause/Resume** — Pause auto-scroll to inspect entries, resume to catch up
- **Historical logs** — Paginated API for past logs (date range picker)
- **Download** — Export visible/filtered logs as text file

#### Data Pruner Tab

- **Status** — Current state (idle/running), last run time, next scheduled run
- **Last run summary** — Messages pruned, time elapsed, channels processed
- **Manual trigger** — "Run Now" button (admin only) with confirmation
- **Schedule display** — Current cron expression, next 5 scheduled runs

#### Backup Tab

- **Export** — "Download Backup" button → downloads full server config as JSON
- **Import** — Upload JSON backup file, preview contents (channel count, user count, etc.), confirm to restore
- **Backup contents** — List of what's included: channels, code templates, alerts, global scripts, users, settings, resources

---

## Component Library

### Shared Components

```typescript
// DataGrid with server-side pagination, sorting, filtering
<ServerDataGrid<T>
  queryKey={['channels']}
  queryFn={fetchChannels}
  columns={channelColumns}
  defaultSort={{ field: 'name', direction: 'asc' }}
  onRowClick={handleRowClick}
/>

// Monaco code editor with TypeScript support
<CodeEditor
  language="typescript"
  value={script}
  onChange={setScript}
  height={400}
  readOnly={false}
  minimap={false}
/>

// Status indicator chip
<StatusChip status="STARTED" />  // → green chip with "Started"

// Channel selector (autocomplete)
<ChannelSelector
  value={selectedChannels}
  onChange={setSelectedChannels}
  multiple
/>

// Tag input (autocomplete with chips)
<TagInput
  value={tags}
  onChange={setTags}
  suggestions={allTags}
/>
```

### Connector Settings Forms

Dynamic form rendering based on connector type:

```typescript
const CONNECTOR_FORMS: Record<ConnectorType, React.ComponentType<ConnectorFormProps>> = {
  [CONNECTOR_TYPE.TCP_MLLP]: TcpMllpForm,
  [CONNECTOR_TYPE.HTTP]: HttpForm,
  [CONNECTOR_TYPE.FILE]: FileForm,
  [CONNECTOR_TYPE.DATABASE]: DatabaseForm,
  [CONNECTOR_TYPE.CHANNEL]: ChannelForm,
  [CONNECTOR_TYPE.JAVASCRIPT]: JavaScriptForm,
  [CONNECTOR_TYPE.DICOM]: DicomForm,
  [CONNECTOR_TYPE.FHIR]: FhirForm,
  [CONNECTOR_TYPE.SMTP]: SmtpForm,
};

// Usage in channel editor:
function ConnectorSettings({ type, properties, onChange }: ConnectorSettingsProps) {
  const FormComponent = CONNECTOR_FORMS[type];
  return <FormComponent properties={properties} onChange={onChange} />;
}
```

---

## State Management

### Server State (TanStack Query)

All API data fetched and cached via TanStack Query:

```typescript
// Channel queries
const useChannels = () => useQuery({ queryKey: ['channels'], queryFn: api.getChannels });
const useChannel = (id: ChannelId) => useQuery({ queryKey: ['channels', id], queryFn: () => api.getChannel(id) });
const useChannelStats = () => useQuery({
  queryKey: ['channel-stats'],
  queryFn: api.getChannelStatistics,
  refetchInterval: 5000, // Auto-refresh for dashboard
});

// Mutations with optimistic updates
const useUpdateChannel = () => useMutation({
  mutationFn: api.updateChannel,
  onSuccess: (_, { id }) => {
    queryClient.invalidateQueries({ queryKey: ['channels', id] });
  },
});

// Messages (paginated)
const useMessages = (channelId: ChannelId, filters: MessageFilters) => useQuery({
  queryKey: ['messages', channelId, filters],
  queryFn: () => api.getMessages(channelId, filters),
  keepPreviousData: true, // Smooth pagination
});
```

### Client State (Zustand)

UI-only state that doesn't come from the server:

```typescript
interface AppStore {
  // Navigation
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Channel editor
  unsavedChanges: boolean;
  activeTab: number;
  setActiveTab: (tab: number) => void;

  // Dashboard preferences
  dashboardRefreshInterval: number;
  visibleColumns: ReadonlyArray<string>;
  tagFilter: ReadonlyArray<string>;

  // Notifications
  notifications: ReadonlyArray<Notification>;
  addNotification: (n: Notification) => void;
  dismissNotification: (id: string) => void;
}
```

---

## Real-Time Updates

### Option A: Socket.IO (Preferred)

```typescript
// Client
const socket = io('/ws', { auth: { token: accessToken } });

socket.on('channel:status', (data: { channelId: ChannelId; state: ChannelState }) => {
  queryClient.setQueryData(['channel-stats'], (old) => updateChannelStatus(old, data));
});

socket.on('channel:statistics', (data: ChannelStatisticsUpdate) => {
  queryClient.setQueryData(['channel-stats'], (old) => updateStats(old, data));
});

socket.on('message:new', (data: { channelId: ChannelId; messageId: MessageId }) => {
  // Invalidate message queries if user is viewing this channel
  queryClient.invalidateQueries({ queryKey: ['messages', data.channelId] });
});

// Server log streaming (System page)
socket.on('server:log', (entry: { timestamp: string; level: string; logger: string; message: string }) => {
  // Append to virtualized log list (react-window)
});

// Data pruner status updates
socket.on('pruner:progress', (data: { channelId: ChannelId; pruned: number; total: number }) => {
  queryClient.setQueryData(['pruner-status'], (old) => updatePrunerProgress(old, data));
});
```

### Option B: Polling Fallback

```typescript
// Dashboard auto-refresh via TanStack Query refetchInterval
const useChannelStats = () => useQuery({
  queryKey: ['channel-stats'],
  queryFn: api.getChannelStatistics,
  refetchInterval: 5_000, // 5 seconds
});
```

---

## Theme

MUI 6 theme customization. Dark mode support from day one.

```typescript
const theme = createTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#1976d2' },
        background: { default: '#f5f5f5' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#90caf9' },
        background: { default: '#121212' },
      },
    },
  },
  components: {
    MuiDataGrid: {
      defaultProps: { density: 'compact' },
    },
  },
});
```

Status colors:

| Status | Color |
|---|---|
| STARTED | `success.main` (green) |
| STOPPED | `text.disabled` (grey) |
| PAUSED | `warning.main` (amber) |
| ERROR | `error.main` (red) |
| DEPLOYING | `info.main` (blue) |

---

## Key Differences from Connect

| Aspect | Connect (Swing) | Mirthless (React) |
|---|---|---|
| Platform | Desktop app (Java Swing) | Web app (browser) |
| Real-time | Manual refresh + polling | WebSocket + auto-refresh |
| Code editor | RSyntaxTextArea | Monaco (VS Code engine) |
| Responsiveness | Fixed desktop layout | Responsive (desktop + tablet) |
| Theming | Look-and-feel | MUI theme (light + dark) |
| Data tables | Custom JXTreeTable | TanStack Table + MUI DataGrid |
| Channel config | XML blobs | JSON with Zod validation |
| Plugin UI | Swing panels loaded via reflection | React components per connector type |
| Undo/Redo | None | Form-level with React Hook Form |

---

## Resolved Decisions

1. **Visual pipeline builder: React Flow (P2)** — Tree-table is the default pipeline editor for v1 (familiar to Connect users). A visual node-graph editor using **React Flow** (MIT, 26k+ stars, used by Stripe/Typeform) will be added as an alternative view in P2. React Flow provides drag-drop nodes, custom node types, edge connections with validation, zoom/pan, and minimap — all built on React. Both views edit the same underlying channel model. Node-RED (Apache 2.0) was considered but it's a full runtime, not an embeddable editor component.

2. **Monaco TypeScript definitions for sandbox API** — Yes. Provide custom `.d.ts` type definitions for the sandbox API (`msg`, `tmp`, `rawData`, `sourceMap`, `channelMap`, `connectorMap`, `responseMap`, `$()`, `logger`, `httpFetch`, `dbQuery`, `routeMessage`, HL7 helpers, XML library). These are loaded into Monaco's TypeScript language service, giving users full autocomplete and type checking as they write transformer/filter scripts. Major differentiator over Connect's basic RSyntaxTextArea.

3. **Responsive design: minimal (desktop-first)** — Dashboard is read-only responsive (works on tablet). Channel editor and other complex views are desktop-only. No mobile-specific layouts for v1. Mobile/tablet support could be a plugin or later phase.

4. **No offline support** — Skipped entirely. The server must be running for channels to process messages — there's no meaningful offline workflow. The complexity of offline sync and conflict resolution is not justified. Not planned for any phase.

5. **Diff view: Monaco diff editor** — Yes. Integrate Monaco's built-in diff editor for comparing channel revisions side-by-side. Available from the channel editor (compare current vs. any previous revision) and from the channel list (compare two channels). Major feature that Connect lacks. Channel revisions are already stored (revision integer + full config history), so the data is available.
