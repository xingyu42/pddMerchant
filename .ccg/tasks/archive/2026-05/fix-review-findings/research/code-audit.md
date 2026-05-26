# Code Audit: fix-review-findings

Scope checked:
- Source of truth 1: `.ccg/tasks/tech-debt-review/FINAL-REPORT.md`
- Source of truth 2: `.ccg/tasks/fix-review-findings/context.jsonl`
- Current source files under `src/`, `bin/`, and related tests

Note: `FINAL-REPORT.md` contains eight remaining Critical/P1 items after two false positives were removed: C1, C2, C4, C6, C7, C8, C9, and C10. `context.jsonl` records five additional goods-publish P0/P1 findings; those are audited separately below.

## Files Found

- `src/commands/_runner.js` - current command runner, moved from the old `src/infra/command-runner.js` path.
- `src/infra/auth-lock.js` - current auth-lock location, moved out of `src/adapter/`.
- `src/infra/account-registry.js` - account registry now imports `./auth-lock.js` and uses `accountRegistryCorrupt`.
- `src/infra/paths.js` - account slug validation now throws `PddCliError`.
- `bin/pdd-daemon.js` - daemon process implementation and remaining global daemon state.
- `src/commands/init.js`, `src/commands/login.js`, `src/commands/account.js`, `src/commands/daemon.js`, `src/commands/doctor.js`, `src/commands/shops/list.js` - command-layer boundary and `withCommand` audit targets.
- `src/adapter/browser.js` - browser lifecycle registry and close logic.
- `src/adapter/goods-publish/category-resolver.js` - external category API and circuit breaker logic.
- `src/adapter/goods-publish/source-scraper.js` - source goods scraping and `page.evaluate` extraction.
- `src/services/goods-publish.js` - goods publish orchestration and draft/confirm handling.
- `src/services/goods-publish/sku-mapper.js` - SKU mapping helper referenced by active task context.

## Dependencies

- Command execution now flows through `src/commands/_runner.js` for wrapped commands; `_runner.js` depends on adapter modules such as `browser`, `auth-state`, `mall-reader`, `mall-writer`, `mock-dispatcher`, `rate-limiter-singleton`, and `page-session`.
- Auth lock now flows `src/infra/account-registry.js -> src/infra/auth-lock.js`, while adapter auth modules import `../infra/auth-lock.js`.
- Login/init/account commands partially flow through `src/services/auth.js`, which wraps adapter login/browser/QR operations.
- Goods publish command flows `src/commands/goods/publish.js -> src/services/goods-publish.js -> adapter goods-publish modules`.
- Category resolution flows `src/services/goods-publish.js -> src/adapter/goods-publish/category-resolver.js -> fetch(CATEGORY_API_BASE)`.

## Finding Status: FINAL-REPORT Eight

1. C1 infra imports adapter - FIXED for the originally reported paths.
Evidence: `src/infra/command-runner.js` no longer exists; command runner is now `src/commands/_runner.js`, where adapter imports are legal for the command layer (`src/commands/_runner.js:2`). `src/infra/account-registry.js` imports `./auth-lock.js` instead of adapter code (`src/infra/account-registry.js:8`). `src/infra/auth-lock.js` exists and `src/adapter/auth-lock.js` is absent. A grep over `src/infra` found no remaining adapter imports.

2. C2 commands directly call adapter instead of services - PARTIALLY FIXED, still present.
Fixed parts: `src/commands/init.js` uses `../services/auth.js` (`src/commands/init.js:1`), and `src/commands/account.js` uses `performPasswordLogin` from services (`src/commands/account.js:14`). Still present: `src/commands/login.js` imports `../adapter/mock-dispatcher.js` (`src/commands/login.js:8`), `src/commands/doctor.js` imports `../adapter/browser.js`, `../adapter/auth-state.js`, and `../adapter/mall-reader.js` (`src/commands/doctor.js:3`, `src/commands/doctor.js:4`, `src/commands/doctor.js:5`), and `src/commands/shops/list.js` imports `../../adapter/mall-reader.js` (`src/commands/shops/list.js:2`).

