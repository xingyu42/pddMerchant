# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

pddMerchant — Pinduoduo merchant backend CLI tool. Uses Patchright's Playwright-compatible API to automate Chromium, intercepts XHR responses, and exposes an AI-friendly envelope contract. Pure JavaScript (Node.js ESM), no TypeScript, no build step.

## Commands

```bash
npm test                              # Run all tests (vitest)
npx vitest run test/<file>.test.js    # Run a single test file
npx vitest                            # Watch mode
npx patchright install chromium       # Required: install the fallback Chromium runtime
```

- No active linter (`npm run lint` only prints `no-lint`)
- No build step — ESM runs directly
- PBT config: `PBT_SEED=<n>` / `PBT_RUNS=<n>` control only the project `_harness.js`; fast-check tests use their reported seed/path

## Architecture

```
bin/pdd.js               CLI entry (signal/fatal handlers, global options, wireAction; registration delegated to registry/)
src/commands/            Command handlers — thin wrappers around withCommand()
src/commands/registry/   Domain registrars `register(program, wireAction)` — adding a command touches only the command file + its registrar
src/commands/runner/     withCommand internals (envelope-finalizer / fixture-runtime / single-lifecycle / batch-executor); _runner.js is a facade
src/services/            Domain logic (orders, goods, promo, diagnose, promo-roi, goods-segmentation); factual reporting without operating advice or scores
src/adapter/             Playwright integration, XHR interception, auth, mall context
src/adapter/fixtures/    Mock-mode providers (core.js owns the single fixture cache); mock-dispatcher.js is a facade
src/infra/               Cross-cutting: envelope, errors, logger, timeouts, abort
```

Dependencies flow one way: `commands/ → services/ → adapter/ → infra/`. Never import upward (guarded by `test/layering-guard.unit.test.js`).

## Conventions

- ESM-only (`import`/`export`), `const` preferred, `async/await` only — no `.then()` chains
- Dependencies tiered: devDeps=free; Playwright ecosystem deps=review-only; new-domain deps=evaluate (maintenance, size, alternatives); deprecated/vulnerable=blocked
- Envelope `{ ok, command, data, error, meta }` is the sacred output contract — only `meta.warnings` can grow
- 8 exit codes: 0=OK, 1=GENERAL, 2=USAGE, 3=AUTH, 4=RATE_LIMIT, 5=NETWORK, 6=BUSINESS, 7=PARTIAL
- All errors use `PddCliError` with exit code mapping (`src/infra/errors.js`)
- Logging via `src/infra/logger.js` (pino with SHA256 redaction) — never use `console.log`
- Sensitive fields auto-redacted: `anti_content`, `authorization`, `cookies`, `goods_image`, `phone`, `addr`, `receiver_name`, `receiver_phone`, `receiver_address`, `password`, `credential`, `mobile`, `masterPassword`, `ciphertext`
- Functions < 50 lines, nesting ≤ 3 levels, no single-letter vars except loop counters
- Conventional Commits with emoji: `✨ feat` / `🐛 fix` / `🔧 chore` / `📝 docs` / `♻️ refactor`

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PDD_TEST_ADAPTER=fixture` | Enable mock mode (skip real browser) |
| `PDD_TEST_FIXTURE_DIR=<path>` | Point to fixture data directory |
| `PDD_AUTH_STATE_PATH=<path>` | Explicit merchant auth-state override; fallback is `data/merchant/stores/default/auth-state.json`, registered accounts use registry slugs |
| `PDD_CONSUMER_AUTH_STATE_PATH=<path>` | Explicit consumer auth-state override; fallback is `data/consumer/accounts/default/auth-state.json`, registered accounts use registry slugs |
| `PDD_ACCOUNTS_DIR` / `PDD_ACCOUNT_REGISTRY_PATH` | Override merchant account directory and registry |
| `PDD_CONSUMER_ACCOUNTS_DIR` / `PDD_CONSUMER_ACCOUNT_REGISTRY_PATH` | Override consumer account directory and registry |
| `PDD_ALLOW_INSECURE_AUTH_STATE=1` | Continue when POSIX mode 0600 cannot be set (not recommended) |
| `PDD_DEBUG_RAW=1` | Emit pre-strip raw payloads to stderr as redacted JSONL (per-value 64KiB truncation); stdout envelope unaffected |
| `PDD_MALL_ID_STRICT_PARSE=0` | Allow mall IDs up to 64 chars (default: 1-15 digits) |
| `PDD_SCRAPE_SIMULATE` | Set `0` to disable human-behavior simulation during scraping (default: enabled) |
| `PDD_FULL_COUNT_DISCOUNT_RATE` | Full-count discount rate for goods publish `@e86` field (default: `0.95` = 9.5折; range 0.5-0.99; accepts percentage form e.g. `95`). Invalid values fail with `E_CONFIG_INVALID` |
| `PDD_SCRAPE_SOFTBLOCK_THRESHOLD` | Consecutive IP soft-block hits before source-scrape enters cooldown backoff (default: 2) |
| `PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS` | IP soft-block cooldown duration in ms (default: 7200000 = 2h); during cooldown `goods publish` scrape short-circuits before requesting. State persists in `data/scrape-cooldown.json` |
| `PLAYWRIGHT_DOWNLOAD_HOST` | Mirror for Playwright browser downloads |

CLI and daemon logs use fixed daily files under `log/cli/` and `log/daemon/`; foreground/bootstrap logs use stderr. `PDD_LOG_DESTINATION` is unsupported.

## Testing

- Framework: `vitest` + `assert/strict` — auto-discovers `test/**/*.test.js`
- Test seam: `PDD_TEST_ADAPTER=fixture` short-circuits adapter entry points (modules guard on `isMockEnabled()`) via `mock-dispatcher.js` (no DI)
- E2E tests spawn child processes with fixture adapter
- PBT uses both the project zero-dependency harness (`test/pbt/_harness.js`) and the `fast-check` devDependency
- Test data in `test/fixtures/` (endpoint responses, error scenarios)

## Gotchas

- `goods.list` responses may contain `goods_id: null` — inventory matching falls back to `goods_name`, and `matched_by='mixed'` is an expected compatibility result
- Endpoint naming inconsistent: `recentOrderList` uses camelCase (`errorCode`), `orderDetail` uses snake_case (`error_code`); `readBusinessError()` handles both
- `createPageSession()` automatically creates a sibling page when the same normalized URL is revisited within its 1-second TTL; do not bypass that session for endpoint navigation
- Rate limiting: 3 consecutive 429s trigger 5-minute global cooldown; retry delays `[1000, 2000, 4000] ms`
- Mall context resolution probe chain: mock → state → url → cookie → storage → xhr → dom
