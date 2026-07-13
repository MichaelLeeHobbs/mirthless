# 67 — Data Sources (`dbQuery`)

> Admin-managed database connection profiles that channel scripts query via
> `dbQuery(dataSourceName, sql, params)`. Credentials are encrypted at rest and
> never returned. See `docs/design/11-datasources.md`.

## Prerequisites
- Logged in as admin (or a role with `datasources:*`)
- `CONTENT_ENCRYPTION_KEY` configured (required to store credentials)
- A reachable PostgreSQL database to point at (the app DB works for a smoke test)

## API Tests

- [ ] `POST /datasources` — creates a source (requires `datasources:write`); response omits the password
- [ ] `POST /datasources` without `CONTENT_ENCRYPTION_KEY` configured → 500 CONFIG_ERROR, no row created
- [ ] `POST /datasources` duplicate name → 409
- [ ] `POST /datasources` invalid port / driver ≠ postgres → 400
- [ ] `GET /datasources` / `GET /datasources/:id` — never include `password`/`passwordEncrypted`
- [ ] `PUT /datasources/:id` without `password` → credential unchanged; with `password` → rotated
- [ ] `POST /datasources/test` — `{ connected: true }` for good creds, `{ connected: false, error }` for bad
- [ ] `DELETE /datasources/:id` — removes the source; requires `datasources:delete`
- [ ] Viewer role: read allowed; write/delete/test forbidden (403)

## UI Tests — Data Sources page

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Page loads | Open Data Sources (sidebar) | Heading, table, "Create Data Source" button | |
| 2 | Create | Fill name/host/port/database/user/password, leave Read-only on, Create | Row appears with a "Read-only" chip | |
| 3 | Test Connection (good) | Enter valid creds, click "Test Connection" | Green "Connected successfully" | |
| 4 | Test Connection (bad) | Enter a wrong password, Test | Red error message | |
| 5 | Read-write chip | Create with Read-only off | Row shows a "Read-write" chip (warning color) | |
| 6 | Edit keeps password | Edit a source, leave password blank, Save | Update succeeds; querying still works | |
| 7 | Password never shown | Edit an existing source | Password field is blank (never pre-filled) | |
| 8 | Delete | Delete → confirm | Source removed | |
| 9 | RBAC | As viewer | Create/Edit/Delete disabled with permission tooltips | |

## Script Bridge Tests (`dbQuery`)

In a channel transformer against a configured data source:

- [ ] `await dbQuery('reporting-db', 'SELECT 1 AS n', [])` returns `[{ n: 1 }]`
- [ ] Positional params work: `dbQuery(name, 'SELECT $1::int AS a', [7])` → `[{ a: 7 }]`
- [ ] A write against a **read-only** source throws ("read-only transaction")
- [ ] A write against a **read-write** source succeeds
- [ ] A result set larger than the source's `maxRows` throws (fails loud)
- [ ] After the source is edited, the next query uses the new config (pool rebuilt)
- [ ] After the source is deleted, `dbQuery` throws "not found"
- [ ] IntelliSense: the channel-script editor autocompletes `dbQuery(...)`

## Security

- [ ] `password_encrypted` in the DB is a content-crypto envelope, not plaintext
- [ ] Credentials never appear in logs or API responses
- [ ] A script can only reach configured data sources (no arbitrary host/URL)
