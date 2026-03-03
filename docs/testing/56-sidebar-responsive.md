# 56 — Sidebar & Responsive Manual Test Checklist

## Sidebar Grouping
- [ ] Sidebar shows 5 section headings: Overview, Channels, Configuration, Administration, System
- [ ] Each section contains correct items:
  - Overview: Dashboard, Channels, Messages
  - Channels: Channel Groups, Tags, Code Templates, Global Scripts, Resources
  - Configuration: Alerts, Settings, Global Map, Config Map, Certificates
  - Administration: Users, Events
  - System: System Info, Tools, Extensions
- [ ] Active nav item is highlighted with primary color border
- [ ] Collapsed sidebar shows dividers instead of headings

## Collapsed Mode
- [ ] Click hamburger menu → sidebar collapses to icon-only
- [ ] Tooltips appear on hover over icons in collapsed mode
- [ ] Click hamburger again → sidebar expands with labels

## Mobile Responsive
- [ ] Resize browser to mobile width (<900px) → sidebar becomes overlay
- [ ] Hamburger menu opens/closes drawer
- [ ] Clicking nav item closes drawer automatically
- [ ] Clicking outside drawer closes it
- [ ] Main content takes full width on mobile

## Dark/Light Theme Toggle
- [ ] Sun/Moon icon visible in AppBar
- [ ] Click toggle → theme switches immediately
- [ ] Refresh page → theme persists (localStorage)
- [ ] Tooltip shows "Switch to light mode" / "Switch to dark mode"
