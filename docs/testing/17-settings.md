# 17 — Settings

## Prerequisites
- Logged in as admin
- Default settings seeded (via db:seed)

## Category Tabs

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Four tabs visible | Navigate to Settings page | All, General, Security, Features tabs displayed | |
| 2 | All tab | Click All tab | Every setting shown regardless of category | |
| 3 | General tab | Click General tab | Only General category settings shown | |
| 4 | Security tab | Click Security tab | Only Security category settings shown | |
| 5 | Features tab | Click Features tab | Only Features category settings shown | |

## Setting Display

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 6 | Setting key | View a setting | Key shown in monospace font | |
| 7 | Setting type | View a setting | Type shown in parentheses (string, number, boolean, json) | |
| 8 | Setting description | View a setting with description | Description text shown below key | |

## Type-Aware Inputs

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 9 | String input | View string-type setting | Text input field rendered | |
| 10 | Number input | View number-type setting | Number input field rendered | |
| 11 | Boolean input | View boolean-type setting | Switch toggle rendered | |
| 12 | JSON input | View JSON-type setting | Multiline textarea with monospace font rendered | |

## Edit & Save

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 13 | Edit enables Save | Change a setting value | Save Changes button becomes enabled | |
| 14 | Bulk save | Change multiple settings → click Save Changes | All changes saved in one request | |
| 15 | Success message | Save settings | Success alert displayed | |
| 16 | Persistence | Save changes → reload page | Values match what was saved | |

## Dirty Tracking

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 17 | Save disabled initially | Navigate to Settings, don't change anything | Save Changes button disabled | |
| 18 | Revert disables save | Change a value, then change it back to original | Save button disabled (if no other changes) | |

## Empty State

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 19 | Empty category | View a category tab with no settings | "No settings in this category" or similar message | |
