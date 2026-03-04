# 53 — Context Menus Manual Test Checklist

## Dashboard Context Menu
- [ ] Right-click channel row in flat view → context menu appears at cursor position
- [ ] Menu shows channel name as header
- [ ] "Edit" navigates to channel editor
- [ ] "Messages" navigates to message browser
- [ ] "Statistics" navigates to statistics page
- [ ] Deployment actions are state-aware:
  - [ ] Undeployed → "Deploy" shown
  - [ ] Stopped → "Start" and "Undeploy" shown
  - [ ] Started → "Pause" and "Stop" shown
  - [ ] Paused → "Resume" and "Stop" shown
- [ ] Clicking outside menu closes it
- [ ] Menu disappears after action selected

## Channels List Context Menu
- [ ] Right-click channel row → context menu appears
- [ ] "Edit" navigates to channel editor
- [ ] "Messages" navigates to message browser
- [ ] Deployment actions match current state
- [ ] "Clone" opens clone dialog
- [ ] "Delete" opens delete confirmation
- [ ] Left-click still works for normal interactions
