# 49 — Cross-Channel Message Search

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
