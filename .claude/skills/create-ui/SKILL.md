---
name: create-ui
description: Build or change a page, layout or component in packages/web so it follows the visual language, then screenshot it in light, dark and phone and look at the result. Use for any UI change.
---

# Create UI

The rules are in `docs/design/15-visual-language.md`. Read it before a layout change. This skill is the short form plus how to check your work.

## Build

- **Colour and type come from the theme.** Use palette paths in `sx` (`'text.secondary'`, `'divider'`, `'status.critical'`) and `FONT_FAMILY_MONO` from `packages/web/src/styles/tokens.ts` for machine text. Lint fails hex, `rgb()` and inline font stacks in `packages/web/src` outside `styles/`.
- **Status colours mean one thing everywhere.** Decide the level with `lib/status.ts`; render it with `StatusChip` or `StatusDot`. Never use a status colour as decoration.
- **Every page starts with `PageHeader`**: a title, one line saying what the page is for, and one primary button.
- **States are not blank space.** Loading: `TableSkeleton` or `LoadingBlock`. Empty: `EmptyState` with the next action. Failed: `ErrorState` with retry. A failed request must never look like "no data".
- **Labels are words.** Show identifiers through `humanize()` in `lib/format.ts`.
- **Never use `window.confirm`, `alert` or `prompt`** (lint fails them). Use `ConfirmDialog`.
- **Forms save from one place**: `UnsavedChangesBar`, shown only while something changed.
- **Fewest clicks.** A page added to `components/layout/nav-items.tsx` appears in the sidebar and the Ctrl+K palette together. Breadcrumbs come from `lib/breadcrumbs.ts`; pages do not render their own.
- **Do not offer what the server cannot do.** If a setting is saved but the engine ignores it, hide it or say so on the page.

## Check

1. Start the web dev server: `pnpm dev:web` (port 5173). No API server or database is needed; `pnpm shots` answers every `/api/v1` call from `scripts/shots/fixture.mjs`.
2. Screenshot the pages you touched: `pnpm shots --only <page>,<page>`. Page names are the keys of `PAGES` in `scripts/shots/shots.mjs`. A new page needs an entry there and fixture data.
3. **Open and look at every image** it wrote: light, dark and the 390x844 phone view. Check alignment, clipping, contrast in dark mode, and that nothing scrolls sideways on the phone.
4. The command exits 1 if a page threw or logged a console error. Fix that; do not ignore it.
5. For a multi-step flow, add or extend a Playwright spec in `e2e/` and run `pnpm test:e2e`.

A UI change is not done until you have looked at the images. Finish with the `verify-and-finish` skill.