3. C4 browser lifecycle race / shutdown hang risk - PARTIALLY FIXED, residual issue remains.
Fixed parts: lifecycle registry and idempotency guards now exist with `activeBrowsers`, `closingBrowsers`, and `closeAllPromise` (`src/adapter/browser.js:12`, `src/adapter/browser.js:13`, `src/adapter/browser.js:14`), and `closeBrowser()` skips duplicate close attempts (`src/adapter/browser.js:83`). Remaining risk: `closeAllBrowsers({ timeoutMs = 5000 })` accepts a timeout parameter but does not use it to bound `Promise.allSettled(snapshot.map(...))`, so a hanging close can still hang process shutdown (`src/adapter/browser.js:25`, `src/adapter/browser.js:29`).

4. C6 commands missing `withCommand` - PARTIALLY FIXED, still present.
Fixed parts: `doctor` is wrapped with `withCommand` (`src/commands/doctor.js:92`), and the goods/shops/orders/diagnose commands found in grep use `_runner`. Still present: `init.js` exports plain async `run()` and does not import/use `withCommand` (`src/commands/init.js:90`), `login.js` exports plain async `run()` and does not import/use `withCommand` (`src/commands/login.js:17`), `account.js` exports plain async subcommands without `withCommand` (`src/commands/account.js:17`, `src/commands/account.js:100`, `src/commands/account.js:124`, `src/commands/account.js:156`), and `daemon.js` exports plain async subcommands without `withCommand` (`src/commands/daemon.js:24`, `src/commands/daemon.js:62`, `src/commands/daemon.js:135`).

5. C7 daemon `console.error` logging - FIXED for the original finding, with one stderr fallback remaining.
Evidence: `bin/pdd-daemon.js` no longer contains `console.error`. Fatal handling now calls `log.fatal(...)` (`bin/pdd-daemon.js:267`). There is still a direct `process.stderr.write(...)` fallback in the same catch block (`bin/pdd-daemon.js:269`), but the specific `console.error` finding is fixed.

6. C8 raw `Error` instead of `PddCliError` in infra paths/account-registry - FIXED for the original findings.
Evidence: `src/infra/paths.js` imports `PddCliError` and `ExitCodes` (`src/infra/paths.js:4`) and throws `PddCliError` for invalid or escaping slugs (`src/infra/paths.js:32`, `src/infra/paths.js:42`). `src/infra/account-registry.js` uses `accountRegistryCorrupt(...)` for JSON parse, schema mismatch, and invalid slug paths (`src/infra/account-registry.js:65`, `src/infra/account-registry.js:68`, `src/infra/account-registry.js:121`), and `accountRegistryCorrupt` returns `PddCliError` (`src/infra/errors.js:66`).

7. C9 category-resolver external API resilience / SSRF concern - PARTIALLY FIXED, still present.
Fixed parts: `CATEGORY_API_BASE` is centralized and configurable (`src/adapter/goods-publish/category-resolver.js:5`), request timeout/retry/circuit state exists (`src/adapter/goods-publish/category-resolver.js:6`, `src/adapter/goods-publish/category-resolver.js:7`, `src/adapter/goods-publish/category-resolver.js:10`), and failures increment the breaker only after final retry (`src/adapter/goods-publish/category-resolver.js:48`). Still present: the default third-party dependency remains `https://api.gj.dangxun.com` (`src/adapter/goods-publish/category-resolver.js:5`), failure still throws `E_NETWORK` instead of returning a fallback category result (`src/adapter/goods-publish/category-resolver.js:53`), and `PDD_CATEGORY_API_BASE` accepts an arbitrary base URL without allowlist validation (`src/adapter/goods-publish/category-resolver.js:5`).

