---
name: pdd-architecture-navigation
description: Navigate the pdd-cli repository architecture before modifying commands, services, adapter code, infra helpers, envelope behavior, or cross-module flows. Use when tracing a feature from CLI entry to service, endpoint transport, auth, mall context, logging, errors, daemon/console, or tests.
---

# PDD Architecture Navigation

Use this skill to route work to the right layer before editing. Keep conclusions anchored to files in the current checkout.

## First Files

Read these in order for a new area:

1. `docs/architecture-overview.md` for the full layer map, transport chain, persistence and config; `README.md` for supported commands and envelope behavior.
2. `bin/pdd.js` for global flags, `wireAction()`, signal handlers and the commander usage-error envelope.
3. `src/commands/registry/<domain>.js` for the command tree and option parsers, then the command file for CLI option-to-service wiring.
4. `src/commands/_runner.js` (facade) and `src/commands/runner/` for `withCommand()`, account/auth, mall resolution, timeout/abort, batch mode, fixture mode, and envelope finalization.
5. The matching `src/services/...`, `src/services/views/...`, and `src/adapter/endpoints/...` files for domain logic, output projection, and endpoint contracts.
6. The relevant `.trellis/spec/<layer>/` guidelines, `.trellis/research/` topics, `GLOSSARY.md`, and `docs/adr/` for cross-cutting work.

## Layer Map

- `bin/pdd.js`: CLI entry, global options, signal/fatal handlers, commander usage-error envelope; command registration is delegated to `src/commands/registry/`.
- `src/commands/`: command handlers. Most wrap work with `withCommand()`; `init`, `login`, `account`, `config` emit directly. `option-parsers.js` validates option values at parse time (`integerArg(min, max)`, `goodsIdListArg`, `withReportDays`).
- `src/commands/runner/`: `single-lifecycle`, `batch-executor`, `fixture-runtime`, `envelope-finalizer`.
- `src/daemon/` + `src/console/`: explicit console daemon (HTTP routes, SSE, static frontend); depends only on services.
- `src/services/`: domain orchestration — orders, goods (read / write / publish / segmentation), promo, diagnose, operating reports (traffic, reviews, customer-service, experience, goods traffic), goods cost/profit/receipt, merchant session and password relogin, daemon/patrol/console. Reports expose facts, not advice or scores.
- `src/services/views/`: whitelist projection, unit conversion, Chinese labels and headlines; report declarations.
- `src/adapter/`: Patchright browser (headless consistency profile, ADR 0002), endpoint transport, auth/login, mall context, fixtures, goods-publish scraping/form filling, takeover.
- `src/adapter/endpoints/`: endpoint specs — `name`, `strategy`, `nav`, `apiUrl`/`urlPattern`, `buildPayload(params, ctx)`, `normalize(raw, params)`, `successRule`, `errorMap`/`errorMapper`, `fixtureListKey`, `fixtureVariantKey`.
- `src/infra/`: envelope/output, errors, logger/redaction, config, paths, timeouts, abort, units/metrics, SQLite storage (`db`, `account-store`, `leases`, `goods-cost-store`), master key and secret box.
- `test/`: `adapter`, `commands`, `console`, `contract`, `daemon`, `e2e`, `infra`, `services`, plus `helpers/`, `fixtures/test-data.js` and `setup.js`.

Dependency flow is `commands -> services -> adapter -> infra`. Known downward shortcuts: runner, `doctor.js` and `login.js` import adapter directly. Do not introduce upward imports or put domain behavior in `bin/pdd.js`.

## Runtime Flow

1. Registrars attach commands; `program.parseAsync()` parses options. Parser rejections become an `E_USAGE` envelope (exit 2) before the runner starts.
2. `wireAction(cmd, name, runFn)` merges global options, loads runtime config and logger, then calls the command.
3. `withCommand()` → `executeSingle` (or `executeBatch` for `--all-accounts`): resolve account, arm deadline, then no-browser / fixture / live path.
4. Live path: account lease → browser → `checkMerchantSession` (password relogin on rejection) → merchant home → mall resolve/switch → page session + shared endpoint client → command body → close pages → re-verify and persist auth → finalize envelope.
5. Service code calls `runEndpoint(page, ENDPOINT_SPEC, params, ctx)` or pure helpers.
6. `endpoint-client.js` applies rate limiting, per-endpoint cooldown and 429 retries; `send()` uses page-api, fetch/legacy capture, or fixture raw responses; `response-interpreter.js` decides success, rate limit and business errors, then calls `normalize(raw, params)`.

## Contracts

- Preserve envelope top-level shape `{ ok, command, data, error, meta }`; `src/infra/output.js` builds and emits it, `runner/envelope-finalizer.js` finalizes once.
- Use `PddCliError` and `ExitCodes` from `src/infra/errors.js`; do not invent ad-hoc error shapes.
- `--json` output must remain single-line stdout JSON. Human errors can go to stderr.
- Logging must go through `src/infra/logger.js`; do not use `console.log` in runtime paths.
- Write commands such as `goods update ...` require `--confirm`; without it they return dry-run data.

## High-Risk Areas

- Auth state, account registry and `master.key` under `data/` or env-overridden paths are sensitive.
- `src/commands/runner/single-lifecycle.js`: auth leases, merchant session check and auth persistence for every live command.
- `src/services/merchant-session.js`, `src/adapter/merchant-auth*.js`, `src/infra/db.js`, `leases.js`, `master-key.js`.
- Endpoint transport: `run-endpoint.js`, `endpoint-client.js`, `response-interpreter.js`, `endpoint-strategy-resolver.js`, `page-api-client.js`, `endpoint-attempt.js`, `xhr-collector.js`, `page-session.js`, `rate-limiter-singleton.js`.
- Mall context: `mall-reader` (probe chain), `mall-writer`, `mall-xhr-probe`, `mall-id`; `mall-switcher` only re-exports.
- Envelope and exit-code behavior is widely tested; update specs/tests before changing it.
- `goods publish` spans consumer login state, category resolution, source scraping (Qingguo proxy, ADR 0001), form filling, pricing/image helpers and endpoint specs.
- Daemon/patrol: single-instance lease, console sessions and takeover.

## Validation

Use targeted tests for the layer you touched, then broader tests if contracts changed:

```bash
npx vitest run test/contract/data-contract-v2.test.js test/infra/output-v2.test.js
npx vitest run test/adapter/endpoint-client.test.js test/adapter/response-interpreter.test.js test/adapter/fixture-transport.test.js
npx vitest run test/commands/runner-deadline.test.js test/e2e/
npm test
```
