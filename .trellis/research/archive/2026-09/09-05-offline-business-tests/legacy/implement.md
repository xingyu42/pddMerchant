# Execution And Verification Plan

## Gate

- [x] User confirmed intentional old-test deletion and prohibited historical reference.
- [x] User approved creating this task and entering planning.
- [x] Main agent read project skills, architecture, testing specs, configuration and source; read-only scouts supplied narrow evidence. After the direction change, service/command specs and changed factual outputs were rechecked.
- [x] Verified HEAD `c6a0b133cc3e32245e9401d1088223b1da623828`; Git status contained only pre-existing staged `.gitattributes`, and path inventory found no current `test/` files.
- [x] Baseline `npm test -- --reporter=dot` was rerun after that HEAD check: Vitest 4.1.5, no test files, exit 1. Do not reuse or claim the side task's temporary 30-test pass as current evidence.
- [x] PRD narrowed to B1-B6: factual statistics, write safety and diagnostic availability/comparison. The user explicitly excluded deleted-feature regression tests.
- [x] User approved this final scope with "开始执行".
- [x] Activated using `python ./.trellis/scripts/task.py start .trellis/tasks/09-05-offline-business-tests --allow-empty-context`. The first call without this inline-mode option rejected empty JSONL manifests. Activation succeeded in degraded mode because session identity was unavailable; the task is `in_progress`, but no session active pointer was persisted.

Codex mode is inline: the main agent writes and checks tests. Do not dispatch implementation or check agents. JSONL dispatch manifests are not required for this inline task.

## Ordered Work

1. Load `trellis-before-dev`, the revised B1-B6 artifacts and relevant spec checklists. Recheck HEAD, `git status --short`, package/config files and local config presence without inspecting deleted tests or side-task temporary test contents. Keep all unrelated WIP and the intentional feature removals.
2. Create fresh `test/setup.js` and the smallest isolated CLI helper. Verify temp paths, environment scrubbing, cleanup, fixed-config limitations and absence of account/network access before using them.
3. Write order endpoint/statistics and goods write service tests from public contracts. Use explicit expected values, including no external call on invalid input. Do not copy actual outputs into expected fixtures.
4. Write goods sales/inventory and promo ratio tests from B3-B4. Cover independent incomplete sources, observed-versus-full-period sales, actual zeros, stock-day availability, ambiguous names, grouping, excluded inactive rows, rounding and zero denominators. Do not test removed profitability or operating-decision rules.
5. Write actual goods command tests using the existing fixture boundary for dry-run, whole-batch validation, continuation and all-account rejection. Do not stub out the command wrapper under test.
6. Write B6 tests against the four `summarize*` exports, `diagnoseShop`, and `compareShopDiagnosis`. Verify data-availability states and missing-source hints, actual metrics, current/previous/delta/delta_pct, null percentage changes with zero/missing prior values, and snapshot-only inventory/unship/delay metrics.
7. Add subprocess E2E tests with fresh service-facing fixtures for existing factual query output, comparison, one JSON line, exit status, error category, raw stripping and redaction. Keep calculation tables in unit tests; do not add tests for deleted commands/options or assertions that deleted fields remain absent.
8. Run targeted commands, then the entire newly available suite, then a deterministic shuffled repeat. Investigate failures by checking fixture/expectation accuracy first; preserve true business defects without fixing production. Never restore a removed assessment feature to satisfy a test.
9. Load `trellis-check` and perform main-agent quality review: revised B1-B6 compliance, no deleted-feature test coverage, fresh-content origin, no private-detail assertions, meaningful negative controls for existing features, no leaked spies/env/timers/temp state, no real accounts/network, no production edits. Update task results and only factual test documentation needed for this new scope.
10. Report skills, covered scenarios, paths, exact run results, skips/failures and follow-up risks. Do not commit or archive.

## Planned Commands

Use the installed Vitest via npm so no install is triggered:

```bash
npm test -- test/adapter/orders-contract.test.js test/services/orders-statistics.test.js test/services/goods-write-contract.test.js
npm test -- test/services/goods-segmentation-contract.test.js test/services/promo-roi-contract.test.js
npm test -- test/services/diagnose-facts.test.js test/e2e/factual-surface.e2e.test.js
npm test -- test/commands/goods-write-contract.test.js test/e2e/business-contract.e2e.test.js
npm test -- --reporter=dot
npm test -- --reporter=dot --sequence.shuffle --sequence.seed=20260905
git diff --check
git diff --name-status
```

