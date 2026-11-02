# Rebuild offline business regression tests

## Goal

Create useful automated tests for existing factual reporting and write safety, protecting current business contracts without real accounts or network services.

## Confirmed Background

- The user intentionally deleted the old test suite and explicitly prohibits using it as a reference. Preserve those deletions; author all tests, fixtures, and helpers from scratch.
- The user approved task creation and planning on 2026-09-05, then authorized implementation with "开始执行" after excluding deleted-feature regression tests.
- The user's later direction, forwarded from the side task, removes automated operating actions, health scores, goods grades and promo quality classifications. Current HEAD was verified as `c6a0b133cc3e32245e9401d1088223b1da623828` (`refactor: remove automated operating advice and assessments`). This revised scope supersedes the earlier advice-oriented B3/B4 plan; removed functionality must not be reimplemented to satisfy tests.
- The user explicitly excluded deleted-feature regression tests. Test existing functionality only; do not test removed command/option rejection or the absence of deleted assessment fields.
- `package.json:14` defines `npm test` as `vitest run`; JavaScript ESM, Vitest, and fast-check are already declared dependencies.
- `vitest.config.js:15` discovers `test/**/*.test.js`, and `vitest.config.js:16` still references the deleted `test/setup.js`.
- `.trellis/spec/standards/testing.md:28` defines Vitest plus `node:assert/strict` and isolated fixture-based command tests as project conventions.
- The pre-implementation working tree contained no `test/` files. After verifying the new HEAD, `npm test -- --reporter=dot` was rerun on 2026-09-05 with Vitest 4.1.5 and exited 1: `No test files found`. The side task's reported temporary 30-test pass is not current-suite evidence and its tests must not be recovered or reused. Git status showed only the pre-existing staged `.gitattributes`.

## Requirements

- R1: Use project-local skills, specifications, configuration, and current production code as evidence. Do not inspect historical test contents through Git or other history.
- R2: Cover the existing factual business outcomes B1-B6 below. Prioritize externally observable results rather than private implementation details or raw test counts.
- R3: Keep every test deterministic and independent. Use synthetic inputs, isolated temporary files, controlled clocks where required, and mocks or the existing fixture adapter at external boundaries.
- R4: Preserve production logic and unrelated worktree changes. Do not install skills, packages, or browsers, add dependencies, or redesign the testing system.
- R5: Execute the new tests and relevant available regressions after implementation. Report startup failures, actual test failures, skipped tests, and unavailable coverage separately.
- R6: Report adopted skills, scenarios, changed files, verification commands/results, and remaining risks. No commit or archive is authorized.

## Business Scope

| ID | Required outcome | Current evidence |
| --- | --- | --- |
| B1 | Orders: preserve valid zero counts; reject incomplete list/detail/stat responses; preserve supported business error categories; calculate shipping samples, percentiles, refunds and status totals from synthetic orders. | `src/adapter/endpoints/orders.js:4`, `src/adapter/endpoints/orders.js:73`, `src/services/orders.js:35` |
| B2 | Goods writes: reject invalid IDs/values, accept zero stock and trimmed valid titles, keep price in integer cents and SKU identity intact; never write without confirmation or before all batch items pass validation; preserve ordered per-item results and 0/6/7 batch exit outcomes; reject all-account writes. | `src/services/goods.js:43`, `src/services/goods.js:119`, `src/commands/goods/update/price.js:16`, `src/commands/goods/update/batch.js:80`, `src/commands/runner/batch-executor.js:216` |
| B3 | Goods facts: aggregate sales and observed sales, compute stock days only from available orders, preserve independent goods/order completeness and truncation/rate-limit flags, distinguish unknown from actual zero, and exclude ambiguous same-name matches. | `src/services/goods-segmentation.js:31`, `src/services/goods-segmentation.js:95`, `src/services/goods-segmentation.js:118` |
| B4 | Promo facts: group by plan/SKU/channel, aggregate spend/revenue before calculating ROI, distinguish zero spend (null ROI) from zero revenue with positive spend (zero ROI), and respect inactive filtering. No profitability classification or break-even rule remains. | `src/services/promo-roi.js:26`, `src/services/promo-roi.js:38`, `src/services/promo-roi.js:75` |
| B5 | CLI: emit exactly one JSON envelope with the actual process exit code; verify representative success, usage, auth, network, rate-limit and business failures plus batch partial results; redact synthetic sensitive fields and strip raw payloads. | `bin/pdd.js:115`, `src/commands/runner/envelope-finalizer.js:32`, `src/infra/output.js:187`, `src/infra/output.js:268` |
| B6 | Diagnosis facts: use `summarizeOrders/Inventory/Promo/Funnel`, expose metrics and missing-source hints, and use `full/partial` only for data availability. Compare numeric `current/previous/delta/delta_pct`; inventory and orders `unship/delay` are current snapshots with no historical delta. | `src/services/diagnose/index.js:6`, `src/services/diagnose/orders-health.js:1`, `src/services/diagnose/inventory-health.js:149`, `src/services/diagnose/promo-health.js:10`, `src/services/diagnose/funnel-health.js:1`, `src/services/diagnose/trend-compare.js:17`, `src/commands/diagnose/shop.js:79` |

## Acceptance Criteria

- [x] B1-B6 have independent, fresh tests using current code and the project assertion style, with no historical or side-task temporary test reuse (R1, R2).
- [x] Unknown data, actual zero values, incomplete scans, zero denominators and ambiguous matching are distinguishable in supported public outputs (B1, B3, B4, B6).
- [x] Numeric comparison tests protect current-snapshot fields from fabricated historical differences (B6).
- [x] Fresh tests run through the existing Vitest configuration with minimal test-only scaffolding (R3, R4).
- [x] No test reads real account state, uses production data, or depends on an uncontrolled network or timer (R3).
- [x] Targeted tests and the entire newly available suite are run, with a repeatability check and honest results (R5).
- [x] Production files, dependencies, and unrelated changes remain untouched; scope and limitations are recorded in `implement.md` (R4, R6).

## Out of Scope

Restoring or consulting deleted tests, reproducing historical or side-task test counts, deleted-feature regression tests (including removed command/option rejection and deleted-field absence assertions), reintroducing removed operating advice/assessment rules, real browser/platform validation, comprehensive coverage of every command, production bug fixes, new dependencies, test-system redesign, commits, and archival. Browser transport/retries, daemon multi-round survival, auth concurrency, account switching and goods publishing remain follow-up risks, not implied coverage.

## Execution Status

Implementation and main-agent quality review originally completed with 9 test files / 152 tests. On 2026-09-05 the user authorized archive. The working tree was already clean, with the tests and additional shared fixture/assertion helpers in existing commit `1bab59b67b3b82a250fae595eb5a2733b50693ff`. Archive-time full and deterministic shuffled runs each passed 9 files / 168 tests, with 15 test/setup/helper files in total. No new code commit is needed. Task completion and archive location are recorded by the standard Trellis archive command; `implement.md` retains both execution checkpoints and the unchanged remaining risks.
