# Offline Business Test Design

## Decision

Rebuild a bounded behavior-focused suite with the already installed Vitest 4.1.5, JavaScript ESM and `node:assert/strict`. Do not restore or inspect deleted tests, add packages, change production code, or pursue a coverage percentage. Preserve `vitest.config.js` and `package.json` unless a separately approved necessity appears.

The existing fixture adapter is production code, not a deleted test artifact. Reuse that boundary but generate every fixture and helper afresh from current contracts.

The authoritative source baseline is now `c6a0b133cc3e32245e9401d1088223b1da623828`. Automated operating advice and assessments were deliberately removed. Test existing factual calculations only; never implement removed rules to make a test pass. The user explicitly excluded deleted-feature regression coverage, including removed-command rejection and deleted-field absence checks. The side task's temporary 30-test result is historical execution information only, not reusable tests or a current pass.

## Skills And Specifications

- `pdd-testing-troubleshooting`: framework, test layers, fixture boundaries and honest verification.
- `pdd-architecture-navigation`: public command/service/adapter/infra boundaries.
- `pdd-command-feature-development`: validation, dry-run/write and batch semantics.
- `pdd-adapter-auth-integration`: external-boundary isolation, synthetic state and secret handling.
- `trellis-start`, `trellis-brainstorm`, `trellis-before-dev`: task gates, persisted planning and implementation guidelines. Use `trellis-check` locally after implementation.
- Specifications read: `standards/{index,testing,coding-style}.md`, `architecture/{index,dependency-flow,runtime-lifecycle}.md`, `services/{index,domain-service-contracts}.md`, `commands/command-contracts.md`, `adapter/{index,fixture-mode}.md`, `infra/{index,envelope-errors-output,logging-redaction}.md`, and `guides/{index,cross-layer-thinking-guide}.md`. Service and command contracts were reread after the removal commit.

Project-local skills already cover the requested stack and objectives. No external skill installation or dependency research is necessary. References in those skills to deleted helpers are unavailable and must not be recovered.

## Test Boundaries

| Boundary | What executes for real | Controlled substitute | Why it is useful |
| --- | --- | --- | --- |
| Order endpoint contracts | Exported `ORDER_LIST`, `ORDER_DETAIL`, `ORDER_STATS` normalization/error mapping | Synthetic raw platform-shaped values | Detect a success-shaped but incomplete response instead of masking it as zero. |
| Goods services | Public `updateGoods*` and validators, plus `runEndpoint` wrapper | Existing `ctx.client.execute` seam, with fixture mode disabled for these cases | Observe write payload values, SKU identity, error propagation and absence of calls on invalid input without a browser. |
| Business calculations | `computeOrderStats`, `segmentGoods`, `analyzePromoRoi` | Explicit arrays and options; fixed time only where defaults use time | Verify factual aggregates, uncertainty, matching and ratios without mocking the calculation under test. |
| Diagnosis summaries and comparison | `summarizeOrders/Inventory/Promo/Funnel`, `diagnoseShop`, `compareShopDiagnosis` | Synthetic independent sources and explicit current/previous windows | Verify missing-source visibility, data-availability status and numeric changes without inventing historical snapshot data. |
| Goods command orchestration | Actual exported command wrappers, services and envelope finalizer | Instrumented fixture dispatch plus an output-only `emit` spy | Validate dry-run, batch preflight, sequential continuation and all-account rejection without replacing `withCommand` with a fake. The spy captures the real envelope and prevents test-runner stdout pollution. |
| CLI process | `node bin/pdd.js`, Commander, runner, services, fixture adapter, finalizer and emitter | Fresh temp fixtures and isolated environment | Prove the actual stdout line count, redaction and operating-system exit code. |

### Fixture Limit

`src/adapter/run-endpoint.js:8` directly short-circuits to `mockRunEndpoint` in fixture mode. This does NOT run the live endpoint normalizer, acquire rate-limiter tokens, or prove browser transport behavior. Consequently endpoint tests use raw shapes, while CLI fixtures use service-facing shapes. Neither test layer substitutes for the other.

`src/adapter/fixtures/endpoint.js:21` selects `<name>.page<N>.json`, falling back to the base file for page 1. Explicit second-page fixtures may test option routing; no synthesized later order page is assumed because `ORDER_LIST` has no `fixtureListKey`.

