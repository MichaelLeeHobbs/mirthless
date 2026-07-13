<!--
  Thanks for contributing! Please read CONTRIBUTING.md first.
  ⚠️ Do not include PHI, real credentials, or .env files in this PR.
-->

## Summary

What does this PR do and why? Link any related issue (e.g. `Closes #123`).

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Docs / ops / CI only
- [ ] Refactor / internal (no behavior change)

## Changes

- ...

## Testing

How did you verify this? Check all that apply and describe:

- [ ] `pnpm lint` passes (`--max-warnings 0`)
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] Added/updated unit tests for new behavior (incl. unhappy paths)
- [ ] Added/updated real-DB integration tests (for raw-SQL paths)
- [ ] Ran Playwright E2E (`pnpm test:e2e`) where UI is affected
- [ ] Manual verification (describe below)

<!-- Describe manual testing steps and results. -->

## Healthcare / Data-Integrity Checklist

- [ ] No path where a message can be silently lost, duplicated, or corrupted
- [ ] Errors fail loudly (error status / logs / alerts), not silently swallowed
- [ ] No PHI, secrets, or credentials logged in plain text
- [ ] External input validated with Zod at the boundary
- [ ] Services return `Result<T>` (no `throw` for control flow)

## Progress Docs

- [ ] Updated `docs/progress/CHANGELOG.md` (if substantial)
- [ ] Recorded any non-obvious decision in `docs/progress/DECISIONS.md`

## Notes for Reviewer

Anything you want the reviewer to focus on, or known limitations.
