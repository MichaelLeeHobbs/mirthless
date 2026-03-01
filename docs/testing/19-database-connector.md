# 19 — Database Connector

## Prerequisites
- Logged in as admin or deployer
- At least one channel created
- PostgreSQL database accessible

## Database Source Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Select Database source type | Edit channel, Source tab, change connector to DATABASE | Database source form appears with Connection and Query sections | |
| 2 | Default values populated | Select DATABASE connector type | host=localhost, port=5432, database empty, username empty, password empty, selectQuery empty, updateQuery empty, updateMode=NEVER, pollingIntervalMs=5000, rowFormat=JSON | |
| 3 | Set host | Type `db.example.com` | Value updates | |
| 4 | Set port | Enter 5433 | Value updates | |
| 5 | Set database name | Type `hl7_staging` | Value updates | |
| 6 | Set username | Type `mirthless_user` | Value updates | |
| 7 | Set password | Type password | Value masked with dots, value updates | |
| 8 | Set SELECT query | Type multi-line SQL query | Monospace text area updates | |
| 9 | Set UPDATE query | Type update SQL | Monospace text area updates | |
| 10 | Change update mode to ALWAYS | Select ALWAYS | Dropdown updates | |
| 11 | Change update mode to ON_SUCCESS | Select ON_SUCCESS | Dropdown updates | |
| 12 | Change polling interval | Enter 10000 | Value updates | |
| 13 | Row format is JSON | View dropdown | JSON is the only option | |
| 14 | Save database source settings | Save channel, reload | All database source settings persisted | |

## Database Destination Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 15 | Add Database destination | Destinations tab, add destination, change type to DATABASE | Database destination form appears | |
| 16 | Default values populated | Select DATABASE connector type | host=localhost, port=5432, database empty, username empty, password empty, query empty, useTransaction=false, returnGeneratedKeys=false | |
| 17 | Set connection details | Fill host, port, database, username, password | Values update | |
| 18 | Set SQL query | Type `INSERT INTO messages (content) VALUES (${msg})` | Monospace text area updates | |
| 19 | Toggle use transaction | Toggle on | Switch turns on | |
| 20 | Toggle return generated keys | Toggle on | Switch turns on | |
| 21 | Save database destination settings | Save channel, reload | All database destination settings persisted | |

## Database Source Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 22 | Poll reads rows from database | Deploy channel with DATABASE source, insert rows in source table | Rows dispatched as JSON messages | |
| 23 | Update mode NEVER | Process rows with updateMode=NEVER | Rows not modified after read | |
| 24 | Update mode ALWAYS | Process rows with updateMode=ALWAYS | UPDATE query executed for every row | |
| 25 | Update mode ON_SUCCESS | Process row that succeeds | UPDATE query executed | |
| 26 | Update mode ON_SUCCESS (error) | Process row that fails in pipeline | UPDATE query NOT executed | |
| 27 | No rows returned | Poll with empty result set | No messages dispatched, no errors | |
| 28 | Connection error | Configure invalid credentials | Error logged, channel stays running | |
| 29 | Invalid SELECT query | Configure malformed SQL | Error logged per poll cycle | |
| 30 | Pool cleanup on stop | Stop channel | Connection pool drained | |

## Database Destination Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 31 | Execute parameterized INSERT | Send message through DATABASE destination | Row inserted with parameterized values | |
| 32 | Execute parameterized UPDATE | Configure UPDATE query | Row updated with parameterized values | |
| 33 | Variable substitution | Use ${msg.PID} in query | Variable resolved from message context | |
| 34 | Transaction mode | useTransaction=true | Query wrapped in BEGIN/COMMIT | |
| 35 | Transaction rollback on error | useTransaction=true, query fails | Transaction rolled back | |
| 36 | Return generated keys | returnGeneratedKeys=true | Generated keys available in response | |
| 37 | Connection error | Invalid connection string | Error status returned, message marked ERROR | |
| 38 | Invalid query | Malformed SQL | Error status returned with details | |

## Query Builder (Security)

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 39 | Parameterized values | Use ${name} in query | Values bound as $1, $2 — never string-interpolated | |
| 40 | SQL injection prevention | Set variable to `'; DROP TABLE users; --` | Value safely parameterized, no SQL injection | |
| 41 | Multiple variables | Use ${a}, ${b}, ${c} in query | All three bound as $1, $2, $3 | |
| 42 | No variables | Query with no ${} placeholders | Query executed as-is, empty params array | |
