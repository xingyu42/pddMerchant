---
name: pdd-testing-troubleshooting
description: Choose, run, or debug pdd-cli tests and quality checks. Use for Vitest unit/contract/e2e work, fixture adapter behavior, JSON purity, envelope and data-contract v2 regressions, mock endpoint data, auth/mall fixture scenarios, and selecting validation for a change.
---

# PDD Testing Troubleshooting

Use this skill before changing tests or when selecting validation for a code change.

## Must Read

- `package.json` and `vitest.config.js` for test runner configuration.
- `test/setup.js` for global test setup.
- `test/helpers/isolated-cli.js` (`runCli`) for sandboxed subprocess runs with fixtures, auth state, and account registry.
- `test/helpers/data-contract.js` and `test/helpers/envelope-assertions.js` for contract assertions.
- `src/adapter/mock-dispatcher.js` and `src/adapter/fixtures/core.js` for `PDD_TEST_ADAPTER=fixture` behavior.
- `.trellis/spec/standards/testing.md` for the data-contract v2 guard rules.
- Related tests under `test/<layer>/` before modifying matching source code.

## Test Commands

```bash
npm test
npx vitest run test/<layer>/<file>.test.js
npx vitest
```

Vitest includes `test/**/*.test.js`, uses Node environment, `testTimeout: 120000`, `hookTimeout: 30000`, and `pool: forks`.

## Test Layout

- `test/contract/`: data-contract v2 guard (must cover every registered command), contract checker, config-edit contract.
- `test/e2e/`: subprocess runs through `bin/pdd.js` with the fixture adapter (business contract, factual surface, merchant auth).
- `test/services/`: domain view projections and service contracts.
- `test/commands/`: command-level contracts (goods write, diagnose comparison).
- `test/adapter/`: auth lifecycle/storage/probe, orders contract, promo money.
- `test/infra/`: output envelope v2, units, retired auth schedule.
- `test/helpers/`: shared assertions and the isolated CLI sandbox.
- `test/fixtures/`: endpoint responses and error scenarios.

## Fixture Seam

`PDD_TEST_ADAPTER=fixture` activates `src/adapter/mock-dispatcher.js`. It short-circuits browser/auth/mall/endpoint paths and loads endpoint fixtures from `test/fixtures/endpoints/<meta.name>.json`, with page-specific variants such as `<name>.page2.json`.

Useful env vars:

- `PDD_TEST_FIXTURE_DIR=<path>` to point at alternate fixtures.
- `PDD_TEST_AUTH_INVALID=1` to simulate expired merchant auth.
- `PDD_TEST_CONSUMER_AUTH_INVALID=1` to simulate expired consumer auth.
- `NO_COLOR=1` for stable CLI output assertions.

## Validation Matrix

- New or changed command: add/update its `V2_CASES` entry in `test/contract/data-contract-v2.test.js`, plus the matching e2e or command contract test.
- `data` shape or views: `test/services/*-view.test.js` and the `data-contract-v2` case with `entityFields`.
- Envelope, errors, output: `test/infra/output-v2.test.js`, `test/contract/`, and `test/e2e/`.
- Auth, account, mall: `test/adapter/merchant-auth-*.test.js`, `test/adapter/auth-*.test.js`, `test/e2e/merchant-auth.e2e.test.js`.
- Orders: `test/adapter/orders-contract.test.js`, `test/services/orders-*.test.js`, `test/services/order-view.test.js`.
- Goods write: `test/commands/goods-write-contract.test.js`, `test/services/goods-write-contract.test.js`.
- Shared runner, adapter transport, or cross-domain changes: `npm test`.

## Avoid

- Do not add DI layers just for tests; fixture adapter is the existing seam.
- Do not rely on real PDD login/network in normal automated tests.
- Do not reference test files from memory or old docs; the suite was restructured — check current `test/` first.
