# Reinvention audit appendix

Run of 2026-11-13 at commit 56d667d. Every group's verdicts and the run evidence are in `verdicts.jsonl`, one line per member with its content hash.

## Canaries

Four functions were planted in a fake `packages/web/src/pages/AuditReportPage.tsx`. They went through describe, grouping, judging and the run like any other row, and are left out of every count in the report.

| Canary | Copied from | Planted difference | Grouped with source | Verdict | Shown by run |
|---|---|---|---|---|---|
| `renderWhen` | `UsersPage.tsx:37 formatDate` | `""` instead of "Never" for null or empty | G0140 | VARIANT | yes: null, undefined, `''`, 0 |
| `humanReadableSize` | `system-health.ts:28 formatBytes` (reduce instead of log) | stops at GB | G0124 | VARIANT | yes: 2^40 gives "1024.0 GB" vs "1.0 TB" |
| `explainFailure` | `cli/src/lib/api.ts:104 describe` | "unknown failure" for non-Errors | G0064 | VARIANT | yes: string, null, plain object |
| `formatBytes` (hex dump) | negative: shares the name and vocabulary | another job | G0124 | DIFFERENT | n/a |

## Per-key hits

Of the 190 groups that hold copies: 126 were found only by the job key (canonical domain plus output kind), 19 only by the name stem, 13 by both, 3 by a cross-part group, and 29 by residual regrouping. The job key found the canary `humanReadableSize`, which shares no stem with its source. The stem key found the negative canary, whose input means something else.

Stop stems, too common to group by name: `update` (36 rows), `delete` (29), `list` (27), `maperrortostatus` (26). The 26 `mapErrorToStatus` copies were still grouped through the job key.

## Residuals not judged

These second-level residual groups, members judged DIFFERENT from a first-level residual's anchor, were not judged again (57 groups, 208 members): G0148.R.R (20), G0063.X.R.R (2), G0012.R.R (9), G0130.R.R (2), G0158.R.R (9), G0157.R.R (7), G0199.R.R (2), G0146.R.R (9), G0168.R.R (5), G0153.R.R (8), G0371.R.R (4), G0261.R.R (4), G0179.R.R (6), G0171.R.R (5), G0185.R.R (3), G0136.R.R (5), G0203.R.R (4), G0096.R.R (2), G0169.R.R (4), G0374.R.R (3), G0022.R.R (2), G0349.R.R (2), G0060.R.R (2), G0152.R.R (3), G0023.R.R (2), G0183.R.R (4), G0254.R.R (2), G0140.R.R (3), G0230.R.R (2), G0144.R.R (3), G0196.R.R (3), G0373.R.R (2), G0382.R.R (2), G0090.R.R (3), G0263.R.R (3), G0190.R.R (3), G0088.R.R (2), G0259.R.R (2), G0091.R.R (2), G0119.R.R (2), G0150.R.R (2), G0208.R.R (2), G0041.R.R (2), G0061.R.R (2), G0024.R.R (2), G0050.R.R (2), G0046.R.R (2), G0133.R.R (5), G0049.R.R (4), G0260.R.R (3), G0039.R.R (2), G0089.R.R (2), G0068.R.R (2), G0069.R.R (3), G0120.R.R (5), G0361.R.R (3), G0015.R.R (3).

## Run conditions

- Node v26.12.1 ran with no install and stripped TypeScript types natively. Every member was copied into its own harness; no repo code was imported.
- The zone probe worked: `2026-03-08T07:30:00Z` gave "3/8/2026, 3:30:00 AM" under America/New_York and "3/8/2026, 7:30:00 AM" under UTC. G0140 ran in both zones.
- Locale was en-US. This ICU puts a plain space before AM/PM, not U+202F.
- The clock was fixed to 2026-11-13T12:00Z inside the harness for `formatUpdated`.
- Network could not be switched off on this Windows host. No member does network I/O.

## Domain mapping

Version 1, 2026-11-13: 201 domains, 900 `domain_in` strings mapped, 0 unmatched, 1 `nojob` domain (D0001 "no input"). The mapper grouped request handlers by what the request carries (entity id, id plus changes, filters, and so on), not by entity. That is why controller handlers for different entities share groups.

## Notes on method

- 27 of the 190 groups that hold copies match only because a judge marked a delegating wrapper or a hook one layer up as VARIANT. The header counts them; they are not reinvention.
- Kinds come from syntax. Override detection uses method names and interfaces from the same repo, and Express `(req, res)` handlers count as framework-bound.
- Groups are ranked by importer count, so large private families (the connector-form getters) rank low.
- Spend is estimated from subagent token totals at list price, assuming 95% input. The 13 judge runs cut off by the rate limit report no usage, and the coordinator is not counted. On a subscription plan the dollar figure is notional.

## Removed since last run

First run; nothing to compare.
