# 61 — Confirm Dialogs (Replacing window.confirm)

## ConfirmDialog Component

- [ ] Dialog renders with title, message, and two buttons
- [ ] Confirm button color matches severity (warning=orange, error=red, info=blue)
- [ ] Cancel button closes dialog without action
- [ ] Confirm button triggers onConfirm callback
- [ ] isPending=true disables confirm button and shows loading

## CodeTemplatePage

- [ ] Delete library — MUI ConfirmDialog appears (not browser confirm)
- [ ] Cancel delete library — dialog closes, library not deleted
- [ ] Confirm delete library — library deleted, notification shown
- [ ] Delete template — MUI ConfirmDialog appears
- [ ] Cancel delete template — dialog closes, template not deleted
- [ ] Confirm delete template — template deleted, notification shown

## ChannelStatisticsPage

- [ ] Click "Reset Statistics" — MUI ConfirmDialog appears
- [ ] Cancel reset — dialog closes, stats unchanged
- [ ] Confirm reset — statistics reset, notification shown

## GlobalScriptsPage

- [ ] Edit script, then navigate away — MUI ConfirmDialog appears (unsaved changes)
- [ ] Click "Stay" — dialog closes, stay on page
- [ ] Click "Leave" — navigate away, changes discarded

## CertificatesPage

- [ ] Delete certificate — shared ConfirmDialog appears (not inline component)
- [ ] Cancel delete — dialog closes, certificate not deleted
- [ ] Confirm delete — certificate deleted

## No Browser Dialogs

- [ ] No `window.confirm()` calls remain anywhere in the app
- [ ] All confirmation flows use MUI ConfirmDialog
