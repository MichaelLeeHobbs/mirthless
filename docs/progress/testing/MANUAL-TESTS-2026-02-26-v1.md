# Manual Test Checklist

> Run through these scenarios after each significant change. Record your results in the
**Result** and **Notes** columns.
>
> **Legend**: PASS | FAIL | SKIP | BLOCKED
>
> **Prerequisites**: Docker running (`pnpm docker:up`), DB migrated and seeded (
`pnpm db:migrate && pnpm db:seed`), server + web running (`pnpm dev`).

## Test Run Info

| Field          | Value                   |
|----------------|-------------------------|
| Tester         | Michael                 |
| Date           | 2/26/2026               |
| Branch/Commit  |                         |
| Server URL     | `http://localhost:3000` |
| Web URL        | `http://localhost:5173` |
| Overall Result |                         |

---

## 1. Authentication

| #   | Scenario                     | Steps                                                    | Expected                                     | Result | Notes |
|-----|------------------------------|----------------------------------------------------------|----------------------------------------------|--------|-------|
| 1.1 | Login with valid credentials | Go to `/login`, enter `admin` / `Admin123!`, click Login | Redirected to dashboard, no errors           | pass   |       |
| 1.2 | Login with invalid password  | Enter `admin` / `wrongpassword`, click Login             | Error message displayed, stays on login page | pass   |       |
| 1.3 | Login with empty fields      | Click Login with empty username/password                 | Validation errors shown on required fields   | pass   |       |
| 1.4 | Session persists on refresh  | After login, refresh the browser (F5)                    | Still logged in, not redirected to login     | pass   |       |
| 1.5 | Protected route redirect     | While logged out, navigate to `/channels`                | Redirected to `/login`                       | pass   |       |

---

## 2. Channel List Page

| #   | Scenario                    | Steps                                            | Expected                                                           | Result | Notes |
|-----|-----------------------------|--------------------------------------------------|--------------------------------------------------------------------|--------|-------|
| 2.1 | List page loads             | Navigate to `/channels`                          | Page loads without errors, table header visible                    | pass   |       |
| 2.2 | Empty state                 | With no channels in DB                           | Empty state message or empty table displayed                       | pass   |       |
| 2.3 | Channels displayed          | Create a channel first, then view list           | Channel appears in table with name, enabled status, connector type | pass   |       |
| 2.4 | New Channel dialog opens    | Click "New Channel" button                       | Dialog appears with name field and Create button                   | pass   |       |
| 2.5 | Create channel from dialog  | Enter a name in the dialog, click Create         | Dialog closes, navigated to channel editor for the new channel     | pass   |       |
| 2.6 | Create channel — empty name | Open dialog, leave name empty, click Create      | Validation error prevents creation                                 | pass   |       |
| 2.7 | Toggle enabled/disabled     | Click the enable/disable toggle on a channel row | Channel enabled state toggles, visual indicator updates            | pass   |       |
| 2.8 | Delete channel              | Click delete on a channel, confirm in dialog     | Channel removed from list                                          | pass   |       |
| 2.9 | Click channel row to edit   | Click on a channel name/row                      | Navigated to `/channels/:id` editor page                           | pass   |       |

---

## 3. Channel Editor — General

| #    | Scenario                        | Steps                                                            | Expected                                                             | Result | Notes |
|------|---------------------------------|------------------------------------------------------------------|----------------------------------------------------------------------|--------|-------|
| 3.1  | New channel editor loads        | Navigate via New Channel dialog                                  | Editor loads with "New Channel" title, empty form, Create button     | pass   |       |
| 3.2  | Edit channel loads              | Click existing channel from list                                 | Editor loads with channel name as title, form populated, Save button | pass   |       |
| 3.3  | Back button navigates to list   | Click back arrow in editor header                                | Navigated to `/channels` list                                        | pass   |       |
| 3.4  | Save button disabled when clean | Open existing channel (no changes)                               | Save button is disabled                                              | pass   |       |
| 3.5  | Save button enabled on change   | Modify any field                                                 | Save button becomes enabled                                          | pass   |       |
| 3.6  | Save success message            | Edit a field and click Save                                      | Green "Channel saved successfully" alert appears, clears after 3s    | pass   |       |
| 3.7  | Unsaved changes — stay          | Modify a field, click back arrow, click "Stay" in dialog         | Dialog closes, still on editor, changes preserved                    | pass   |       |
| 3.8  | Unsaved changes — leave         | Modify a field, click back arrow, click "Leave" in dialog        | Navigated to list, changes discarded                                 | pass   |       |
| 3.9  | Enabled/disabled badge          | Toggle enabled on Summary tab                                    | Badge in header updates (Enabled/Disabled with correct color)        | pass   |       |
| 3.10 | Tab navigation                  | Click each tab: Summary, Source, Destinations, Scripts, Advanced | Correct tab content displays for each                                | pass   |       |

