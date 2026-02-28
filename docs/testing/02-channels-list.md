# 02 — Channel List Page

> Channel list display, search, and CRUD actions from the list view.

## List Display

| #   | Scenario                   | Steps                                  | Expected                                                           | Result | Notes |
|-----|----------------------------|----------------------------------------|--------------------------------------------------------------------|--------|-------|
| 2.1 | List page loads            | Navigate to `/channels`                | Page loads without errors, table header visible                    |        |       |
| 2.2 | Empty state                | With no channels in DB                 | Empty state message or empty table displayed                       |        |       |
| 2.3 | Channels displayed         | Create a channel first, then view list | Channel appears in table with name, enabled status, connector type |        |       |
| 2.4 | Long name truncates        | Create channel with 255-char name      | Name truncated with ellipsis, full name on hover                   |        |       |
| 2.5 | Long description truncates | Create channel with long description   | Description truncated to 2 lines max                               |        |       |

## CRUD Actions

| #    | Scenario                    | Steps                                            | Expected                                                       | Result | Notes |
|------|-----------------------------|--------------------------------------------------|----------------------------------------------------------------|--------|-------|
| 2.6  | New Channel dialog opens    | Click "New Channel" button                       | Dialog appears with name field and Create button               |        |       |
| 2.7  | Create channel from dialog  | Enter a name in the dialog, click Create         | Dialog closes, navigated to channel editor for the new channel |        |       |
| 2.8  | Create channel — empty name | Open dialog, leave name empty, click Create      | Validation error prevents creation                             |        |       |
| 2.9  | Toggle enabled/disabled     | Click the enable/disable toggle on a channel row | Channel enabled state toggles, visual indicator updates        |        |       |
| 2.10 | Delete channel              | Click delete on a channel, confirm in dialog     | Channel removed from list                                      |        |       |
