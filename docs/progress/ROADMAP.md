# Roadmap

> What's planned. What's done lives in git history and CHANGELOG.md.

## Current Focus

- [ ] Data type serialization (XML/JSON/HL7 → structured `msg` object in sandbox)
- [ ] Eliminate "Channels" and "Messages" nav items — better nav UX
- [x] ~~Channel editor: group dropdown in Channel Settings tab~~
- [x] ~~Script error handling (mark ERROR, not silent skip)~~
- [x] ~~Disabled channels cannot be deployed~~

## Upcoming

- [ ] Dashboard: replace polling with WebSocket-driven query invalidation
- [ ] HL7v2 inbound parsing — `msg.get('PID.3')` in transformers
- [ ] XML inbound parsing — DOM-like access in transformers
- [ ] FHIR inbound parsing
- [ ] Inbound data validation (reject malformed messages at source)
- [ ] Connection testing for all connector types
- [ ] SSL/TLS certificate selection in connector settings
- [ ] Email (IMAP) source connector polling
- [ ] Mirth Connect XML channel import improvements
- [ ] More CLI commands + interactive mode

## Performance

- [ ] Deferred write architecture — collect all DB writes, single CTE at end (target: <5ms native Postgres)
- [ ] VM context pooling — reuse sandbox contexts across messages
- [ ] Prepared statement caching for hot-path queries

## Known Issues / Tech Debt

- Drizzle ORM `inArray()` fails silently with bigint columns — use raw SQL for message queries
- `pino-http` error logging shows generic "failed with status code 500" — actual error in service layer
- Channel group is single-select but schema is many-to-many — consider migration to FK

## Production Readiness

- [ ] E2E test suite maintenance (11 specs, some may need updates)
- [ ] Load testing / throughput benchmarks
- [ ] Horizontal scaling (multi-server coordination)
- [ ] Audit log export to external systems
- [ ] HIPAA compliance review