---

## 4. Channel Editor — Summary Tab

| #    | Scenario                         | Steps                                                 | Expected                                                                | Result | Notes                                                                                     |
|------|----------------------------------|-------------------------------------------------------|-------------------------------------------------------------------------|--------|-------------------------------------------------------------------------------------------|
| 4.1  | Name field required              | Clear the name field, click Save                      | Validation error "Name is required" shown                               | pass   |                                                                                           |
| 4.2  | Name max length                  | Enter 256+ characters in name field                   | Validation error "Max 255 characters" shown                             | pass   | Extremely long name breaks page formatting. The issues is the name at the top of the view |
| 4.3  | Description field                | Enter multiline description, save, reload             | Description persists correctly                                          | pass   | Extremely long breaks the Channels summary screen                                         |
| 4.4  | Channel ID displayed (edit mode) | Open existing channel                                 | Channel ID (UUID) shown in read-only field                              | pass   |                                                                                           |
| 4.5  | Copy channel ID                  | Click copy icon next to Channel ID                    | UUID copied to clipboard (paste to verify)                              | pass   |                                                                                           |
| 4.6  | Revision displayed (edit mode)   | Open existing channel                                 | Revision number shown in read-only field                                | pass   |                                                                                           |
| 4.7  | Channel ID/Revision hidden (new) | Open new channel editor                               | Channel ID and Revision fields not visible                              | pass   |                                                                                           |
| 4.8  | Inbound data type dropdown       | Click Inbound Data Type                               | Shows: RAW, HL7V2, HL7V3, XML, JSON, DICOM, DELIMITED, FHIR             | pass   |                                                                                           |
| 4.9  | Outbound data type dropdown      | Click Outbound Data Type                              | Same options as inbound                                                 | pass   |                                                                                           |
| 4.10 | Source connector type dropdown   | Click Source Connector Type                           | Shows: TCP_MLLP, HTTP, FILE, DATABASE, JAVASCRIPT, CHANNEL, DICOM, FHIR | pass   |                                                                                           |
| 4.11 | Initial state dropdown           | Click Initial State on Deploy                         | Shows: STARTED, STOPPED, PAUSED                                         | pass   |                                                                                           |
| 4.12 | Data types persist               | Change inbound to JSON, outbound to XML, save, reload | Both values persist correctly                                           | pass   |                                                                                           |

---

## 5. Channel Editor — Source Tab

### 5a. TCP/MLLP Connector

| #     | Scenario                    | Steps                                                   | Expected                                                                                 | Result | Notes |
|-------|-----------------------------|---------------------------------------------------------|------------------------------------------------------------------------------------------|--------|-------|
| 5a.1  | Default form loads          | Create new channel (default TCP_MLLP), go to Source tab | TCP/MLLP form displayed with defaults: host `0.0.0.0`, port `6661`, max connections `10` |        |       |
| 5a.2  | Host field editable         | Change host to `127.0.0.1`                              | Field updates                                                                            |        |       |
| 5a.3  | Port field — valid value    | Change port to `2575`                                   | Field accepts the value                                                                  |        |       |
| 5a.4  | Port field — min/max        | Try port `0` and `65536`                                | Validation prevents values outside 1-65535                                               |        |       |
| 5a.5  | Max connections field       | Change to `20`                                          | Field accepts the value                                                                  |        |       |
| 5a.6  | Keep connection open switch | Toggle the switch off and on                            | Switch state changes visually                                                            |        |       |
| 5a.7  | Charset dropdown            | Click charset field                                     | Shows: UTF-8, ISO-8859-1, US-ASCII                                                       |        |       |
| 5a.8  | Transmission mode dropdown  | Click transmission mode field                           | Shows: MLLP, RAW, DELIMITED                                                              |        |       |
| 5a.9  | Receive timeout field       | Set to `30000`                                          | Field accepts the value                                                                  |        |       |
| 5a.10 | Buffer size field           | Set to `131072`                                         | Field accepts the value                                                                  |        |       |
| 5a.11 | Settings persist on save    | Modify several fields, save, reload page                | All TCP/MLLP settings preserved exactly                                                  |        |       |

