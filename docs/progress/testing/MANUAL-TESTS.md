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
| Tester         |                         |
| Date           |                         |
| Branch/Commit  |                         |
| Server URL     | `http://localhost:3000` |
| Web URL        | `http://localhost:5173` |
| Overall Result |                         |

---

## 1. Authentication

| #   | Scenario                     | Steps                                                    | Expected                                     | Result | Notes |
|-----|------------------------------|----------------------------------------------------------|----------------------------------------------|--------|-------|
| 1.1 | Login with valid credentials | Go to `/login`, enter `admin` / `Admin123!`, click Login | Redirected to dashboard, no errors           |        |       |
| 1.2 | Login with invalid password  | Enter `admin` / `wrongpassword`, click Login             | Error message displayed, stays on login page |        |       |
| 1.3 | Login with empty fields      | Click Login with empty username/password                 | Validation errors shown on required fields   |        |       |
| 1.4 | Session persists on refresh  | After login, refresh the browser (F5)                    | Still logged in, not redirected to login     |        |       |
| 1.5 | Protected route redirect     | While logged out, navigate to `/channels`                | Redirected to `/login`                       |        |       |

---

## 2. Channel List Page

| #   | Scenario                    | Steps                                            | Expected                                                           | Result | Notes |
|-----|-----------------------------|--------------------------------------------------|--------------------------------------------------------------------|--------|-------|
| 2.1 | List page loads             | Navigate to `/channels`                          | Page loads without errors, table header visible                    |        |       |
| 2.2 | Empty state                 | With no channels in DB                           | Empty state message or empty table displayed                       |        |       |
| 2.3 | Channels displayed          | Create a channel first, then view list           | Channel appears in table with name, enabled status, connector type |        |       |
| 2.4 | New Channel dialog opens    | Click "New Channel" button                       | Dialog appears with name field and Create button                   |        |       |
| 2.5 | Create channel from dialog  | Enter a name in the dialog, click Create         | Dialog closes, navigated to channel editor for the new channel     |        |       |
| 2.6 | Create channel — empty name | Open dialog, leave name empty, click Create      | Validation error prevents creation                                 |        |       |
| 2.7 | Toggle enabled/disabled     | Click the enable/disable toggle on a channel row | Channel enabled state toggles, visual indicator updates            |        |       |
| 2.8 | Delete channel              | Click delete on a channel, confirm in dialog     | Channel removed from list                                          |        |       |
| 2.9 | Click channel row to edit   | Click on a channel name/row                      | Navigated to `/channels/:id` editor page                           |        |       |

---

## 3. Channel Editor — General

| #    | Scenario                        | Steps                                                            | Expected                                                             | Result | Notes |
|------|---------------------------------|------------------------------------------------------------------|----------------------------------------------------------------------|--------|-------|
| 3.1  | New channel editor loads        | Navigate via New Channel dialog                                  | Editor loads with "New Channel" title, empty form, Create button     |        |       |
| 3.2  | Edit channel loads              | Click existing channel from list                                 | Editor loads with channel name as title, form populated, Save button |        |       |
| 3.3  | Back button navigates to list   | Click back arrow in editor header                                | Navigated to `/channels` list                                        |        |       |
| 3.4  | Save button disabled when clean | Open existing channel (no changes)                               | Save button is disabled                                              |        |       |
| 3.5  | Save button enabled on change   | Modify any field                                                 | Save button becomes enabled                                          |        |       |
| 3.6  | Save success message            | Edit a field and click Save                                      | Green "Channel saved successfully" alert appears, clears after 3s    |        |       |
| 3.7  | Unsaved changes — stay          | Modify a field, click back arrow, click "Stay" in dialog         | Dialog closes, still on editor, changes preserved                    |        |       |
| 3.8  | Unsaved changes — leave         | Modify a field, click back arrow, click "Leave" in dialog        | Navigated to list, changes discarded                                 |        |       |
| 3.9  | Enabled/disabled badge          | Toggle enabled on Summary tab                                    | Badge in header updates (Enabled/Disabled with correct color)        |        |       |
| 3.10 | Tab navigation                  | Click each tab: Summary, Source, Destinations, Scripts, Advanced | Correct tab content displays for each                                |        |       |

---

## 4. Channel Editor — Summary Tab

| #    | Scenario                         | Steps                                                 | Expected                                                                | Result | Notes |
|------|----------------------------------|-------------------------------------------------------|-------------------------------------------------------------------------|--------|-------|
| 4.1  | Name field required              | Clear the name field, click Save                      | Validation error "Name is required" shown                               |        |       |
| 4.2  | Name max length                  | Enter 256+ characters in name field                   | Validation error "Max 255 characters" shown                             |        |       |
| 4.3  | Description field                | Enter multiline description, save, reload             | Description persists correctly                                          |        |       |
| 4.4  | Channel ID displayed (edit mode) | Open existing channel                                 | Channel ID (UUID) shown in read-only field                              |        |       |
| 4.5  | Copy channel ID                  | Click copy icon next to Channel ID                    | UUID copied to clipboard (paste to verify)                              |        |       |
| 4.6  | Revision displayed (edit mode)   | Open existing channel                                 | Revision number shown in read-only field                                |        |       |
| 4.7  | Channel ID/Revision hidden (new) | Open new channel editor                               | Channel ID and Revision fields not visible                              |        |       |
| 4.8  | Inbound data type dropdown       | Click Inbound Data Type                               | Shows: RAW, HL7V2, HL7V3, XML, JSON, DICOM, DELIMITED, FHIR             |        |       |
| 4.9  | Outbound data type dropdown      | Click Outbound Data Type                              | Same options as inbound                                                 |        |       |
| 4.10 | Source connector type dropdown   | Click Source Connector Type                           | Shows: TCP_MLLP, HTTP, FILE, DATABASE, JAVASCRIPT, CHANNEL, DICOM, FHIR |        |       |
| 4.11 | Initial state dropdown           | Click Initial State on Deploy                         | Shows: STARTED, STOPPED, PAUSED                                         |        |       |
| 4.12 | Data types persist               | Change inbound to JSON, outbound to XML, save, reload | Both values persist correctly                                           |        |       |

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
| 8.1 | `pnpm build` | Run `pnpm build` | 0 errors, all packages compile |        |       |
| 8.2 | `pnpm lint`  | Run `pnpm lint`  | 0 warnings                     |        |       |
| 8.3 | `pnpm test`  | Run `pnpm test`  | All tests pass (60+)           |        |       |

---

## Issues Found

> Record any bugs, unexpected behavior, or suggestions discovered during testing.

| # | Severity | Section | Description | Steps to Reproduce | Status |
|---|----------|---------|-------------|--------------------|--------|
|   |          |         |             |                    |        |
|   |          |         |             |                    |        |
|   |          |         |             |                    |        |

---

## Sign-Off

| Role      | Name | Date | Approved |
|-----------|------|------|----------|
| Tester    |      |      |          |
| Developer |      |      |          |
