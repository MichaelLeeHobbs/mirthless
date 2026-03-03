# 44 — Server Logs Manual Test Checklist

## Log Query API
- [ ] GET /api/v1/system/logs returns log entries
- [ ] Requires system:info permission
- [ ] Returns 401 without authentication
- [ ] Default pagination (offset=0, limit=100)
- [ ] Custom offset and limit parameters
- [ ] Level filter: level=40 returns WARN and above
- [ ] Search filter: case-insensitive substring match
- [ ] Entries returned newest first
- [ ] Response includes total count

## Ring Buffer
- [ ] Captures log entries in memory
- [ ] Maximum 10,000 entries
- [ ] Oldest entries evicted when full
- [ ] Buffer wraps correctly (no gaps or duplicates)

## Pino Integration
- [ ] Production mode: logs captured via tee stream
- [ ] JSON log lines parsed correctly
- [ ] Level, message, timestamp extracted
- [ ] Non-JSON lines ignored gracefully

## Socket.IO Streaming
- [ ] join:logs event joins logs room
- [ ] leave:logs event leaves logs room
- [ ] New log entries emitted as server:log events
- [ ] Only clients in logs room receive events

## UI - Log Viewer
- [ ] Log viewer section on System Info page
- [ ] Entries displayed with timestamp, level, message
- [ ] Color coding: ERROR=red, WARN=orange, INFO=default, DEBUG=gray
- [ ] Level filter toggles (multi-select)
- [ ] Search text field with debounced filtering
- [ ] Auto-scroll to newest entries
- [ ] Pause/Resume button stops/resumes auto-scroll
- [ ] Download button exports filtered entries as .log file
- [ ] Real-time updates via WebSocket
- [ ] Historical entries loaded on mount
- [ ] Monospace font for log entries
