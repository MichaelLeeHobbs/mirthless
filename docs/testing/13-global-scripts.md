# 13 — Global Scripts

## Prerequisites
- Logged in as admin

## Page Layout

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Four tabs visible | Navigate to Global Scripts page | Deploy, Undeploy, Preprocessor, Postprocessor tabs shown | |
| 2 | Monaco editor loads | View any tab | Monaco editor instance visible | |
| 3 | Save button visible | View page | Save button present in toolbar | |

## Script Editing

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 4 | Enter code in Deploy tab | Click Deploy tab, type code in editor | Code appears in editor | |
| 5 | Switch tabs retains code | Enter code in Deploy, switch to Undeploy, switch back | Deploy tab code retained | |
| 6 | Save script | Enter code → click Save | Success message displayed | |

## Persistence

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 7 | Script persists after reload | Save script → refresh page | Script content still present in editor | |
| 8 | Each tab independent | Save code in Deploy, save different code in Preprocessor | Both retain their own content after reload | |

## Dirty Tracking

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 9 | Edit enables save | Edit script content | Save button becomes enabled/active | |
| 10 | Navigate away warning | Edit script → click sidebar link | Unsaved changes warning dialog appears | |
| 11 | Cancel navigation | Unsaved changes dialog → click Stay | Stays on Global Scripts page with edits intact | |
| 12 | Confirm navigation | Unsaved changes dialog → click Leave | Navigates away, unsaved changes discarded | |