There is no date-window fixture mapping in this adapter. The CLI comparison test deliberately uses the same synthetic values for both windows and checks adjacent windows, zero delta and snapshot semantics. Distinct positive/negative changes and missing prior values are covered directly through `compareShopDiagnosis`, not through fabricated previous-window fixture filenames.

## Scenario Matrix

| ID | Representative assertions |
| --- | --- |
| B1 | List `{totalItemNum:0,pageItems:[]}` succeeds; missing/invalid required fields throw `E_NETWORK/5`; detail accepts supported identity spellings and rejects absent identity; snake/camel business errors map correctly; explicit page/size/time inputs reach payload; empty and mixed-alias order sets produce expected totals, refund ratios and shipping percentiles without input mutation. |
| B2 | Invalid public write inputs fail with `E_USAGE/2` and no external call; zero stock is valid, zero/fractional price is not; title boundaries and trimming; public service passes correct field/SKU data; no-confirm writes return dry-run with no dispatch; a late invalid batch item prevents every write; success/failure/success continues in input order with exit 7; all-success/all-failure exit 0/6; every write command rejects `allAccounts`. |
| B3 | Sales aggregate across matched order items; stock days follow quantity and observed daily sales when order data is complete; no-sale positive inventory has null stock days. Separately test missing orders, truncated/rate-limited orders, incomplete goods, combined incomplete sources and `goodsTotal > goods.length`; preserve observed sales while unknown full-period sales/stock days are null. Complete empty orders have actual zero sales. Missing IDs use name matching; ambiguous duplicate names are excluded with warnings rather than attributed to an arbitrary item. |
| B4 | Group by plan/SKU/channel; add spend/cost, revenue, clicks and impressions before computing rounded ratios; grouped and overall ROI are ratios of summed amounts, not averages of row ratios. Zero spend means null ROI, positive spend with zero revenue means ROI 0, and zero impressions means CTR 0. Deleted entities are excluded by default with excluded count/spend, and included explicitly. |
| B5 | Representative read/write CLI success, malformed usage, fixture-auth expiry, mapped network/rate/business failures, and partial batch; exactly five envelope top-level keys and one stdout JSON line; `meta.exit_code` equals subprocess status; synthetic sensitive fields in data/error are redacted and nested `raw` is absent. |
| B6 | Each public summary exposes available metrics and identifies missing inputs; missing order counter/list sources remain distinguishable. Inventory missing/truncated/rate-limited order enrichment yields null `stale_count/stale_sample`, not a complete zero-sales conclusion; goods/order quality flags remain independent. Missing promo spend gives partial/null, explicit zero spend gives full/null ROI; a complete empty funnel gives total 0 and null fulfillment ratio. `diagnoseShop` is full only when every dimension is full and prefixes aggregated hints/issues with their dimension. Compare positive, negative and zero numeric changes; previous zero/missing means null percentage change; absent values stay null. Every inventory metric plus orders `unship/delay` has `previous/delta/delta_pct:null` and `note:'current_snapshot_only'`. |

### Scope Boundary

Test supported public behavior only. Deleted-feature coverage is excluded by the user: do not add rejection tests for old commands/options, assertions that deleted fields remain absent, or source keyword guards for those features. Existing `status`, reporting `level`, advertising `plan_id`, data-availability states and numeric metrics remain ordinary domain data. `stale_count` counts observed zero-sales goods when order enrichment is complete.

No test will bless ambiguous coercion, absent pagination validation, duplicate counting or broad unknown-to-zero behavior merely because it exists. For example, `summarizeOrders` currently defaults missing individual counters inside a provided `stats` object to zero; distinguish a missing source from malformed accepted source data, rather than claiming universal missing-field rejection. Establish required upstream shape failures in B1 and report any newly proven gap without production edits.

## Isolation And Cleanup

Create the new `test/setup.js` required by the existing configuration. Limit it to fresh environment isolation and Vitest cleanup; it must not mock business modules globally. Install per-test spies before relevant imports where needed, restore mocks/environment/timers after each test, and remove only the temporary directories owned by that test.

For CLI processes, build a sanitized environment before starting Node. Do not forward inherited `PDD_*`, `NODE_OPTIONS`, `NODE_PATH`, or account credentials. Preserve only required OS/runtime environment values, then set:

