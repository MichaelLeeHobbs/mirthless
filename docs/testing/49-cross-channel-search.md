# 49 — Traffic & Triage (Cross-Channel)

> The top-level **Messages** nav is now **Traffic** (`/messages`), an engine-wide ops
> view. Per-channel message browsing still lives behind each channel (channel context
> menu → Messages); see [`10-message-browser.md`](10-message-browser.md).

## UI Tests — Traffic view

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 49.U1 | Page loads | Open Traffic (`/messages`) | Heading "Traffic", engine-wide summary strip (Received/Sent/Errored/Queued), and two tabs | |
| 49.U2 | Needs Attention default | View the default tab | "Needs Attention" shows errored messages across all channels; badge shows the error count | |
| 49.U3 | Reprocess from feed | Click "Reprocess" on an errored row | Message is reprocessed; success toast; feed refreshes | |
| 49.U4 | Open from feed | Click "Open" on a row | Navigates to that channel's message browser filtered to errors | |
| 49.U5 | Empty triage | With no errors anywhere | "Nothing needs attention" empty state | |
| 49.U6 | Search tab | Switch to "Search" | Status + date-range filters; results table with pagination | |
| 49.U7 | Search filters | Set status/date filters | Results update accordingly | |

## API Tests

- [ ] `GET /messages` — returns paginated message list across all channels
- [ ] `GET /messages?status=SENT` — filters by status
- [ ] `GET /messages?dateFrom=...&dateTo=...` — filters by date range
- [ ] `GET /messages?channelIds=uuid1,uuid2` — filters by channel IDs
- [ ] `GET /messages?limit=10&offset=20` — pagination works correctly
- [ ] Response includes channelName from channels table join
- [ ] Returns empty items array when no messages match
- [ ] Requires authentication (401 without token)
- [ ] Requires channels:read permission

## UI Tests

- [ ] Navigate to Messages page (sidebar nav)
- [ ] Messages page renders without error (was previously broken 404)
- [ ] Table shows messages from all channels
- [ ] Status filter dropdown filters messages
- [ ] Date range fields filter messages
- [ ] Pagination controls work (next/prev page, rows per page)
- [ ] Channel name column shows correct channel names
- [ ] Clicking channel name navigates to channel's message browser
- [ ] Status chips show correct colors (green=SENT, red=ERROR, yellow=QUEUED)
- [ ] Empty state shows "No messages found"
- [ ] Loading spinner shows while fetching
- [ ] Error alert shown on API failure
