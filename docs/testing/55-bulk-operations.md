# 55 — Bulk Operations Manual Test Checklist

## Checkbox Selection
- [ ] Flat view shows checkboxes on each channel row
- [ ] Clicking checkbox toggles selection (visual check mark)
- [ ] Header checkbox selects/deselects all visible channels
- [ ] Header shows indeterminate state when some (not all) are selected

## Floating Toolbar
- [ ] Selecting 1+ channels → floating toolbar appears at bottom center
- [ ] Toolbar shows count ("3 selected")
- [ ] "Deploy" button fires deploy action for all selected
- [ ] "Start" button fires start action for all selected
- [ ] "Stop" button fires stop action for all selected
- [ ] "Undeploy" button fires undeploy action for all selected
- [ ] X button clears selection and hides toolbar
- [ ] Deselecting all channels hides toolbar

## Edge Cases
- [ ] Search filter → then select → only filtered channels affected
- [ ] Switch to grouped view → selection is preserved but checkboxes not shown
- [ ] Switch back to flat view → selection state is maintained
