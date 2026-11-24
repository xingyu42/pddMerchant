---
name: pdd-testing-troubleshooting
description: Choose, run, or debug pdd-cli Vitest tests and validation. Use for contract guards (data-contract v2, command docs, doc paths, metric tables), fixture adapter and mock endpoint data, e2e subprocess runs, envelope/JSON purity regressions, auth/mall fixture scenarios, or selecting validation for a change.
---

# PDD Testing Troubleshooting

Select validation for a code change, or change tests, from the current `test/` tree.

## Must Read

- `package.json` and `vitest.config.js` for runner configuration (includes, timeouts, pool).
- `test/setup.js` for global test setup (per-test isolated SQLite `PDD_DB_PATH`, `NO_COLOR=1`, offline `patchright`/`fetch` guards; no global `PDD_TEST_ADAPTER` default).
- `test/helpers/test-ctx.js` (`createTestCtx`, `createMemoryEndpointTransport`) and `test/helpers/in-memory-ports.js` for singleton-free in-process service and runtime seams.
- `src/runtime/command-runtime.js` (`composeCommandRuntime`) and `src/runtime/daemon-runtime.js` (`composeDaemonRuntime`) for explicit `mode`, `env`, `overrides`, `streams`, and `clock` injection.
- `test/helpers/isolated-cli.js` (`runCli`) for sandboxed subprocess runs with fixtures, auth state, and account registry.
- `test/helpers/data-contract.js` and `test/helpers/envelope-assertions.js` for contract assertions.
- `src/adapter/mock-dispatcher.js` and `src/adapter/fixtures/core.js` for fixture-mode behavior (`PDD_TEST_ADAPTER=fixture` in subprocesses or `mode: 'fixture'` in composition roots).
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
- `test/runtime/`: `composeCommandRuntime`, `composeDaemonRuntime`, and whitelist `parseRuntimeEnv` tests.
- `test/e2e/`: subprocess runs through `bin/pdd.js` with explicit child `PDD_TEST_ADAPTER=fixture`, one file per command family.
- `test/services/`: domain services and view projections.
- `test/commands/`: command-level contracts (option parsing, writes, runner deadline).
- `test/adapter/`: endpoint transport, auth lifecycle/storage/probe, per-domain endpoint contracts (`*-contract.test.js`).
- `test/infra/`: envelope output, errors, units/metrics, SQLite stores, leases, master key, redaction.
- `test/daemon/`, `test/console/`: daemon server/SSE and console frontend.
- `test/helpers/`: shared assertions, `test-ctx.js`, `in-memory-ports.js`, the isolated CLI sandbox, registered-command discovery.
- `test/fixtures/`: endpoint responses, error scenarios, and `test/fixtures/test-data.js` factories.

## Composition-Root & Fixture Seams

- `test/setup.js` keeps tests offline and database-isolated without setting `PDD_TEST_ADAPTER=fixture` globally:
  - In-process unit/service tests inject raw upstream responses via `createTestCtx` (`test/helpers/test-ctx.js`) so requests pass through `EndpointClient` validation, 429 retries, `interpretResponse`, and `spec.normalize`.
  - In-process integration tests pass `mode`, `env`, `overrides`, `streams`, and `clock` directly to `composeCommandRuntime` or `composeDaemonRuntime` (with `test/helpers/in-memory-ports.js` doubles) instead of calling `vi.stubEnv('PDD_TEST_*')`, mutating `process.env`, or mocking `src/adapter/browser.js` / `src/infra/output.js`.
  - Subprocess E2E tests (`runCli` / `runCliAsync` in `test/helpers/isolated-cli.js`) pass `PDD_TEST_ADAPTER=fixture` and `PDD_TEST_FIXTURE_DIR` explicitly in child `env`.
- `mode: 'fixture'` / `PDD_TEST_ADAPTER=fixture` loads endpoint fixtures from `test/fixtures/endpoints/<meta.name>.json`, with page-specific variants such as `<name>.page2.json`.

Useful fixture env vars (passed via `env` to `composeCommandRuntime`/`composeDaemonRuntime` or child subprocesses):

- `PDD_TEST_FIXTURE_DIR=<path>` to point at alternate fixtures.
- `PDD_TEST_AUTH_INVALID=1` to simulate expired merchant auth.
- `PDD_TEST_CONSUMER_AUTH_INVALID=1` to simulate expired consumer auth.
- `NO_COLOR=1` for stable CLI output assertions.

## Validation Matrix

- New or changed command: its `V2_CASES` entry in `test/contract/data-contract-v2.test.js`, `test/contract/command-docs.test.js`, plus the matching e2e or command contract test.
- `data` shape or views: `test/services/*-view.test.js`, the `data-contract-v2` case with `entityFields`, and `test/contract/metric-tables.test.js`.
- Envelope, errors, output: `test/infra/output-v2.test.js`, `test/infra/output-sink.test.js`, `test/contract/`, and `test/e2e/`.
- Auth, account, mall: `test/adapter/merchant-auth-*.test.js`, `test/adapter/auth-*.test.js`, `test/e2e/merchant-auth.e2e.test.js`.
- Orders: `test/adapter/orders-contract.test.js`, `test/adapter/after-sales-contract.test.js`, `test/services/orders-*.test.js`, `test/services/order-view.test.js`, `test/services/after-sales*.test.js`.
- Goods write: `test/commands/goods-write-contract.test.js`, `test/services/goods-write-contract.test.js`.
- Skill or steering doc edits: `test/contract/command-docs.test.js` and `test/contract/doc-paths.test.js`.
- Shared runner, runtime composition roots, adapter transport, or cross-domain changes: `npm test`.

## Conventions

- Prefer singleton-free composition-root injection (`composeCommandRuntime` / `composeDaemonRuntime` `overrides` and `env`) and `createTestCtx` over global env mutations or cross-layer module mocks.
- Extend the fixture adapter, the existing test seam, when a test needs new behavior; production code keeps its current dependency shape.
- Automated tests run against fixtures or in-memory ports; real PDD login/network runs only with user-confirmed scope.
- Cite test files after confirming them in the current `test/` tree.
