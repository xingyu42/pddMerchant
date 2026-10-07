# CLAUDE.md

@AGENTS.md

## Claude Code Notes

- The `pdd-*` project skills under `.agents/skills/` are not auto-discovered by Claude Code; when a task matches one, read `.agents/skills/<name>/SKILL.md` directly.

## Commands

```bash
npm test                              # Run all tests (vitest)
npx vitest run test/<file>.test.js    # Run a single test file
npx patchright install chromium       # Required: install the fallback Chromium runtime
```

## Architecture

```
bin/pdd.js               CLI entry (signal/fatal handlers, global options, wireAction; registration delegated to registry/)
src/commands/            Command handlers — thin wrappers around withCommand()
src/commands/registry/   Domain registrars `register(program, wireAction)` — adding a command touches only the command file + its registrar
src/commands/runner/     withCommand internals (envelope-finalizer / fixture-runtime / single-lifecycle / batch-executor); _runner.js is a facade
src/services/            Domain logic (orders, goods, promo, diagnose, promo-roi, goods-segmentation); factual reporting without operating advice or scores
src/services/views/      Domain views (anti-corruption layer): whitelist projection of upstream payloads, unit/label conversion, headline; labels.js owns all enum→Chinese tables
src/adapter/             Playwright integration, XHR interception, auth, mall context
src/adapter/fixtures/    Mock-mode providers (core.js owns the single fixture cache); mock-dispatcher.js is a facade
src/infra/               Cross-cutting: envelope, errors, logger, timeouts, abort
```

Layering (`commands → services → adapter → infra`) is enforced by review only — no guard test.

## Conventions

- ESM-only, `const` preferred, `async/await` only — no `.then()` chains
- New dependencies: devDeps are free; anything outside the Playwright ecosystem needs evaluation (maintenance, size, alternatives); deprecated/vulnerable are blocked
- Envelope: only `meta.warnings` can grow; `meta.v` is `2` (forced by `buildEnvelope`)
- `data` contract v2 (guarded by `test/contract/data-contract-v2.test.js`, which must cover every registered command): `data` is always an object with a factual Chinese `headline: string[]`; lists are `{ headline, items, total, ... }`; keys are snake_case; money is yuan with `_yuan`, rates are 0-100 with `_pct`, times `_at` as `YYYY-MM-DD HH:mm:ss` (Asia/Shanghai); enums are output as Chinese labels; missing values are `null`, never 0; upstream objects and PII never reach `data`
- Price input is yuan: `goods update price --price-yuan <元>`, batch `field: "price_yuan"`; upstream still receives fen (exact string parsing via `parseYuanToFen`)
- Exit codes: 0=OK, 1=GENERAL, 2=USAGE, 3=AUTH, 4=RATE_LIMIT, 5=NETWORK, 6=BUSINESS, 7=PARTIAL
- Redacted keys are defined by `REDACT_KEYS` in `src/infra/logger.js`; add new sensitive fields there
- Functions < 50 lines, nesting ≤ 3 levels, no single-letter vars except loop counters
- Conventional Commits with emoji: `✨ feat` / `🐛 fix` / `🔧 chore` / `📝 docs` / `♻️ refactor`

## Testing

- `vitest` + `assert/strict`; test data in `test/fixtures/`
- `PDD_TEST_ADAPTER=fixture` short-circuits adapter entry points (modules guard on `isMockEnabled()`) via `mock-dispatcher.js` (no DI); `PDD_TEST_FIXTURE_DIR=<path>` points to alternate fixtures
- E2E tests spawn child processes with the fixture adapter
- `PDD_DEBUG_RAW=1` emits pre-strip raw payloads to stderr as redacted JSONL; stdout envelope unaffected
- Other runtime env vars (auth-state paths, account registries, scrape/publish tuning): see the `pdd-local-development` skill, or grep `process.env.PDD_` under `src/`

## Gotchas

- `goods.list` responses may contain `goods_id: null` — inventory matching falls back to `goods_name`, and internal `matched_by='mixed'` (output label `按商品名匹配（一侧缺少商品 ID）`) is an expected compatibility result
- Endpoint naming inconsistent: `recentOrderList` uses camelCase (`errorCode`), `orderDetail` uses snake_case (`error_code`); `readBusinessError()` handles both
- `createPageSession()` automatically creates a sibling page when the same normalized URL is revisited within its 1-second TTL; do not bypass that session for endpoint navigation
- Rate limiting: 3 consecutive 429s trigger 5-minute global cooldown; retry delays `[1000, 2000, 4000] ms`
- Mall context resolution probe chain: mock → state → url → cookie → storage → xhr → dom
- `recentOrderList` filters: `orderType` 0=all, 1=pending ship, 2=shipped awaiting receipt, 3=received; `afterSaleType` 0=no filter, 1=only orders without after-sales, 2=after-sales in progress. Only use the verified combinations in `ORDER_LIST_SCOPES` (`src/adapter/endpoints/orders.js`); `orders list` defaults to `all` (0/0), sales statistics use internal `valid` (0/1). `pageSize=100` is rejected upstream (`单页数据量过大或非法`) while `50` works (values in between are unverified)
- Refunds are identified only by order `after_sales_status` (`5` = refunded, `10`/`11` = after-sales in progress, `null` = none); `refund_status` / `afterSaleType` etc. do not exist on order items. If no order in the sample carries the field, refund counts/rates are `null`, never 0
