# 39 — System Info Manual Test Checklist

## Prerequisites
- Logged in as admin
- System Info page accessible via sidebar

## Tests

### Server Info Card
- [ ] Shows server version
- [ ] Shows Node.js version (e.g., v22.x.x)
- [ ] Shows environment (development/production)
- [ ] Shows process PID
- [ ] Shows uptime in human-readable format (Xd Xh Xm)

### Database Card
- [ ] Shows "Connected" chip (green) when DB is up
- [ ] Shows "Disconnected" chip (red) when DB is down

### Process Memory Card
- [ ] Heap progress bar shows used/total
- [ ] Bar color changes: green < 70%, orange 70-90%, red > 90%
- [ ] RSS value displayed
- [ ] External memory value displayed
- [ ] Values formatted in KB/MB/GB

### OS Card
- [ ] System memory progress bar shows used/total
- [ ] Platform displayed (win32/linux/darwin)
- [ ] Architecture displayed (x64/arm64)

### Engine Stats Card
- [ ] Deployed count shown
- [ ] Started count (green)
- [ ] Stopped count (red)
- [ ] Paused count (orange)

### Auto-refresh
- [ ] Data refreshes every 10 seconds
- [ ] Memory values update live

### Permissions
- [ ] Users with `system:info` can view page
- [ ] Users without permission get 403