### 5b. HTTP Connector

| #    | Scenario                     | Steps                                                                  | Expected                                                                         | Result | Notes |
|------|------------------------------|------------------------------------------------------------------------|----------------------------------------------------------------------------------|--------|-------|
| 5b.1 | Switch to HTTP connector     | On Summary tab, change Source Connector Type to HTTP, go to Source tab | HTTP form displayed with defaults: host `0.0.0.0`, port `8080`, context path `/` |        |       |
| 5b.2 | Host field editable          | Change host to `0.0.0.0`                                               | Field updates                                                                    |        |       |
| 5b.3 | Port field                   | Change port to `9090`                                                  | Field accepts the value                                                          |        |       |
| 5b.4 | Context path field           | Change to `/api/messages`                                              | Field accepts the value                                                          |        |       |
| 5b.5 | Allowed methods multi-select | Click methods field, select GET and POST                               | Both methods shown as chips                                                      |        |       |
| 5b.6 | Response status code         | Change to `202`                                                        | Field accepts the value                                                          |        |       |
| 5b.7 | Response content type        | Change to `application/json`                                           | Field updates                                                                    |        |       |
| 5b.8 | Settings persist on save     | Modify several fields, save, reload page                               | All HTTP settings preserved exactly                                              |        |       |

### 5c. Connector Type Switching

| #    | Scenario                          | Steps                                                      | Expected                                                            | Result | Notes |
|------|-----------------------------------|------------------------------------------------------------|---------------------------------------------------------------------|--------|-------|
| 5c.1 | Type change resets properties     | Configure TCP/MLLP settings, switch to HTTP on Summary tab | Source tab shows HTTP form with HTTP defaults, TCP/MLLP values gone |        |       |
| 5c.2 | Unsupported connector placeholder | Change to FILE connector on Summary tab, go to Source tab  | Shows "FILE connector settings are not yet available" message       |        |       |
| 5c.3 | Type change marks form dirty      | Switch connector type                                      | Save button becomes enabled                                         |        |       |

### 5d. Response Settings

| #    | Scenario               | Steps                              | Expected                                                                                              | Result | Notes |
|------|------------------------|------------------------------------|-------------------------------------------------------------------------------------------------------|--------|-------|
| 5d.1 | Response mode dropdown | On Source tab, click Response Mode | Shows: NONE, AUTO_BEFORE, AUTO_AFTER_TRANSFORMER, AUTO_AFTER_DESTINATIONS, POSTPROCESSOR, DESTINATION |        |       |
| 5d.2 | Response mode persists | Change to NONE, save, reload       | Value persists as NONE                                                                                |        |       |
| 5d.3 | Default response mode  | Create new channel                 | Response mode defaults to AUTO_AFTER_DESTINATIONS                                                     |        |       |

---

## 6. Placeholder Tabs

| #   | Scenario                     | Steps                  | Expected                             | Result | Notes |
|-----|------------------------------|------------------------|--------------------------------------|--------|-------|
| 6.1 | Destinations tab placeholder | Click Destinations tab | Shows placeholder message (no crash) |        |       |
| 6.2 | Scripts tab placeholder      | Click Scripts tab      | Shows placeholder message (no crash) |        |       |
| 6.3 | Advanced tab placeholder     | Click Advanced tab     | Shows placeholder message (no crash) |        |       |

---

## 7. Data Round-Trip (End-to-End)

| #   | Scenario                       | Steps                                                                                   | Expected                                                                                                                                 | Result | Notes |
|-----|--------------------------------|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|--------|-------|
| 7.1 | Full channel creation          | Create channel via dialog → fill Summary fields → configure Source (TCP/MLLP) → Save    | Channel saved, all data visible on reload                                                                                                |        |       |
| 7.2 | Full channel edit              | Open existing channel → change name, description, data types, connector settings → Save | All changes persist on reload                                                                                                            |        |       |
| 7.3 | API returns correct data       | After save, check `GET /api/v1/channels/:id` response                                   | Response includes all fields: name, description, enabled, data types, connector type, connector properties, initial state, response mode |        |       |
| 7.4 | DB stores connector properties | After save, check DB: `SELECT source_connector_properties FROM channels WHERE id = :id` | JSONB column contains the connector settings object                                                                                      |        |       |

---

## 8. Build Verification

