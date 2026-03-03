# 54 — Keyboard Shortcuts Manual Test Checklist

## Help Dialog
- [ ] Press `?` on any page → help dialog opens
- [ ] Dialog lists all shortcuts
- [ ] Press Escape → dialog closes

## Navigation Shortcuts
- [ ] Press `g` then `d` → navigates to Dashboard
- [ ] Press `g` then `c` → navigates to Channels
- [ ] Press `g` then `s` → navigates to Settings
- [ ] Press `g` then `a` → navigates to Alerts
- [ ] Press `g` then `u` → navigates to Users
- [ ] Timeout: press `g`, wait 1s, then `d` → does NOT navigate (prefix expired)

## Input Guard
- [ ] Focus on text input, press `?` → types `?` in input (shortcut ignored)
- [ ] Focus on textarea, press `g` then `d` → types normally (shortcut ignored)
- [ ] Focus on Monaco editor, press `?` → no help dialog (shortcut ignored)
