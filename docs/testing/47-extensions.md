# 47 — Extension Registry

## API Tests

- [ ] `GET /extensions` — returns list of 17 built-in extensions (9 connectors + 8 data types)
- [ ] `GET /extensions/:id` — returns extension detail
- [ ] `GET /extensions/:id` — returns 404 for unknown ID
- [ ] `PATCH /extensions/:id/enabled` — enables an extension
- [ ] `PATCH /extensions/:id/enabled` — disables an extension
- [ ] `PATCH /extensions/:id/enabled` — returns 404 for unknown ID
- [ ] Extension enable/disable persisted in system_settings
- [ ] Default state for unset extensions is enabled
- [ ] Requires authentication (401 without token)
- [ ] `GET` requires settings:read permission
- [ ] `PATCH` requires settings:write permission

## UI Tests

- [ ] Navigate to Extensions page
- [ ] Table shows all 17 extensions
- [ ] Each row shows name, type chip, version, description, capabilities, toggle
- [ ] Connector type shows blue chip, Data Type shows purple chip
- [ ] Toggle switch enables/disables extension
- [ ] Toggle updates immediately (optimistic update via query invalidation)
- [ ] Capabilities shown as chips (source, destination, inbound, outbound)
- [ ] Loading spinner shows while data loads
- [ ] Error alert shown on API failure