| #   | Scenario     | Steps            | Expected                       | Result | Notes |
|-----|--------------|------------------|--------------------------------|--------|-------|
| 8.1 | `pnpm build` | Run `pnpm build` | 0 errors, all packages compile | pass   |       |
| 8.2 | `pnpm lint`  | Run `pnpm lint`  | 0 warnings                     | pass   |       |
| 8.3 | `pnpm test`  | Run `pnpm test`  | All tests pass (60+)           | pass   |       |

---

## Issues Found

> Record any bugs, unexpected behavior, or suggestions discovered during testing.

| # | Severity | Section | Description | Steps to Reproduce | Status |
|---|----------|---------|-------------|--------------------|--------|
|   |          |         |             |                    |        |
|   |          |         |             |                    |        |
|   |          |         |             |                    |        |

---

## Error Logs
### Error Log 1
```
Uncaught Error: useBlocker must be used within a data router.  See https://reactrouter.com/v6/routers/picking-a-router.
    at invariant (react-router-dom.js?v=0b258814:207:11)
    at useDataRouterContext (react-router-dom.js?v=0b258814:4279:17)
    at useBlocker (react-router-dom.js?v=0b258814:4361:7)
    at ChannelEditorPage (ChannelEditorPage.tsx:132:19)
    at renderWithHooks (chunk-7D3XZ434.js?v=0b258814:11594:26)
    at mountIndeterminateComponent (chunk-7D3XZ434.js?v=0b258814:14972:21)
    at beginWork (chunk-7D3XZ434.js?v=0b258814:15960:22)
    at HTMLUnknownElement.callCallback2 (chunk-7D3XZ434.js?v=0b258814:3678:22)
    at Object.invokeGuardedCallbackDev (chunk-7D3XZ434.js?v=0b258814:3703:24)
    at invokeGuardedCallback (chunk-7D3XZ434.js?v=0b258814:3737:39)
invariant @ react-router-dom.js?v=0b258814:207
useDataRouterContext @ react-router-dom.js?v=0b258814:4279
useBlocker @ react-router-dom.js?v=0b258814:4361
ChannelEditorPage @ ChannelEditorPage.tsx:132
renderWithHooks @ chunk-7D3XZ434.js?v=0b258814:11594
mountIndeterminateComponent @ chunk-7D3XZ434.js?v=0b258814:14972
beginWork @ chunk-7D3XZ434.js?v=0b258814:15960
callCallback2 @ chunk-7D3XZ434.js?v=0b258814:3678
invokeGuardedCallbackDev @ chunk-7D3XZ434.js?v=0b258814:3703
invokeGuardedCallback @ chunk-7D3XZ434.js?v=0b258814:3737
beginWork$1 @ chunk-7D3XZ434.js?v=0b258814:19816
performUnitOfWork @ chunk-7D3XZ434.js?v=0b258814:19249
workLoopSync @ chunk-7D3XZ434.js?v=0b258814:19188
renderRootSync @ chunk-7D3XZ434.js?v=0b258814:19167
recoverFromConcurrentError @ chunk-7D3XZ434.js?v=0b258814:18784
performConcurrentWorkOnRoot @ chunk-7D3XZ434.js?v=0b258814:18732
workLoop @ chunk-7D3XZ434.js?v=0b258814:195
flushWork @ chunk-7D3XZ434.js?v=0b258814:174
performWorkUntilDeadline @ chunk-7D3XZ434.js?v=0b258814:382Understand this error
chunk-7D3XZ434.js?v=0b258814:14078 The above error occurred in the <ChannelEditorPage> component:

    at ChannelEditorPage (http://localhost:5173/src/pages/ChannelEditorPage.tsx:64:18)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4129:5)
    at Outlet (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4535:26)
    at main
    at http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:2319:45
    at Box3 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:5310:19)
    at div
    at http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:2319:45
    at Box3 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:5310:19)
    at AppLayout (http://localhost:5173/src/components/layout/AppLayout.tsx:92:20)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4129:5)
    at Outlet (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4535:26)
    at ProtectedRoute (http://localhost:5173/src/components/layout/ProtectedRoute.tsx:24:27)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4129:5)
    at Routes (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4599:5)
    at Router (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4542:15)
    at BrowserRouter (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:5288:5)
    at DefaultPropsProvider (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6617:3)
    at RtlProvider (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6593:3)
    at ThemeProvider2 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6549:5)
    at ThemeProvider3 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6744:5)
    at ThemeProviderNoVars (http://localhost:5173/node_modules/.vite/deps/chunk-KXN63DQP.js?v=0b258814:273:10)
    at ThemeProvider (http://localhost:5173/node_modules/.vite/deps/chunk-KXN63DQP.js?v=0b258814:355:3)
    at QueryClientProvider (http://localhost:5173/node_modules/.vite/deps/@tanstack_react-query.js?v=0b258814:3166:3)
    at QueryProvider (http://localhost:5173/src/providers/QueryProvider.tsx:30:33)
    at App (http://localhost:5173/src/App.tsx:32:21)
```

