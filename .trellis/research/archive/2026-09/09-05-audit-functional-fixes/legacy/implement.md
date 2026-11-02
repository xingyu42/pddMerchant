# Implementation Plan

## Execution Close-Out

User approved execution; F1-F9 implementation and targeted verification are complete. The original planning checklist below is retained as planned sequencing, not a claim that every proposed red-first test stage or candidate test group was run. Actual acceptance and commands are recorded in prd.md and verification.md: 24 files / 271 tests passed, syntax and diff checks passed. Full-suite isolation could not be established, so unsafe subprocess/JSON-purity candidates were excluded. No commit or archive was performed; M1/M2 remain out of scope.

## Gate And Baseline

- [ ] Obtain approval of prd.md, design.md, and this plan, then activate this task. Keep the audit task unarchived.
- [ ] Refresh git status/diff and read exact source to be edited; retain existing WIP.
- [ ] Load relevant adapter/infra/commands/services/testing specs before edits. Inspect regression test isolation, including auth paths and process mocks.

## 1. Honest Auth And Process Results

- [ ] F2: Add failing event-driven refresher regressions for valid/expired/inconclusive outcomes, exact response matching, no state save on uncertainty, abort, and cleanup.
- [ ] F2: Replace HTTP-only heartbeat/fallback; update fixture and daemon outcome handling. Keep login-required messages exclusive to proven expiry.
- [ ] F3: Add failing mocked startup tests for stale dead state, mismatched launch identity, delayed matching state, timeout, Windows PID difference, and concurrent lock waiters.
- [ ] F3: Implement correlated startup acknowledgement and consistent state checks.
- [ ] F4: Add failing mocked stop tests for denied/ineffective termination and replacement-state races; preserve state on failure.
- [ ] Run safe auth/daemon/lifecycle tests and verify no real process/browser/state access.

## 2. Deadline And Diagnosis Context

- [ ] F1: Add live-branch fake-time regression with cooperative abort work, plus success/failure cleanup and exactly-once envelope checks.
- [ ] F1: Fix timer lifetime without changing envelope ownership or leaving detached work.
- [ ] F9: Test and fix complete ctx propagation in orders/inventory/promo/funnel standalone handlers.
- [ ] Run safe runner, abort, endpoint budget, and diagnosis-context regressions.

## 3. Data And Recommendations

- [ ] F7: Inventory fixture-required fields and existing response-shape error convention; add malformed-success and explicit-empty/zero cases for goods and entity/hourly promo.
- [ ] F7: Validate response shapes before zero-producing normalization; preserve supported field aliases.
- [ ] F6: Add goods-only, orders-only, both-incomplete, and complete cases across collectors, inventory, segmentation, and action outputs.
- [ ] F6: Carry independent flags and additive quality details through command/service/rendering boundaries.
- [ ] F8: Add regression from interrupted order scan to final action list, including legacy partial segmentation input; omit unsupported clearance actions.
- [ ] F8: Preserve directly supported facts and legitimate complete-scan zero-sales behavior.
- [ ] F5: Add break-even tests below/equal/above 2 and verify action direction; fix classification precedence.
- [ ] Keep M1/M2 deferred; do not mix in generic collection or matching refactors.

## 4. Integrated Verification

- [ ] Run relevant permanent tests under test/, not the historical audit observation suite as a green gate.
- [ ] Candidate groups after isolation inspection: auth-refresher-lifecycle, daemon-lifecycle, login-daemon-autostart, runner-contract, run-endpoint, promo-endpoint, promo-roi, goods-collector, goods-segmentation, diagnose-scoring, action-plan, envelope/error/JSON-purity, layering-guard, plus new regression files.
- [ ] Use node node_modules/vitest/vitest.mjs run <safe-files>; record exact commands/counts/failures. Do not invoke uninspected subprocess tests.
- [ ] Because shared contracts change, attempt to establish safe full-suite isolation. Run npm test only after it is proven; otherwise clearly report that full-suite validation remains incomplete.
- [ ] Recheck fixes against all F1-F9 acceptance criteria and cross-layer consumers; address errors found within scope directly.
- [ ] Update executable specs for changed outcomes/quality fields, without rewriting historical audit observations.
- [ ] Check git diff --check and final scoped diff; report original WIP separately. No lint/build success claim for no-op/missing scripts.
- [ ] Deliver concise fix summary, verification evidence, compatibility notes, and residual gaps. Leave all changes uncommitted and unarchived.

## Stop Conditions

Stop affected work if existing WIP changes concurrently in conflict, a test can touch live state, or implementation requires a materially different compatibility policy. Do not run unsafe tests or broaden the architecture silently. Do not invoke archive/journal helpers that create commits.