```text
PDD_TEST_ADAPTER=fixture
PDD_TEST_FIXTURE_DIR=<unique absolute temp>/fixtures
PDD_AUTH_STATE_PATH=<temp>/merchant-auth.json
PDD_CONSUMER_AUTH_STATE_PATH=<temp>/consumer-auth.json
PDD_ACCOUNTS_DIR=<temp>/merchant
PDD_ACCOUNT_REGISTRY_PATH=<temp>/merchant-registry.json
PDD_CONSUMER_ACCOUNTS_DIR=<temp>/consumer
PDD_CONSUMER_ACCOUNT_REGISTRY_PATH=<temp>/consumer-registry.json
PDD_LOG_LEVEL=fatal
NO_COLOR=1
```

Keep fixture mode non-overridable in the subprocess helper. Add explicit auth-failure overrides only to the affected case. Use subprocess timeouts, bounded output and `try/finally` cleanup. Guard unexpected network/browser entry at test-only seams where applicable; no ordinary test starts a browser.

The fresh `offline-preload.js` blocks TCP socket connect, fetch and three Chromium entry points before the CLI imports. Pass it to Node `--import` as a file URL, not a Windows drive path. A standalone guard probe verified all five entry points throw before IO. The public command wrapper always emits; its second argument only accepts `runtimeConfig`, so command tests use an output-boundary spy rather than an unsupported `emitResult:false` option.

Production config paths are fixed in `src/infra/paths.js:17`; there is no supported config-file environment override. Planning inspection found no local `config/config.json`. For repeatable CLI cases, explicitly set every schema-backed public configuration environment value from the committed baseline. If a local config later becomes invalid, report it as an environment issue; never overwrite it or create a fake production override. Inspect the final helper against this limitation before claiming independence.

CLI log files also have fixed production paths (`src/infra/logger.js:223`). `fatal` is a supported log level (`src/infra/config.js:28`), and log destinations open lazily (`src/infra/logger.js:172`). Selected tests must not intentionally exercise fatal logging or daemon startup. Do not add the unsupported `PDD_LOG_DESTINATION` setting.

## Files And Responsibilities

- `test/setup.js`: fresh minimal isolation/cleanup required by current Vitest configuration.
- `test/helpers/isolated-cli.js`: fresh temp fixture and sanitized subprocess helper; no test-owned domain rules.
- `test/helpers/offline-preload.js`: fail-closed network/browser guard in the CLI child process.
- `test/adapter/orders-contract.test.js`: raw response shape, detail error and request parameter contracts.
- `test/services/orders-statistics.test.js`: public order aggregate calculations.
- `test/services/goods-write-contract.test.js`: public validation and service-to-adapter write boundary.
- `test/services/goods-segmentation-contract.test.js`: sales, stock days, completeness and matching.
- `test/services/promo-roi-contract.test.js`: factual money grouping, zero denominators and inactive filtering.
- `test/services/diagnose-facts.test.js`: four public summaries, missing sources, aggregate availability and numerical comparison/snapshot contracts.
- `test/commands/goods-write-contract.test.js`: actual command write guards, preflight and batch outcomes.
- `test/e2e/business-contract.e2e.test.js`: representative CLI stdout, exit codes and redaction.
- `test/e2e/factual-surface.e2e.test.js`: supported factual query outputs and numeric diagnosis comparison.

Use synthetic in-test objects and temporary fixture files rather than recreating a large checked-in fixture tree. New filenames describe current responsibilities rather than reproducing historical file counts. Only the configured `test/setup.js` path is necessarily reused; its content is entirely new.

## Compatibility And Risks

No runtime or dependency migration. No new PBT harness is needed; deterministic table-driven tests cover the selected finite boundaries. Existing fast-check may be used only if a concrete invariant requires it, not to inflate counts.

If a legitimate new test exposes a business defect, preserve the failing evidence and report it separately. Do not weaken the expected business contract, skip the test silently, or patch production code without approval. Review raw fixtures and test failures for synthetic-only data.

This first suite does not establish real platform compatibility, comprehensive endpoint coverage, account concurrency, daemon process survival, browser retry/rate-limit behavior or goods publishing safety. Deleted-feature regression coverage is also excluded. `npm run test:endpoints` still targets a deleted historical file and is not a validation gate for this scope; do not claim it passed.

## Rollback

Remove only files authored for this task if the user requests rollback. Do not restore deleted historical tests, reset Git, modify `.gitattributes`, touch real data, commit, or archive as a side effect.
