# 24 — Channel Export/Import

## Prerequisites
- Logged in as admin (or user with channels:read and channels:write permissions)
- At least two channels created with destinations, filters, transformers, and scripts configured

## Channel Export

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Export all channels | Click Export All button in channels list header (or GET /api/channels/export) | JSON response with version=1, exportedAt timestamp, and channels array containing all channels | |
| 2 | Export single channel | Select a channel, click Export (or GET /api/channels/:id/export) | JSON response with version=1 and channels array containing one channel | |
| 3 | Exported JSON structure | Export a channel, inspect JSON | Contains id, name, description, enabled, revision, inboundDataType, outboundDataType, sourceConnectorType, sourceConnectorProperties, responseMode, initialState, scripts, destinations, metadataColumns, filters, transformers | |
| 4 | Destinations included | Export channel with 3 destinations | All 3 destinations in export with metaDataId, name, connectorType, properties, queue settings | |
| 5 | Scripts included | Export channel with deploy/undeploy scripts | Scripts array contains scriptType and script content | |
| 6 | Filters included | Export channel with filter rules | Filters array contains connectorId and rules with enabled, name, operator, type, script, field, condition, values | |
| 7 | Transformers included | Export channel with transformer steps | Transformers array contains connectorId, data types, templates, and steps with enabled, name, type, script, sourceField, targetField | |
| 8 | Metadata columns included | Export channel with custom metadata columns | metadataColumns array contains name, dataType, mappingExpression | |
| 9 | Export non-existent channel | GET /api/channels/{invalid-uuid}/export | 404 response with NOT_FOUND error | |
| 10 | Export requires authentication | Call export endpoint without auth token | 401 Unauthorized | |
| 11 | Export requires channels:read permission | Call export as viewer role (which has channels:read) | Export succeeds | |

## Channel Import

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 12 | Import new channels | POST /api/channels/import with valid export JSON and collisionMode=SKIP | Response: created=N, updated=0, skipped=0, errors=[] | |
| 13 | Import with SKIP collision mode | Import channels where IDs already exist, collisionMode=SKIP | Existing channels unchanged, skipped count incremented | |
| 14 | Import with OVERWRITE collision mode | Import channels where IDs already exist, collisionMode=OVERWRITE | Existing channels overwritten with import data, updated count incremented | |
| 15 | Import with CREATE_NEW collision mode | Import channels where IDs already exist, collisionMode=CREATE_NEW | New channels created with fresh UUIDs, created count incremented | |
| 16 | OVERWRITE replaces relations | Import with OVERWRITE, channel has different destinations/scripts | Old destinations, scripts, filters, transformers, metadata columns deleted and replaced | |
| 17 | CREATE_NEW assigns new UUID | Import with CREATE_NEW on existing ID | Imported channel gets randomUUID, original channel untouched | |
| 18 | Partitions created for new channels | Import new channel | Partition manager creates partitions for the imported channel | |
| 19 | Import with invalid JSON body | POST with malformed JSON | 400 validation error | |
| 20 | Import with missing required fields | POST with channel entry missing name | 400 validation error from Zod schema | |
| 21 | Import with invalid version | POST with version=2 | 400 validation error (must be version=1) | |
| 22 | Import requires authentication | Call import endpoint without auth token | 401 Unauthorized | |
| 23 | Import requires channels:write permission | Call import as viewer role (read-only) | 403 Forbidden | |
| 24 | Import event emitted | Import channels successfully | CHANNEL_UPDATED event emitted with action=import, created/updated/skipped counts | |

## Round-Trip (Export then Import)

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 25 | Export then import produces identical channel | Export a channel, delete it, import the export JSON | Re-created channel matches original in all fields (name, description, connectors, scripts, filters, transformers, metadata columns) | |
| 26 | Export all then import all | Export all channels, delete all, import with collisionMode=SKIP | All channels recreated, created count matches original count | |
| 27 | Export + import preserves connector properties | Export channel with FILE source and SMTP destination | Imported channel has identical sourceConnectorProperties and destination properties | |
