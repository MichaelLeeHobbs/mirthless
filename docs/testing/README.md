# Manual Testing

Test checklists organized by feature area. Run through these after significant changes.

## Test Files

| File                                               | Area                                               | Scenarios |
|----------------------------------------------------|----------------------------------------------------|-----------|
| [00-site.md](./00-site.md)                         | Site-wide layout, navigation, responsiveness       | 8         |
| [01-auth.md](./01-auth.md)                         | Login, session, protected routes                   | 5         |
| [02-channels-list.md](./02-channels-list.md)       | Channel list page, search, CRUD actions            | 10        |
| [03-channels-editor.md](./03-channels-editor.md)   | Editor general behavior + Summary tab              | 22        |
| [04-channels-source.md](./04-channels-source.md)   | Source tab: connector switching, response settings | 6         |
| [04a-source-tcp-mllp.md](./04a-source-tcp-mllp.md) | TCP/MLLP connector form                            | 11        |
| [04b-source-http.md](./04b-source-http.md)         | HTTP connector form                                | 8         |
| [05-data-roundtrip.md](./05-data-roundtrip.md)     | End-to-end persistence + build verification        | 7         |

## Running Tests

1. Start prerequisites: `pnpm docker:up && pnpm db:migrate && pnpm db:seed`
2. Start dev servers: `pnpm dev`
3. Work through each test file, recording results in the Result/Notes columns
4. When done, copy your results into `runs/` with a date-stamped filename

## Completed Test Runs

See the [runs/](./runs/) folder for historical results.

## Legend

- **PASS** — Works as expected
- **FAIL** — Does not work as expected (log details in Notes)
- **PARTIAL** — Partially works (log what's missing in Notes)
- **SKIP** — Not tested this run
- **BLOCKED** — Cannot test due to a dependency