Check installed Vitest CLI help before using the shuffle flags if uncertain. If a run is blocked by sandbox permissions, request the normal-permission rerun rather than calling it a product defect. If a failure is order-sensitive, retain the exact seed and compare targeted versus full runs. A nonzero existing failure is not a pass, and absence of old tests prevents any claim of historical-suite regression coverage.

Do not use `npm run lint` as evidence: it is `echo no-lint`. There is no build command. `npm run test:endpoints` still refers to a deleted old file; restoring that unrelated script target is not part of B1-B6.

## Review And Reporting

Inspect only current new file contents and scoped diff metadata; do not use history or full diffs that reveal deleted historical test bodies. For unrelated paths, metadata suffices. `test/setup.js` remains a required fresh file at the configured path, not a reason to recover its history.

Review scenarios against B1-B6 and the explicit exclusions. Do not expand existing-feature tests into deleted-command rejection, deleted-field absence assertions, or keyword guards for removed features.

Results must distinguish:

- Post-removal pre-implementation baseline: no test files, exit 1; no currently passing regression suite exists.
- Side-task temporary test results: reported historical evidence only, never claimed as current tests or reused.
- New test failures caused by an incorrect test setup or expectation, corrected in tests only.
- Verified current business defects, left unmodified and explicitly reported if discovered.
- Environment/sandbox failures, with the actual retry and outcome.
- Unrun real-platform and out-of-scope behaviors.

The final artifacts remain uncommitted and unarchived until the user separately authorizes version-control and archival actions.

## Execution Results (2026-09-05)

Implemented all B1-B6 scenarios using fresh synthetic inputs. No production files, packages, config or historical tests were edited/restored. The pre-existing staged `.gitattributes` remains untouched.

| New test file | Passing cases | Responsibility |
| --- | ---: | --- |
| `test/adapter/orders-contract.test.js` | 27 | Raw shapes, actual zero, endpoint success/error mapping and request parameters |
| `test/services/orders-statistics.test.js` | 4 | Shipping samples/percentiles, status totals and refunds |
| `test/services/goods-write-contract.test.js` | 30 | ID/value boundaries, SKU payloads and error propagation |
| `test/services/goods-segmentation-contract.test.js` | 13 | Sales, stock days, incomplete sources and name ambiguity |
| `test/services/promo-roi-contract.test.js` | 11 | Grouped money/ratio calculations and inactive filtering |
| `test/services/diagnose-facts.test.js` | 20 | Source availability, numerical comparisons and current snapshots |
| `test/commands/goods-write-contract.test.js` | 28 | Real command wrappers, dry-run, preflight, sequential writes and batch exits |
| `test/e2e/business-contract.e2e.test.js` | 12 | CLI stdout, process exits, redaction and write routing |
| `test/e2e/factual-surface.e2e.test.js` | 7 | Factual query options, enrichment, partial sources and comparison wiring |

Fresh infrastructure files: `test/setup.js`, `test/helpers/isolated-cli.js`, `test/helpers/offline-preload.js`. The existing `vitest.config.js` and `package.json` are unchanged.

### Commands Actually Run

| Command | Actual result |
| --- | --- |
| `npm test -- test/adapter/orders-contract.test.js test/services/orders-statistics.test.js test/services/goods-write-contract.test.js` | 3 files / 61 passed, exit 0 |
| `npm test -- test/services/goods-segmentation-contract.test.js test/services/promo-roi-contract.test.js test/services/diagnose-facts.test.js` | Initial test-table error: 43 passed / 1 failed. After correcting the new test only: 3 files / 44 passed, exit 0 |
| `npm test -- test/commands/goods-write-contract.test.js` | 1 file / 28 passed, exit 0 |
| `npm test -- test/e2e/business-contract.e2e.test.js test/e2e/factual-surface.e2e.test.js` | Initially 19 startup failures in the new helper. After Windows preload URL correction: 2 files / 19 passed, exit 0 |
| `npm test -- test/e2e/business-contract.e2e.test.js -t 'preserves an actual empty'` | Diagnostic run before the correction: 1 failed / 11 filtered-out, confirmed `ERR_UNSUPPORTED_ESM_URL_SCHEME` |
| `npm test -- --help --sequence` | Verified installed Vitest shuffle/seed options, exit 0 |
| `PDD_TEST_AUTH_INVALID=1 PDD_TEST_ADAPTER=live PDD_TEST_FIXTURE_DIR=/invalid-synthetic-fixtures npm test -- test/services/goods-write-contract.test.js test/commands/goods-write-contract.test.js test/e2e/business-contract.e2e.test.js` | After final assertion improvements: 3 files / 70 passed, exit 0; inherited invalid test settings were isolated |
| `npm test -- --reporter=dot` | Final code: 9 files / 152 passed, 0 skipped, exit 0; 18:21:09 local start |
| `npm test -- --reporter=dot --sequence.shuffle --sequence.seed=20260905` | Final code: 9 files / 152 passed, 0 skipped, exit 0; 18:21:24 local start |
| `npm run lint` | Exit 0 but only `echo no-lint`; NOT meaningful lint validation |
| `rg --files test -g '*.js' -0 \| xargs -0 -n 1 node --check` | All 12 JavaScript files passed syntax checks, exit 0 |
| `git diff --check` | Exit 0; tracked-path check only |
| `git diff HEAD --name-status` | Only the pre-existing staged `.gitattributes`; no production modifications |
| `git status --short --untracked-files=all` | Only `.gitattributes` and the 12 newly authored test files |

