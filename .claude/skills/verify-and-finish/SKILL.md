---
name: verify-and-finish
description: Run the checks that match what you changed and end the task with a verdict (DONE, NEEDS YOU or NOT DONE). Use at the end of every task in this repository, before saying the work is finished.
---

# Verify and finish

Michael tests this project by hand and it is too big for that. A task is finished when you have run the checks for what you touched and can say so, not when the code looks right.

## Steps

1. **List what you changed.** `git status --short` and `git diff --stat` against the base branch.
2. **Pick the checks** from the verification matrix in `AGENTS.md`. Everything gets `pnpm gate`. Add the rows that match your files:
   - `packages/web` UI: `pnpm shots --only <pages>` with `pnpm dev:web` running, then look at the light, dark and phone images.
   - A multi-step UI flow: `pnpm test:e2e` (needs Postgres, migrated and seeded).
   - `packages/server/src/db/schema`: `pnpm db:generate`, commit the migration, `pnpm test:integration`.
   - SQL, queues, pruning, partitions: `pnpm test:integration`.
   - Engine pipeline or a connector: that package's tests, plus a real-message E2E suite for protocol changes.
   - Throughput or memory: `pnpm soak`.
   - Docs only: check that every command and path you mention exists.
3. **Run them.** Read the output. A passing typecheck is not a test. If a check fails, fix the cause and run it again; never skip, weaken or delete a test to get green.
4. **Check the working agreement.** A bug fix has a test that failed before the fix. A new flow has an automated check. `docs/progress/CHANGELOG.md` has an entry, `DECISIONS.md` has any non-obvious choice, `ROADMAP.md` is ticked or extended, and `AGENTS.md` still tells the truth.
5. **Give the verdict**, as the last thing you say:
   - **DONE**: every applicable check ran and passed. List the commands.
   - **NEEDS YOU**: verified except for a named step only a person can do (for example, look at a device, approve a release tag). Say exactly what and how.
   - **NOT DONE**: what failed, the output that shows it, and what you would try next.

## Rules

- If a check cannot run where you are (no Postgres, no browser), say so in the verdict. Do not mark it passed.
- Say which commands you ran, not which ones should pass.
- Never leave Michael to discover that something was not checked.
