# 41 — Server Backup/Restore Manual Test Checklist

## Backup Export
- [ ] GET /api/v1/system/backup returns full backup payload
- [ ] Backup includes channels, code templates, alerts, global scripts, users, settings, resources
- [ ] Backup includes channel groups, tags, dependencies, config map, global map
- [ ] Users in backup do not include passwordHash or failedLoginAttempts
- [ ] Backup version field is 1
- [ ] Backup exportedAt is a valid ISO timestamp
- [ ] Requires system:backup permission
- [ ] Returns 401 without authentication
- [ ] Returns 403 without system:backup permission

## Backup Download (UI)
- [ ] Download Backup button triggers file download
- [ ] Downloaded file is valid JSON
- [ ] Downloaded filename includes timestamp
- [ ] Button shows loading spinner during download
- [ ] Error alert shown on failure

## Restore
- [ ] POST /api/v1/system/backup restores from payload
- [ ] Requires system:restore permission
- [ ] SKIP mode: existing items are not modified
- [ ] OVERWRITE mode: existing items are updated
- [ ] New items are created regardless of mode
- [ ] Returns section-by-section result report
- [ ] Channels are restored via import service
- [ ] Settings are restored via upsert
- [ ] Tags are created/updated by ID
- [ ] Channel groups are created/updated by ID
- [ ] Resources are created/updated by ID
- [ ] Code template libraries and templates are restored
- [ ] Global scripts are restored
- [ ] Alerts are created/updated
- [ ] Channel dependencies are restored
- [ ] Config map entries are restored
- [ ] Global map entries are restored
- [ ] Group memberships are restored
- [ ] Tag assignments are restored
- [ ] Invalid backup payload returns 400

## Restore (UI)
- [ ] "Restore from File" opens file picker
- [ ] File picker accepts .json files only
- [ ] Confirmation dialog shows filename
- [ ] Collision mode selector (Skip/Overwrite)
- [ ] Cancel button closes dialog without restoring
- [ ] Restore button triggers restore
- [ ] Result summary table shown after restore
- [ ] Error alert shown on failure
