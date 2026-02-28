# 05 — Data Round-Trip + Build Verification

> End-to-end persistence tests and build/lint/test checks.

## Data Round-Trip

| #   | Scenario                       | Steps                                                                                   | Expected                                                                                                                                 | Result | Notes |
|-----|--------------------------------|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|--------|-------|
| 5.1 | Full channel creation          | Create channel via dialog, fill Summary fields, configure Source (TCP/MLLP), Save       | Channel saved, all data visible on reload                                                                                                |        |       |
| 5.2 | Full channel edit              | Open existing channel, change name, description, data types, connector settings, Save   | All changes persist on reload                                                                                                            |        |       |
| 5.3 | API returns correct data       | After save, check `GET /api/v1/channels/:id` response                                   | Response includes all fields: name, description, enabled, data types, connector type, connector properties, initial state, response mode |        |       |
| 5.4 | DB stores connector properties | After save, check DB: `SELECT source_connector_properties FROM channels WHERE id = :id` | JSONB column contains the connector settings object                                                                                      |        |       |

## Placeholder Tabs

| #   | Scenario                     | Steps                  | Expected                             | Result | Notes |
|-----|------------------------------|------------------------|--------------------------------------|--------|-------|
| 5.5 | Destinations tab placeholder | Click Destinations tab | Shows placeholder message (no crash) |        |       |
| 5.6 | Scripts tab placeholder      | Click Scripts tab      | Shows placeholder message (no crash) |        |       |
| 5.7 | Advanced tab placeholder     | Click Advanced tab     | Shows placeholder message (no crash) |        |       |

## Build Verification

| #    | Scenario     | Steps            | Expected                       | Result | Notes |
|------|--------------|------------------|--------------------------------|--------|-------|
| 5.8  | `pnpm build` | Run `pnpm build` | 0 errors, all packages compile |        |       |
| 5.9  | `pnpm lint`  | Run `pnpm lint`  | 0 warnings                     |        |       |
| 5.10 | `pnpm test`  | Run `pnpm test`  | All tests pass (60+)           |        |       |
