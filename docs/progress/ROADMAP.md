# Roadmap

> What's planned. What's done lives in git history and CHANGELOG.md.

## Current Focus

- [ ] Data type serialization (XML/JSON/HL7 → structured `msg` object in sandbox)
- [ ] Eliminate "Channels" and "Messages" nav items — better nav UX
- [ ] Channel editor: group dropdown in Channel Settings tab (3d)

## Upcoming

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

## Production Readiness

- [ ] E2E test suite maintenance (11 specs, some may need updates)
- [ ] Load testing / throughput benchmarks
- [ ] Horizontal scaling (multi-server coordination)
- [ ] Audit log export to external systems
- [ ] HIPAA compliance review
