---
name: pdd-command-feature-development
description: Add, modify, or debug pdd-cli commands and domain behavior. Use when working on orders, goods, goods update, goods publish, promo, diagnose, shops, account command wiring, service helpers, endpoint specs, dry-run/write behavior, or command-specific tests.
---

# PDD Command Feature Development

Use this skill to extend existing CLI behavior without bypassing the project layers.

## Route The Change

1. Start at `bin/pdd.js` to find the command name, flags, defaults, and `wireAction()` call.
2. Open the matching `src/commands/<domain>/...` module to inspect `withCommand()` options and CLI-to-service mapping.
3. Open `src/services/<domain>.js` or `src/services/<domain>/...` for reusable domain logic.
4. Open `src/adapter/endpoints/<domain>.js` only when endpoint payload, trigger, normalization, or business-error mapping changes.
5. Open existing tests under `test/` for the same domain before adding new tests.

## Existing Domains

- Orders: `src/services/orders.js`, `src/adapter/endpoints/orders.js`, commands under `src/commands/orders/`.
- Goods read/write: `src/services/goods.js`, `src/adapter/endpoints/goods.js`, commands under `src/commands/goods/`.
- Goods publish: `src/services/goods-publish.js`, `src/adapter/goods-publish/`, `src/adapter/endpoints/goods-publish.js`.
- Promo: `src/services/promo.js`, `src/services/promo-roi.js`, `src/adapter/endpoints/promo.js`, commands under `src/commands/promo/`.
- Diagnose factual statistics: `src/services/diagnose/`, commands under `src/commands/diagnose/`. Preserve data-quality hints, not operating advice or scores.
- Account: `src/commands/account.js`, `src/infra/account-*`.

## Command Pattern

- Use `withCommand({ name, needsAuth, needsMall, allowAllAccounts, run, render })`.
- Keep command modules thin: validate CLI config, call service helpers, and return `{ data, meta, warnings? }`.
- Use `needsMall: 'switch'` when `--mall` should switch active mall before execution.
- Set `allowAllAccounts: false` for write operations or commands that cannot safely batch across accounts.
- Return dry-run data when write commands lack `--confirm`.
- Use `ExitCodes.PARTIAL` for mixed success/failure batch-style results.

## Reuse Before Adding

- Input validation: reuse `validateGoodsId()`, `validateWriteValue()`, `PddCliError`, and `ExitCodes`.
- Endpoint calls: reuse `runEndpoint()` and add/modify endpoint specs instead of custom Playwright request logic.
- Output: return data/meta to `_runner.js`; do not emit directly unless matching existing top-level commands such as init/login/account.
- Logs: use `ctx.log` or `getLogger()`.
- Redaction: rely on `src/infra/logger.js` and `src/infra/output.js`; do not manually print sensitive values.

## Endpoint Spec Checklist

When adding an endpoint spec, define the smallest needed set:

- `name` matching fixture file names and command expectations.
- `nav.url` and `nav.readyEl`.
- `urlPattern` and/or `apiUrl`.
- `buildPayload(params, ctx)` for fetch path.
- `trigger(page, params, ctx)` only when page interaction or explicit fetch is needed.
- `requiredTrigger: true` when failure to trigger must fail the command.
- `normalize(raw, params)` to return stable command data; params are the request params (both transports), usable to scope validation.
- `isSuccess(raw)` and `errorMapper(raw)` for business errors.
- `fixtureListKey` if mock pagination must synthesize empty pages.
- `fixtureVariantKey` (scalar request param) when one endpoint must return different fixtures per call, e.g. per `goods_id`.

## Validation

Run targeted tests for the changed domain:

```bash
npx vitest run test/contract/data-contract-v2.test.js   # every registered command must have a V2_CASES entry
npx vitest run test/services/<domain>*.test.js test/commands/<domain>*.test.js test/adapter/<domain>*.test.js
npx vitest run test/e2e/
```

Run `npm test` when touching shared contracts, `_runner.js`, adapter transport, auth/mall context, or endpoint behavior used by several domains.
