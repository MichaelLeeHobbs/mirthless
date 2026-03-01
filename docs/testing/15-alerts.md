# 15 — Alerts

## Prerequisites
- Logged in as admin

## Alerts List

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Table displays alerts | Navigate to Alerts page | Table visible with columns: Name, Trigger Type, Channels, Actions, Enabled | |
| 2 | Trigger type chip | View alert row | Trigger type shown as outlined chip | |
| 3 | Channel count | View alert with assigned channels | Channel count column shows correct number | |
| 4 | Action count | View alert with actions | Action count column shows correct number | |
| 5 | Enabled chip | View alert row | Enabled status chip visible (clickable) | |
| 6 | Pagination | Create >10 alerts | Pagination controls appear and work | |
| 7 | Empty state | Delete all alerts | "No alerts" message or empty table displayed | |

## Create Alert

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 8 | Navigate to editor | Click "Create Alert" button | Navigates to alert editor page | |
| 9 | Fill name | Enter alert name in Name field | Field accepts input | |
| 10 | Name required | Leave name empty → click Create | Validation error shown | |
| 11 | Description optional | Leave description empty → submit | Alert creates successfully | |
| 12 | Click Create | Fill name → click Create | Alert created, redirected to list, alert visible | |

## Edit Alert

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 13 | Open editor | Click Edit (pencil icon) on alert row | Navigates to editor with form populated | |
| 14 | Form populated | Open edit for existing alert | Name, description, enabled, trigger, channels, actions all loaded | |
| 15 | Update fields | Change description → Save | Changes persisted, success message shown | |

## Enable/Disable

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 16 | Toggle via chip | Click Enabled chip on alert row | Status toggles (enabled ↔ disabled) | |
| 17 | Chip color updates | Toggle enabled | Chip color changes to reflect new status | |

## Delete Alert

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 18 | Delete confirmation | Click Delete (trash icon) on alert row | Confirmation dialog appears ("Delete Alert") | |
| 19 | Cancel delete | Click Cancel in confirmation dialog | Alert retained in list | |
| 20 | Confirm delete | Click Delete in confirmation dialog | Alert removed from list | |

## Alert Editor Sections

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 21 | General section | View alert editor | Name, Description, Enabled switch visible | |
| 22 | Trigger section | View alert editor | Trigger type selector and type-specific config visible | |
| 23 | Channels section | View alert editor | Channel selector for associating channels | |
| 24 | Actions section | View alert editor | Action type selector for adding actions | |

## Unsaved Changes

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 25 | Navigate away warning | Edit form → click sidebar link | "Unsaved Changes" dialog appears | |
| 26 | Stay on page | Click Stay in dialog | Stays on editor with changes intact | |
| 27 | Leave page | Click Leave in dialog | Navigates away, changes discarded | |
