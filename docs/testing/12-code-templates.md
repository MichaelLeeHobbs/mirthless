# 12 — Code Templates

## Prerequisites
- Logged in as admin

## Page Layout

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Two-panel layout | Navigate to Code Templates page | Left panel (library tree) and right panel visible | |
| 2 | Initial right panel | No template selected | Right panel shows "Select a template" or similar placeholder | |

## Library CRUD

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 3 | Create library | Click Library button → fill name/description → Create | Library appears in tree | |
| 4 | Edit library name | Select library → edit name → Save | Name updated in tree | |
| 5 | Edit library description | Select library → edit description → Save | Description updated | |
| 6 | Delete library | Select library → Delete → confirm | Library removed from tree | |
| 7 | Duplicate library name | Create library with existing name | Error or duplicate allowed (verify behavior) | |

## Template CRUD

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 8 | Create template | Click Template button (with library selected) | New template appears under library in tree | |
| 9 | Select template | Click template in tree | Editor panel loads with template data | |
| 10 | Edit template name | Change name field → Save | Name updated in tree and editor | |
| 11 | Change template type | Switch between FUNCTION and CODE_BLOCK | Type selector updates | |
| 12 | Edit template code | Type in Monaco editor → Save | Code persisted | |
| 13 | Delete template | Click Delete on template → confirm | Template removed from tree | |

## Template Editor

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 14 | Monaco editor loads | Select a template | Monaco editor visible with template code | |
| 15 | Type selector | View template editor | FUNCTION / CODE_BLOCK selector visible | |
| 16 | Context checkboxes | View template editor | Context checkboxes visible (Source Filter, Source Transformer, etc.) | |
| 17 | Code persistence | Edit code → Save → reload page → select template | Code matches what was saved | |

## Validation

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 18 | Empty library name | Create library with empty name | Validation error or button disabled | |
| 19 | Empty template name | Clear template name → Save | Validation error or rejected | |
