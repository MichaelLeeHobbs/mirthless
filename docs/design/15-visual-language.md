# 15 — Visual Language

Mirthless looks like a calm, precise clinical instrument panel. Operators watch it all day, so the UI favours legibility under pressure: hairline borders over heavy shadows, tabular numerals for every metric, and five status colours that mean the same thing on every page. Light and dark modes are equally finished, because many hospital IT shops run light.

This doc is the rulebook. The values live in code; the rules below say how to use them. The `create-ui` skill (`.claude/skills/create-ui/SKILL.md`) is the workflow that points agents here.

## Where it lives

| What | File | Notes |
|---|---|---|
| Tokens: colours per mode, radius, fonts, tag colours | `packages/web/src/styles/tokens.ts` | The only file with colour literals (plus `theme.ts`). |
| MUI theme: palette, type scale, component overrides | `packages/web/src/styles/theme.ts` | Overrides make pages consistent without per-page styling. |
| Status meaning | `packages/web/src/lib/status.ts` | Maps channel states and message statuses to a level. |
| Shared page parts | `packages/web/src/components/common/` | `PageHeader`, `StatusChip`/`StatusDot`/`ChannelStateChip`/`MessageStatusChip`, `ConfirmDialog`, `states/` (`EmptyState`, `ErrorState`, `TableSkeleton`, `LoadingBlock`). |
| Screenshot check | `scripts/shots/` (`pnpm shots`) | Renders pages against a fake API in light, dark and phone sizes. |
| Lint guards | `eslint.config.js` (visual language block) | Blocks hex/rgb colours, inline font stacks and browser popups in `packages/web/src`. |

## Rules

### Colour

- **Colours come from the theme.** In `sx`, use palette paths: `'text.secondary'`, `'divider'`, `'surfaceSunken'`, `'status.critical'`. In code that needs a value, use `useTheme()`. Never write a hex, `rgb()` or `hsl()` literal in `packages/web/src` outside `styles/`; lint fails it.
- **Need a new colour?** Add it to `tokens.ts` for both modes, then use it through the theme. If only one page would use it, it probably isn't needed.
- **Status colours are reserved.** `palette.status` has five levels, and they are never used as decoration:

  | Level | Means | Channel state | Message status |
  |---|---|---|---|
  | `healthy` | Nominal | STARTED | SENT |
  | `warning` | Needs attention, not failed | PAUSED | QUEUED |
  | `critical` | Action required | STOPPED | ERROR |
  | `info` | In flight, informational | | RECEIVED, TRANSFORMED, FILTERED |
  | `neutral` | Inert, no signal | UNDEPLOYED | anything else |

  Decide the level with `lib/status.ts`, then render it with `StatusChip`, `StatusDot`, `ChannelStateChip` or `MessageStatusChip`. Don't map a status to a colour by hand on a page.
- **Meaning never depends on colour alone.** A status chip carries its label; a dot carries a `title`. Error counts are numbers, not just red.
- **Tag colours are user data.** Render them with `TagChips` (or `contrastText()` for the label colour) so the text stays readable on any tag colour. A new tag starts at `TAG_COLOR.default`.

### Type

- **One sans stack** (`FONT_FAMILY_SANS`, self-hosted Inter Variable) set by the theme. Use `Typography` variants from the theme's compact scale; don't set `fontSize` to invent new heading sizes.
- **Monospace for machine text:** IDs, message content, HL7, code, keys and log lines use `FONT_FAMILY_MONO` from `styles/tokens.ts`. Never write a font stack inline; lint fails it.
- **Numbers are tabular.** Tables and chips already set `tabular-nums`. Metric tiles do too; keep it when adding new number displays.
- **Overline** (uppercase, 0.08em tracking) is for section labels and table heads, which the theme already applies.

### Surfaces and shape

- **Paper and Card** are flat (`elevation 0`) with a 1px `divider` border and `RADIUS.lg` (12px). Don't add `boxShadow` to make something stand out; menus and popovers are the only floating surfaces.
- **Radius scale:** `RADIUS.sm` 6 (chips, tooltips), `md` 8 (buttons, inputs, list items), `lg` 12 (panels), `pill` 999.
- **Raised and sunken:** `surfaceRaised` for nested panels and menus, `surfaceSunken` for table heads, code blocks and log consoles. Both follow the mode.

### Layout and page anatomy

- **Every page starts with `PageHeader`**: title, one line saying what the page is for, primary actions on the right. One primary (contained) button per page; the rest are outlined.
- **States are not blank space.** Loading uses `TableSkeleton` or `LoadingBlock`, empty uses `EmptyState` with the next action, and failure uses `ErrorState` with retry. A failed request must never look like "no data".
- **Admin lists** are a table inside a Paper, with row actions as icon buttons with tooltips. A disabled action's tooltip says which permission it needs.
- **Phones (under 900px, MUI `md`)**: the sidebar is an overlay that starts closed, and pages scroll vertically with no horizontal page scroll. Wide tables scroll inside their own container.

### Interaction

- **Never use the browser's popups.** `window.confirm`, `alert` and `prompt` can't be styled or tested, so lint fails them. Confirm with `ConfirmDialog`. For a destructive action, name the target in the message and use `severity="error"`.
- **Focus is always visible.** The theme draws a 2px primary outline on `:focus-visible` for every control. Don't remove it; hover-only affordances must also appear on focus.
- **Motion is minimal** and the theme switches it off under `prefers-reduced-motion`.

## Verify a UI change

1. `pnpm lint` and the web tests.
2. Start the web dev server (`pnpm dev:web`) and run `pnpm shots` (or `pnpm shots --only dashboard,alerts`). It writes `shots/<page>.<light|dark|phone>.png` and exits 1 if a page threw.
3. **Look at every image** for the pages you touched: both modes, plus the phone size. Check that text is readable, status reads the same as on other pages, and nothing overflows.
4. A page that needs data the fake API doesn't serve gets a branch in `scripts/shots/fixture.mjs`. A new page gets an entry in `PAGES` in `scripts/shots/shots.mjs`. Use synthetic data only, never real PHI.

`pnpm shots` needs a Playwright Chromium. Run `pnpm exec playwright install chromium` once, or set `CHROMIUM_PATH` to an existing Chromium.

## Reference pages

When building something new, copy the closest of these:

| Pattern | Page | Why it's the reference |
|---|---|---|
| Monitoring dashboard | Dashboard (`pages/DashboardPage.tsx`) | Metric tiles with status accents, grouped table, status chips. |
| Admin list and edit | Users (`pages/UsersPage.tsx`), Tags (`pages/TagsPage.tsx`) | `PageHeader`, table in Paper, row actions, dialog editor. |
| Triage worklist | Traffic (`pages/TrafficPage.tsx`) | Summary tiles above a filtered list of what needs attention. |
| Dense detail browser | Message browser (`pages/MessageBrowserPage.tsx`) | Filters, monospace IDs, status per connector. |
| Read-only status | System Info (`pages/SystemInfoPage.tsx`) | Panels of facts, progress bars, status counts. |
| Long-form editor | Channel editor (`pages/ChannelEditorPage.tsx`) | Tabs, accordions for advanced settings. |
