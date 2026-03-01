# 30 — WebSocket Real-Time Updates

## Prerequisites
- Server running with PostgreSQL
- Web UI accessible in browser
- Admin credentials for login
- At least one deployed channel

## Authentication

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Socket.IO connection requires valid JWT | Log in to web UI, open browser DevTools Network tab | WebSocket connection established with auth token in handshake | |
| 2 | Invalid token rejected at handshake | Manually send Socket.IO handshake with expired/invalid token | Connection rejected, no socket session created | |
| 3 | Token refresh updates socket auth | Wait for JWT to refresh (or trigger refresh) | Socket reconnects with new token automatically | |

## Room Management

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 4 | Client joins dashboard room | Navigate to Dashboard page | Client emits join:dashboard, receives dashboard-scoped events | |
| 5 | Client leaves dashboard room on navigate away | Navigate from Dashboard to another page | Client emits leave:dashboard, stops receiving dashboard events | |
| 6 | Client joins channel room | Navigate to Message Browser for a specific channel | Client emits join:channel with channelId | |
| 7 | Client leaves channel room on navigate away | Navigate away from Message Browser | Client emits leave:channel, stops receiving channel-scoped events | |

## Real-Time Dashboard Updates

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 8 | Dashboard updates on channel state change | On Dashboard, deploy/start/stop/undeploy a channel via API or CLI | Channel status updates instantly without manual refresh | |
| 9 | Dashboard statistics update in real-time | Send messages through a running channel while on Dashboard | Statistics (received/sent/filtered/errored counts) update instantly | |

## Real-Time Message Browser Updates

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 10 | Message browser shows new messages instantly | Open Message Browser for a channel, send a message through it | New message appears in the list without manual refresh | |

## Reconnection + Fallback

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 11 | Reconnection after disconnect re-joins rooms | Temporarily disrupt network (disable/enable network adapter) | Socket reconnects, re-joins rooms, data refreshes | |
| 12 | Reconnection invalidates all cached queries | Disconnect and reconnect the WebSocket | All TanStack Query caches invalidated, fresh data fetched | |
| 13 | Polling fallback works when WebSocket disconnected | Disable WebSocket (block port or simulate failure) | Dashboard and Message Browser continue updating via 5s polling interval | |
| 14 | Multiple browser tabs receive independent updates | Open Dashboard in two tabs, change channel state | Both tabs update independently with correct state | |
