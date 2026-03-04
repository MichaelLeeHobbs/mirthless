# 62 — Centralized Notification System

## Notification Store

- [ ] `notify('message', 'success')` shows green Snackbar
- [ ] `notify('message', 'error')` shows red Snackbar
- [ ] `notify('message', 'warning')` shows orange Snackbar
- [ ] `notify('message', 'info')` shows blue Snackbar
- [ ] Notification auto-dismisses after ~4 seconds
- [ ] Close button dismisses notification immediately
- [ ] Multiple rapid notifications show sequentially

## Migration — No Per-Page Snackbars

- [ ] CodeTemplatePage: save/delete actions use centralized notification (no local Snackbar)
- [ ] GlobalScriptsPage: save action uses centralized notification
- [ ] MessageBrowserPage: actions use centralized notification
- [ ] No `<Snackbar>` JSX in migrated pages

## Global Provider

- [ ] NotificationSnackbar renders at app root (visible on all pages)
- [ ] Notifications appear regardless of current page
- [ ] Navigating between pages does not lose pending notifications
