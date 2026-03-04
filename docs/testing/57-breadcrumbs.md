# 57 — Breadcrumbs Manual Test Checklist

## Channel Editor
- [ ] New channel: breadcrumb shows "Channels > New Channel"
- [ ] Edit channel: breadcrumb shows "Channels > {Channel Name}"
- [ ] "Channels" link navigates back to channels list
- [ ] Channel name updates as user types in name field

## Message Browser
- [ ] Breadcrumb shows "Channels > {Channel Name} > Messages"
- [ ] "Channels" link navigates to channels list
- [ ] "{Channel Name}" link navigates to channel editor

## Channel Statistics
- [ ] Breadcrumb shows "Dashboard > Channel Statistics"
- [ ] "Dashboard" link navigates to dashboard

## Alert Editor
- [ ] New alert: breadcrumb shows "Alerts > New Alert"
- [ ] Edit alert: breadcrumb shows "Alerts > {Alert Name}"
- [ ] "Alerts" link navigates back to alerts list

## General
- [ ] Breadcrumbs render as MUI Breadcrumbs component
- [ ] Last item is plain text (not a link)
- [ ] All intermediate items are clickable links
