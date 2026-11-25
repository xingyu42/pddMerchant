---
name: pdd-command-feature-development
description: Add, modify, or debug pdd-cli commands and domain behavior. Use for orders and after-sales, goods read/write/publish/cost/profit/receipt, promo, diagnose and operating reports, shops, account/config/daemon command wiring, endpoint specs, dry-run/--confirm writes, and command docs or tests.
---

# PDD Command Feature Development

Extend CLI behavior through the existing layers (`commands -> services -> adapter -> infra`).

## Route The Change

1. Open `src/commands/registry/<domain>.js` for the command name, flags, defaults, option parsers, and `wireAction()` call.
2. Open the matching command module under `src/commands/` to inspect `withCommand()` options and CLI-to-service mapping.
3. Open `src/services/<domain>.js` or `src/services/<domain>/...` for reusable domain logic, and `src/services/views/<domain>.js` for output projection and headlines.
4. Open `src/adapter/endpoints/<domain>.js` when endpoint payload, trigger, normalization, or business-error mapping changes.
5. Open existing tests for the same domain before adding new ones.

## Existing Domains

- Orders: `src/services/orders.js`, `src/adapter/endpoints/orders.js`, commands under `src/commands/orders/`.
- Orders after-sales: `src/services/after-sales.js`, `src/services/views/after-sales.js`, `src/adapter/endpoints/after-sales.js`.
- Goods read/write: `src/services/goods.js`, `src/services/goods-write.js`, `src/adapter/endpoints/goods.js`, commands under `src/commands/goods/`.
- Goods publish: `src/services/goods-publish.js`, `src/adapter/goods-publish/`, `src/adapter/endpoints/goods-publish.js`.
- Goods cost / profit / receipt: `src/services/goods-cost.js`, `src/services/goods-profit.js`, `src/services/goods-receipt.js` and their sibling helpers; costs persist through `src/infra/goods-cost-store.js`.
- Promo: `src/services/promo.js`, `src/adapter/endpoints/promo.js`, commands under `src/commands/promo/`.
- Diagnose and operating reports: `src/services/diagnose/` plus report services such as `src/services/traffic.js`, `src/services/reviews.js`, `src/services/customer-service.js`, `src/services/experience.js`; commands under `src/commands/diagnose/`. Reports carry facts and data-quality hints, leaving advice and scores to the user.
- Account, config, daemon: `src/commands/account.js`, `src/commands/config.js`, `src/commands/daemon.js`, with storage in `src/infra/account-store.js`.

## Command Pattern

- Use `withCommand({ name, needsAuth, needsMall, allowAllAccounts, run, render })`.
- Keep command modules thin: validate CLI config, call service helpers, and return `{ data, meta, warnings? }` to the runner. Only top-level `init`, `login`, `account`, `config` emit directly.
- Use `needsMall: 'switch'` when `--mall` should switch active mall before execution.
- Set `allowAllAccounts: false` for write operations or commands that cannot safely batch across accounts.
- Use `ExitCodes.PARTIAL` for mixed success/failure batch-style results.

## Reuse Before Adding

- Input validation: `validateGoodsId()`, `validateWriteValue()`, parse-time parsers in `src/commands/option-parsers.js`, `PddCliError`, and `ExitCodes`.
- Endpoint calls: `runEndpoint()` with a new or modified endpoint spec; custom Playwright request logic stays out of services.
- Logs: `ctx.log` or `getLogger()`; redaction happens in `src/infra/logger.js` and `src/infra/output.js`.

## Endpoint Spec Checklist

Define the smallest needed set:

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

## Done When

- A new or renamed command appears in a bash code block of `skills/pdd-cli/SKILL.md`, and its report caliber is in `skills/pdd-cli/reports.md` when it is a report.
- Its `V2_CASES` entry exists in `test/contract/data-contract-v2.test.js`.
- Targeted tests for the changed domain pass:

```bash
npx vitest run test/contract/data-contract-v2.test.js test/contract/command-docs.test.js test/contract/doc-paths.test.js
npx vitest run test/services/<domain>*.test.js test/commands/<domain>*.test.js test/adapter/<domain>*.test.js
npx vitest run test/e2e/
```

Run `npm test` when touching shared contracts, the runner, adapter transport, auth/mall context, or endpoint behavior used by several domains.
