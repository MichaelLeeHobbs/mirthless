# 05 — Data Round-Trip + Build Verification

> End-to-end persistence tests and build/lint/test checks.

## Data Round-Trip — Source

| #   | Scenario                       | Steps                                                                                   | Expected                                                                                                                                 | Result | Notes |
|-----|--------------------------------|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|--------|-------|
| 5.1 | Full channel creation          | Create channel via dialog, fill Summary fields, configure Source (TCP/MLLP), Save       | Channel saved, all data visible on reload                                                                                                |        |       |
| 5.2 | Full channel edit              | Open existing channel, change name, description, data types, connector settings, Save   | All changes persist on reload                                                                                                            |        |       |
| 5.3 | API returns correct data       | After save, check `GET /api/v1/channels/:id` response                                   | Response includes all fields: name, description, enabled, data types, connector type, connector properties, initial state, response mode |        |       |
| 5.4 | DB stores connector properties | After save, check DB: `SELECT source_connector_properties FROM channels WHERE id = :id` | JSONB column contains the connector settings object                                                                                      |        |       |

## Data Round-Trip — Destinations

| #    | Scenario                         | Steps                                                                      | Expected                                                               | Result | Notes |
|------|----------------------------------|----------------------------------------------------------------------------|------------------------------------------------------------------------|--------|-------|
| 5.5  | Create with destinations         | Create channel, add 2 destinations (TCP/MLLP + HTTP), fill settings, Save  | Both destinations visible after reload with correct properties         |        |       |
| 5.6  | Edit destinations                | Open channel, modify destination name and port, Save                       | Changes persist after reload                                           |        |       |
| 5.7  | Remove destination               | Open channel, remove one destination, Save                                 | Only remaining destination visible after reload                        |        |       |
| 5.8  | Reorder destinations             | Move destination 2 to position 1, Save                                     | Order persists (metaDataId reassigned)                                 |        |       |
| 5.9  | Queue settings persist           | Set queue mode to ON_FAILURE, retry 3, interval 5000, Save                 | Queue settings visible after reload                                    |        |       |

## Data Round-Trip — Scripts

| #    | Scenario                         | Steps                                                     | Expected                                    | Result | Notes |
|------|----------------------------------|------------------------------------------------------------|---------------------------------------------|--------|-------|
| 5.10 | Save scripts                     | Edit all 4 scripts with code, Save                         | All 4 scripts contain saved values on reload|        |       |
| 5.11 | Clear scripts                    | Clear all editors, Save                                    | All scripts empty on reload                 |        |       |

## Data Round-Trip — Advanced

| #    | Scenario                         | Steps                                                           | Expected                                         | Result | Notes |
|------|----------------------------------|-----------------------------------------------------------------|--------------------------------------------------|--------|-------|
| 5.12 | Storage mode persists            | Change to PRODUCTION, Save                                      | PRODUCTION selected on reload                    |        |       |
| 5.13 | Encrypt/remove flags persist     | Toggle all 3 switches on, Save                                  | All 3 on after reload                            |        |       |
| 5.14 | Pruning settings persist         | Enable pruning, set 30 days, enable archive, Save               | Pruning settings visible after reload            |        |       |
| 5.15 | Metadata columns persist         | Add 2 columns (PatientId STRING, OrderDate TIMESTAMP), Save     | Both columns visible after reload                |        |       |

## Build Verification

| #    | Scenario     | Steps            | Expected                       | Result | Notes |
|------|--------------|------------------|--------------------------------|--------|-------|
| 5.16 | `pnpm build` | Run `pnpm build` | 0 errors, all packages compile |        |       |
| 5.17 | `pnpm lint`  | Run `pnpm lint`  | 0 warnings                     |        |       |
| 5.18 | `pnpm test`  | Run `pnpm test`  | All tests pass (87+)           |        |       |
