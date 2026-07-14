# 53 — Context Menus Manual Test Checklist

## Dashboard Channel Context Menu
- [ ] Right-click a channel row → context menu appears at cursor position
- [ ] Menu shows the channel name as a header
- [ ] "Edit" navigates to the channel editor
- [ ] "Messages" navigates to the message browser
- [ ] No "Statistics" item (stats are dashboard columns now)
- [ ] "Enable"/"Disable" reflects and toggles the channel's enabled flag
- [ ] Deployment actions are state-aware:
  - [ ] Undeployed → "Deploy" shown
  - [ ] Stopped → "Start" and "Undeploy" shown
  - [ ] Started → "Pause" and "Stop" shown
  - [ ] Paused → "Resume" and "Stop" shown
- [ ] "Send Message" shown only when the channel is STARTED
- [ ] "Change Group", "Clone", "Export", "Delete" present
- [ ] Clicking outside the menu closes it
- [ ] Menu disappears after an action is selected

## Dashboard Group Context Menu (grouped view)
- [ ] Right-click a group header → **group** context menu appears (not the channel menu)
- [ ] Menu shows the group name as a header
- [ ] "Deploy all" / "Start all" / "Stop all" / "Undeploy all" act only on applicable channels; a toast summarizes the count
- [ ] "Rename" opens the rename dialog
- [ ] "Delete" opens the delete confirmation
- [ ] Right-clicking the "Ungrouped" section header does NOT open a group menu
- [ ] The hover kebab (⋮) on a group header opens the same group menu