Additional read-only probes: all five offline guard entry points threw before IO; all 12 new JS files passed explicit ASCII/trailing-whitespace/final-newline checks; no `pdd-cli-*` or `pdd-unit-*` temp directories remained. The initial untracked-file `git diff --no-index --check` pipeline returned 123 because its added-file comparisons return 1 (plus local LF/CRLF conversion notices), not a reported whitespace defect; the explicit source check and syntax checks above passed.

### Failure Classification

- Pre-existing baseline: no test files (exit 1), not a known failing business test. Historical-suite regressions cannot be claimed.
- New test authoring error: `it.each` spread an array row into arguments instead of passing an entity array. Wrapped the test parameter in `{ items }`; production code was unchanged.
- New helper authoring error: a Windows drive path passed to Node `--import` was rejected as URL scheme `d:` before CLI startup. Switched to `new URL(...).href` and added an empty-stdout assertion including stderr. No business assertions were weakened.
- Main review strengthened invalid-ID tests to use a valid write value, and added an in-flight boundary counter to prove batch writes settle sequentially. Targeted, full and shuffled validation passed after these edits.
- No verified production defect was exposed by these selected tests. Final full/shuffled runs contain no skipped tests.

### Quality Review And Remaining Limits

- Main agent reviewed current test files against project testing/coding conventions and B1-B6; no private implementation mocks, deleted-feature assertions or historical reuse were added. Command mocks stop at fixture dispatch and output emission; subprocess tests use the real emitter.
- Both fixture and browser/network boundaries are isolated. This does not verify real browser transport, retry/rate-limiter algorithms, platform response compatibility, auth/account concurrency, daemon survival or goods publishing.
- The page-based fixture adapter cannot supply different time-window results. Distinct numerical changes are unit-tested; CLI comparison proves option/window/snapshot wiring only.
- An invalid future local `config/config.json` can still block CLI startup because production has no config-file override. Tests supply every public schema-backed config environment setting from the committed example, but do not overwrite the local file.
- No build/type-check scripts exist, lint is a no-op, and `test:endpoints` still references an intentionally deleted old file. That script was not run or repaired within this scope; there is no claim of meaningful lint, build, real-platform or historical-suite coverage.
- `trellis-check` was completed locally. `trellis-finish-work` was read, but its commit/archive/journal-auto-commit steps were not executed because current task code is uncommitted and no commit/archive was authorized. Task status stays `in_progress` with implementation/verification complete.

## Archive-Time Verification (2026-09-05)

The user subsequently requested archive. Live inspection found a clean worktree and existing commit `1bab59b67b3b82a250fae595eb5a2733b50693ff` (`Add union merge driver for Trellis journals`) containing the tests. No new code commit was made in the archive turn. The commit includes subsequent shared-fixture/assertion organization: `test/fixtures/test-data.js`, `test/helpers/envelope-assertions.js` and `test/helpers/error-matchers.js`; task `relatedFiles` now lists all 15 current test/setup/helper files. The original implementation's 152-test results above remain historical, not the current count.

- `npm test -- --reporter=dot`: 9 files / 168 passed, no skips, exit 0 (22:45:28 local start).
- `npm test -- --reporter=dot --sequence.shuffle --sequence.seed=20260905`: 9 files / 168 passed, no skips, exit 0 (22:46:36 local start).
- `git status --short --untracked-files=all`: clean before archival.
- Only `09-05-offline-business-tests` is approved for archival. Use the existing archive command with `--no-commit --skip-branch-validation`: the task was never PR-backed and has branch/base `main`, so the documented self-referential-metadata option applies. Record the local journal with `--no-commit` as well. Do not create a new task or archive any unrelated task.
- The original limitations remain: these results do not validate real platform/browser/auth concurrency, daemon survival, network retry algorithms or goods publishing.
