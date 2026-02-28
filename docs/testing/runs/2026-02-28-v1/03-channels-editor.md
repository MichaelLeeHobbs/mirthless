# 03 — Channel Editor (General + Summary Tab)

> Editor page behavior, navigation guards, and Summary tab fields.

## General Behavior

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
| 3.11 | Long name truncates in header   | Edit channel with 255-char name                                  | Title truncated with ellipsis, full name on hover                    | pass   |       |

## Summary Tab

| #    | Scenario                         | Steps                                                 | Expected                                                                | Result | Notes |
|------|----------------------------------|-------------------------------------------------------|-------------------------------------------------------------------------|--------|-------|
| 3.12 | Name field required              | Clear the name field, click Save                      | Validation error "Name is required" shown                               | pass   |       |
| 3.13 | Name max length                  | Enter 256+ characters in name field                   | Validation error "Max 255 characters" shown                             | pass   |       |
| 3.14 | Description field                | Enter multiline description, save, reload             | Description persists correctly                                          | pass   |       |
| 3.15 | Channel ID displayed (edit mode) | Open existing channel                                 | Channel ID (UUID) shown in read-only field                              | pass   |       |
| 3.16 | Copy channel ID                  | Click copy icon next to Channel ID                    | UUID copied to clipboard (paste to verify)                              | pass   |       |
| 3.17 | Revision displayed (edit mode)   | Open existing channel                                 | Revision number shown in read-only field                                | pass   |       |
| 3.18 | Channel ID/Revision hidden (new) | Open new channel editor                               | Channel ID and Revision fields not visible                              | pass   |       |
| 3.19 | Inbound data type dropdown       | Click Inbound Data Type                               | Shows: RAW, HL7V2, HL7V3, XML, JSON, DICOM, DELIMITED, FHIR             | pass   |       |
| 3.20 | Outbound data type dropdown      | Click Outbound Data Type                              | Same options as inbound                                                 | pass   |       |
| 3.21 | Source connector type dropdown   | Click Source Connector Type                           | Shows: TCP_MLLP, HTTP, FILE, DATABASE, JAVASCRIPT, CHANNEL, DICOM, FHIR | pass   |       |
| 3.22 | Initial state dropdown           | Click Initial State on Deploy                         | Shows: STARTED, STOPPED, PAUSED                                         | pass   |       |
| 3.23 | Data types persist               | Change inbound to JSON, outbound to XML, save, reload | Both values persist correctly                                           | pass   |       |
