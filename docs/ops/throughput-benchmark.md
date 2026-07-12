# Throughput Benchmark & Baseline

`scripts/bench-throughput.mjs` drives real HL7v2 messages through the **actual engine
pipeline** (`@mirthless/engine` `MessageProcessor` + `VmSandboxExecutor`) and reports
sustained throughput (messages/sec) and per-message latency percentiles. It is the first
concrete answer to the ROADMAP's long-standing "throughput: untested".

## Running it

Build first (the script imports the built engine dist):

```bash
pnpm build      # or: pnpm --filter @mirthless/engine build

# In-memory pipeline (no DB, no network) — runs anywhere:
pnpm bench:throughput                                   # 5000 msgs, sandbox on
node scripts/bench-throughput.mjs --messages 20000 --concurrency 32
node scripts/bench-throughput.mjs --no-sandbox          # pipeline without scripts

# End-to-end against your dev Postgres (persists rows):
node scripts/bench-throughput.mjs --db --messages 2000
```

Flags: `--messages N` (default 5000), `--concurrency C` (default 16), `--warmup W`
(default 250), `--no-sandbox` (skip the per-message filter script), `--db` (use the real
Postgres `MessageService` store; reads `DATABASE_URL` from `.env`; requires
`pnpm --filter @mirthless/server build`).

What each message does: create message + source connector + raw/source-map content →
validate inbound HL7v2 → (optional) run a sandbox filter → route to one cheap destination
→ persist SENT content → finalize. `--db` mode performs the real inserts; the default
in-memory mode exercises everything except the DB and network.

## Baseline (initial)

Measured on a developer workstation (Node 24, single process, in-memory store). These are
**relative, machine-dependent** numbers — reproduce on your own hardware for a meaningful
figure; treat them as an order-of-magnitude baseline, not a spec.

| Configuration | Throughput | p50 | p95 | p99 |
|---------------|-----------:|----:|----:|----:|
| Pipeline **without** sandbox scripts (`--no-sandbox`) | **~23,000 msgs/sec** | 0.57 ms | 1.15 ms | 2.3 ms |
| Pipeline **with** one sandbox filter/transformer per message (default) | **~500 msgs/sec** | ~30–55 ms | ~60–85 ms | ~90–120 ms |

Command for the headline numbers:

```bash
node scripts/bench-throughput.mjs --messages 5000 --concurrency 16            # ~500/s
node scripts/bench-throughput.mjs --messages 5000 --concurrency 16 --no-sandbox  # ~23k/s
```

### What the baseline tells us

- **The `node:vm` sandbox dominates cost.** A single script execution per message drops
  throughput ~40x (from ~23k to ~500 msgs/sec) and adds tens of milliseconds of latency —
  the pipeline itself is not the bottleneck, per-message VM context creation is. Channels
  with **no** filters/transformers are dramatically faster than channels that run scripts.
  This is the primary throughput lever today, and a natural target for optimization
  (context reuse / pooling) — see the ROADMAP.
- **The non-script pipeline is fast** (~23k msgs/sec in-process), so serialization,
  routing, and the store-interface calls are cheap relative to scripting and (in `--db`
  mode) Postgres persistence.
- Add `--db` to fold in real Postgres write cost, which will lower the numbers further and
  is the most realistic end-to-end figure for a given deployment.

Re-run after any pipeline/sandbox change to catch regressions, and record updated numbers
here.
