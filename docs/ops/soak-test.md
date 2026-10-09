# Soak Test

`scripts/soak.mjs` (`pnpm soak`) runs steady HL7v2 traffic through a **real running
server** for hours and checks that every message arrives downstream exactly once. The
[throughput benchmark](throughput-benchmark.md) measures peak speed in-process; the
soak checks what peak speed cannot: memory, latency and data integrity over time.

## What it sets up

Through the API it creates and starts one channel:

```
MLLP sender --> [TCP/MLLP source -> JS transformer -> TCP/MLLP destination] --> MLLP sink
```

The sender and sink live in the script. Each message gets a unique control ID. The
transformer sets `PID-8` to `U`, so the sink can tell a transformed message from one that
skipped the pipeline. The destination queues on failure with 3 retries.

Every minute it prints one JSON line: messages sent and acknowledged, ACK codes, errors,
messages the sink received, duplicates, untransformed messages, the server's stored-message
total, ACK latency percentiles, and server RSS (with `--server-pid`). At the end it drains
for up to two minutes and fails (exit 1) if any acknowledged message never reached the sink,
arrived twice, arrived untransformed, or was not stored.

## Running it

```bash
# Server running against a scratch database, admin password already changed.
# Use a long access token so the per-minute stored count keeps working:
JWT_ACCESS_EXPIRES_IN=12h NODE_ENV=production ... node packages/server/dist/index.js

SOAK_PASSWORD='<admin password>' pnpm soak --minutes 180 --rate 100 --server-pid <pid>
```

Options: `--minutes` (default 180), `--rate` messages/sec (default 50), `--connections`
(default 4), `--api` (default `http://localhost:3000/api/v1`), `--server-pid`, `--keep`
(leave the channel deployed afterwards). It uses ports 16900 (sink) and 16901 (source).

## Baseline: 2026-10-09

Server in `NODE_ENV=production`, Postgres 17 in Docker on the same host, 4 vCPU / 16 GB,
storage mode DEVELOPMENT (all content stored), no pruning, no encryption.

| | Result |
|---|---|
| Duration / rate | 180 min at 100 msg/s over 4 connections |
| Messages | 1,080,004 sent, 1,080,004 ACKed `AA`, 0 errors |
| Integrity | 1,080,004 received by the sink: 0 missing, 0 duplicates, 0 untransformed; 1,080,004 stored |
| ACK latency | p50 ~10 ms; per-minute p99 15 to 61 ms; worst single message 525 ms |
| Server memory | RSS 327 MB at start, one step to ~917 MB at minute 8, then 917 to 952 MB over the remaining 2 h 50 min. JS heap steady at ~250 MB with normal GC sawtooth |
| Event loop | p99 lag ~12 ms throughout |
| File descriptors | flat (34 to 44) |
| Database growth | 22 MB to 2.2 GB, about 12 MB/min (~2 KB per message with all content stored) |

Verdict: **pass**. No message was lost, duplicated or skipped the transformer, latency
stayed flat, and memory did not climb with message count.

Observations worth knowing:

- **Size the disk and turn on pruning.** At 100 msg/s with full content storage the
  database grows ~17 GB a day. Use PRODUCTION or a lighter storage mode, pruning, or
  remove-content-on-completion on busy channels.
- **Memory:** the one-time step from ~330 MB to ~920 MB is native memory (the JS heap did
  not change). It did not recur, and the last 2 h 50 min added only 35 MB. Leave headroom
  of at least 1.5 GB for the server. A separate check ran the script sandbox 300,000 times
  with normal event-loop turns, and RSS stayed flat at 252 MB.
- Single-message spikes of 150 to 525 ms appeared a few times an hour, likely
  Postgres checkpoints or GC; per-minute p99 never exceeded 61 ms.