### Error Log 2
```
use-channels.ts:161 Uncaught (in promise) Error: Failed to parse server response
    at Object.mutationFn (use-channels.ts:161:15)
mutationFn	@	use-channels.ts:161
await in execute		
handleDeleteConfirm	@	ChannelsPage.tsx:96
```

### Error Log 3
```

invariant @ react-router-dom.js?v=0b258814:207
useDataRouterContext @ react-router-dom.js?v=0b258814:4279
useBlocker @ react-router-dom.js?v=0b258814:4361
ChannelEditorPage @ ChannelEditorPage.tsx:132
renderWithHooks @ chunk-7D3XZ434.js?v=0b258814:11594
mountIndeterminateComponent @ chunk-7D3XZ434.js?v=0b258814:14972
beginWork @ chunk-7D3XZ434.js?v=0b258814:15960
callCallback2 @ chunk-7D3XZ434.js?v=0b258814:3678
invokeGuardedCallbackDev @ chunk-7D3XZ434.js?v=0b258814:3703
invokeGuardedCallback @ chunk-7D3XZ434.js?v=0b258814:3737
beginWork$1 @ chunk-7D3XZ434.js?v=0b258814:19816
performUnitOfWork @ chunk-7D3XZ434.js?v=0b258814:19249
workLoopSync @ chunk-7D3XZ434.js?v=0b258814:19188
renderRootSync @ chunk-7D3XZ434.js?v=0b258814:19167
recoverFromConcurrentError @ chunk-7D3XZ434.js?v=0b258814:18784
performSyncWorkOnRoot @ chunk-7D3XZ434.js?v=0b258814:18930
flushSyncCallbacks @ chunk-7D3XZ434.js?v=0b258814:9164
(anonymous) @ chunk-7D3XZ434.js?v=0b258814:18675Understand this error
chunk-7D3XZ434.js?v=0b258814:14078 The above error occurred in the <ChannelEditorPage> component:

    at ChannelEditorPage (http://localhost:5173/src/pages/ChannelEditorPage.tsx:64:18)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4129:5)
    at Outlet (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4535:26)
    at main
    at http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:2319:45
    at Box3 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:5310:19)
    at div
    at http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:2319:45
    at Box3 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:5310:19)
    at AppLayout (http://localhost:5173/src/components/layout/AppLayout.tsx:92:20)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4129:5)
    at Outlet (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4535:26)
    at ProtectedRoute (http://localhost:5173/src/components/layout/ProtectedRoute.tsx:24:27)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4129:5)
    at Routes (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4599:5)
    at Router (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:4542:15)
    at BrowserRouter (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=0b258814:5288:5)
    at DefaultPropsProvider (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6617:3)
    at RtlProvider (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6593:3)
    at ThemeProvider2 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6549:5)
    at ThemeProvider3 (http://localhost:5173/node_modules/.vite/deps/chunk-3Z4V7POG.js?v=0b258814:6744:5)
    at ThemeProviderNoVars (http://localhost:5173/node_modules/.vite/deps/chunk-KXN63DQP.js?v=0b258814:273:10)
    at ThemeProvider (http://localhost:5173/node_modules/.vite/deps/chunk-KXN63DQP.js?v=0b258814:355:3)
    at QueryClientProvider (http://localhost:5173/node_modules/.vite/deps/@tanstack_react-query.js?v=0b258814:3166:3)
    at QueryProvider (http://localhost:5173/src/providers/QueryProvider.tsx:30:33)
    at App (http://localhost:5173/src/App.tsx:32:21)

Consider adding an error boundary to your tree to customize error handling behavior.
Visit https://reactjs.org/link/error-boundaries to learn more about error boundaries.
```

## Sign-Off

| Role      | Name | Date | Approved |
|-----------|------|------|----------|
| Tester    |      |      |          |
| Developer |      |      |          |