8. C10 daemon global state management - STILL PRESENT.
Evidence: daemon state is still held in module-level mutable variables: `shuttingDown`, `abortController`, `refreshInProgress`, `currentRefreshPromise`, `refreshTimer`, `config`, and `log` (`bin/pdd-daemon.js:18` through `bin/pdd-daemon.js:24`), plus counters/state objects (`bin/pdd-daemon.js:27` through `bin/pdd-daemon.js:29`). No encapsulating state object or class is present.

## Active Context Addendum: goods-publish Findings

1. P0 `sku-mapper` index misalignment in `formatSpecText` - LIKELY FIXED.
Evidence: `mapSourceSkus()` filters active dimensions first (`src/services/goods-publish/sku-mapper.js:51`), builds `valueArrays` from the same `activeDims` (`src/services/goods-publish/sku-mapper.js:52`), and passes `activeDims` plus each generated combo to `formatSpecText` (`src/services/goods-publish/sku-mapper.js:78`). `formatSpecText()` indexes the combo against that same filtered dimension array (`src/services/goods-publish/sku-mapper.js:40`), so empty dimensions should not produce `undefined` in spec strings.

2. P0 `--confirm` reports submitted but never calls submit endpoint - FIXED by early rejection, not by implementing submit.
Evidence: `src/commands/goods/publish.js` passes `draftOnly: !confirm` into the service (`src/commands/goods/publish.js:23`). `publishGoodsFromLink()` now rejects non-draft mode before doing work with message "`--confirm` ... 暂未实现" (`src/services/goods-publish.js:34`, `src/services/goods-publish.js:37`). Therefore current code should no longer falsely report a submitted publish, but it still does not call `GOODS_PUBLISH_SUBMIT`.

3. P1 category HTTP error resets failure counter / breaker never trips - FIXED for HTTP/network failures.
Evidence: successful responses reset `consecutiveFailures = 0` only after `response.ok` and JSON parse (`src/adapter/goods-publish/category-resolver.js:35` through `src/adapter/goods-publish/category-resolver.js:40`). HTTP errors throw before the reset (`src/adapter/goods-publish/category-resolver.js:36`, `src/adapter/goods-publish/category-resolver.js:37`), and final retry failure increments `consecutiveFailures` (`src/adapter/goods-publish/category-resolver.js:48`) and can trip cooldown (`src/adapter/goods-publish/category-resolver.js:49`).

4. P1 `page.evaluate` closure cannot access Node.js `goodsId` - FIXED.
Evidence: `scrapeSourceGoods()` passes `goodsId` into `page.evaluate` as the argument `nodeGoodsId` (`src/adapter/goods-publish/source-scraper.js:142`, `src/adapter/goods-publish/source-scraper.js:200`) and uses `String(nodeGoodsId)` in the browser context (`src/adapter/goods-publish/source-scraper.js:181`).

5. P1 dead code submodules never imported - STILL PRESENT by design.
Evidence: `src/services/goods-publish.js` contains an explicit note that `payload-builder`, `property-matcher`, and `sku-mapper` are Phase 2 API-based publish-path modules and are currently unused by active UI automation (`src/services/goods-publish.js:16` through `src/services/goods-publish.js:18`). They are still imported by tests, but not by production goods-publish orchestration.

## Patterns

- Current command runner location pattern is `src/commands/_runner.js`; command modules import it with relative paths such as `../_runner.js` or `../../_runner.js`.
- Error handling pattern is `PddCliError` plus `ExitCodes`; helpers such as `accountRegistryCorrupt()` in `src/infra/errors.js` wrap common infra errors.
- Goods-publish currently favors UI automation and draft creation; unsupported automatic submission is rejected early rather than simulated.
- Category resolver has local module-level circuit state rather than the shared `src/infra/circuit-breaker.js`.

## Risks

- The "8 findings" set is inferred from `FINAL-REPORT.md` after removing C3 and C5 false positives; `fix-review-findings/context.jsonl` contains a different five-row goods-publish list. Both were audited to avoid losing scope.
- Several fixes are partial: command boundary and `withCommand` adoption are not complete, browser close timeout is not enforced, and category resolver still depends on an unrestricted external base URL.
- No tests were run for this audit; status is based on static source inspection only.
