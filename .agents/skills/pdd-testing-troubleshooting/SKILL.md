---
name: pdd-testing-troubleshooting
description: Choose, run, or debug pdd-cli Vitest tests and validation. Use for contract guards (data-contract v2, command docs, doc paths, metric tables), fixture adapter and mock endpoint data, e2e subprocess runs, envelope/JSON purity regressions, auth/mall fixture scenarios, or selecting validation for a change.
---

# PDD Testing Troubleshooting

Select validation for a code change, or change tests, from the current `test/` tree.

## Must Read

- `package.json` and `vitest.config.js` for runner configuration (includes, timeouts, pool).
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

## Test Layout

- `test/contract/`: repo-wide guards.
  - `data-contract-v2.test.js`: every registered command has a `V2_CASES` entry.
  - `command-docs.test.js`: bash code blocks in `skills/pdd-cli/SKILL.md` list exactly the registered commands.
  - `doc-paths.test.js`: backticked repo paths in `AGENTS.md`, `CLAUDE.md`, `CODING_STANDARDS.md` and `.agents/skills/pdd-*/SKILL.md` exist.
  - `metric-tables.test.js`: view metric-table kinds match output unit suffixes.
  - Plus the contract checker and config-edit contract.
- `test/e2e/`: subprocess runs through `bin/pdd.js` with the fixture adapter, one file per command family.
- `test/services/`: domain services and view projections.
- `test/commands/`: command-level contracts (option parsing, writes, runner deadline).
- `test/adapter/`: endpoint transport, auth lifecycle/storage/probe, per-domain endpoint contracts (`*-contract.test.js`).
- `test/infra/`: envelope output, errors, units/metrics, SQLite stores, leases, master key, redaction.
- `test/daemon/`, `test/console/`: daemon server/SSE and console frontend.
- `test/helpers/`: shared assertions, the isolated CLI sandbox, registered-command discovery.
- `test/fixtures/`: endpoint responses, error scenarios, and `test/fixtures/test-data.js` factories.

## Fixture Seam

`PDD_TEST_ADAPTER=fixture` activates `src/adapter/mock-dispatcher.js`. It short-circuits browser/auth/mall/endpoint paths and loads endpoint fixtures from `test/fixtures/endpoints/<meta.name>.json`, with page-specific variants such as `<name>.page2.json`.

Useful env vars:

- `PDD_TEST_FIXTURE_DIR=<path>` to point at alternate fixtures.
- `PDD_TEST_AUTH_INVALID=1` to simulate expired merchant auth.
- `PDD_TEST_CONSUMER_AUTH_INVALID=1` to simulate expired consumer auth.
- `NO_COLOR=1` for stable CLI output assertions.

## Validation Matrix

- New or changed command: its `V2_CASES` entry in `test/contract/data-contract-v2.test.js`, `test/contract/command-docs.test.js`, plus the matching e2e or command contract test.
- `data` shape or views: `test/services/*-view.test.js`, the `data-contract-v2` case with `entityFields`, and `test/contract/metric-tables.test.js`.
- Envelope, errors, output: `test/infra/output-v2.test.js`, `test/contract/`, and `test/e2e/`.
- Auth, account, mall: `test/adapter/merchant-auth-*.test.js`, `test/adapter/auth-*.test.js`, `test/e2e/merchant-auth.e2e.test.js`.
- Orders: `test/adapter/orders-contract.test.js`, `test/adapter/after-sales-contract.test.js`, `test/services/orders-*.test.js`, `test/services/order-view.test.js`, `test/services/after-sales*.test.js`.
- Goods write: `test/commands/goods-write-contract.test.js`, `test/services/goods-write-contract.test.js`.
- Skill or steering doc edits: `test/contract/command-docs.test.js` and `test/contract/doc-paths.test.js`.
- Shared runner, adapter transport, or cross-domain changes: `npm test`.

## Conventions

- Extend the fixture adapter, the existing test seam, when a test needs new behavior; production code keeps its current dependency shape.
- Automated tests run against fixtures; real PDD login/network runs only with user-confirmed scope.
- Cite test files after confirming them in the current `test/` tree.
