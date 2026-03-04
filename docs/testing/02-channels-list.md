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

## Manage Groups

| #    | Scenario                          | Steps                                                        | Expected                                                          | Result | Notes |
|------|-----------------------------------|--------------------------------------------------------------|-------------------------------------------------------------------|--------|-------|
| 2.11 | Groups button visible             | Navigate to `/channels`                                      | "Groups" button visible in toolbar                                |        |       |
| 2.12 | Open Manage Groups dialog         | Click "Groups" button                                        | Manage Groups dialog opens showing existing groups                |        |       |
| 2.13 | Create group from dialog          | Click "Create Group" in dialog, enter name, click Create     | New group appears in group list                                   |        |       |
| 2.14 | Edit group from dialog            | Click Edit icon on a group, change name, click Save          | Group name updates in list                                        |        |       |
| 2.15 | Delete group from dialog          | Click Delete icon on a group, confirm                        | Group removed from list                                           |        |       |
| 2.16 | Default group not deletable       | Locate "Default" group in Manage Groups dialog               | Delete button disabled or absent for Default group                |        |       |

## Deploy Notification Feedback

| #    | Scenario                          | Steps                                                        | Expected                                                          | Result | Notes |
|------|-----------------------------------|--------------------------------------------------------------|-------------------------------------------------------------------|--------|-------|
| 2.17 | Deploy success toast              | Deploy a channel from the list actions                       | Success toast notification displayed                              |        |       |
| 2.18 | Undeploy success toast            | Undeploy a deployed channel                                  | Success toast notification displayed                              |        |       |
| 2.19 | Deploy error toast                | Attempt deploy with server issue (e.g., invalid channel)     | Error toast notification with reason displayed                    |        |       |

## Send Message Context Menu

| #    | Scenario                          | Steps                                                        | Expected                                                          | Result | Notes |
|------|-----------------------------------|--------------------------------------------------------------|-------------------------------------------------------------------|--------|-------|
| 2.20 | Send Message on started channel   | Right-click a STARTED channel, select "Send Message"         | Send Message dialog opens with Monaco editor                      |        |       |
| 2.21 | Send Message absent for stopped   | Right-click a STOPPED channel                                | "Send Message" option not shown or disabled in context menu       |        |       |
| 2.22 | Send Message absent for undeployed| Right-click an UNDEPLOYED channel                            | "Send Message" option not shown or disabled in context menu       |        |       |
