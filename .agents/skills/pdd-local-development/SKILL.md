---
name: pdd-local-development
description: Set up, run, or troubleshoot the pdd-cli local environment. Use for install and Chromium setup, npm scripts, runtime env vars and config merge, log locations, daemon/console settings, fixture-mode runs, or git worktrees.
---

# PDD Local Development

Runtime baselines (Node.js >= 24, no-build ESM, SQLite `data/pdd.db` + `master.key`, lint/check scripts) are in `AGENTS.md`; this skill adds setup steps and the gotchas no config file confesses.

## Must Read

- `package.json` for scripts, dependencies, and `bin.pdd`.
- `README.md` for quick start; `skills/pdd-cli/SKILL.md` for the command surface and exit codes.
- `.env.example` for the broadest env-var inventory.
- `src/infra/paths.js` for default data paths and `PDD_DB_PATH`.
- `src/infra/config.js` for config/env merge rules and runtime defaults.
- `src/runtime/env.js`, `src/runtime/command-runtime.js`, and `src/runtime/daemon-runtime.js` for composition-root runtime env whitelisting and live/fixture wiring.
- `src/infra/logger.js` for log destination and redaction behavior.

## Commands

```bash
npm install
npx patchright install chromium
node bin/pdd.js doctor --json
node bin/pdd.js orders list --size 20 --json
npm test
npx vitest run test/<file>.test.js
npm run check
```

## Runtime Facts

- The CLI binary is `pdd -> ./bin/pdd.js`.
- Logs: CLI logs are fixed under `log/cli/YYYY-MM-DD.log`; the explicit `pdd daemon` writes `log/daemon/YYYY-MM-DD.log` (foreground `daemon run` also tees to stderr). Foreground/bootstrap diagnostics go to stderr. The file channel is fixed: `PDD_LOG_DESTINATION` is unsupported, so inspect the fixed files.
- `pdd daemon` / console settings: `PDD_CONSOLE_HOST` (default `127.0.0.1`), `PDD_CONSOLE_PORT` (`47821`), `PDD_CONSOLE_PUBLIC_URL`, `PDD_PATROL_ENABLED` (`false`), `PDD_PATROL_INTERVAL_MS` (`1800000`, min `300000`). Fixture-only timing seams: `PDD_TEST_DAEMON_LEASE_TTL_MS`, `PDD_TEST_DAEMON_HEARTBEAT_MS`, `PDD_TEST_PATROL_INTERVAL_MS` (honored only when `mode === 'fixture'` / `PDD_TEST_ADAPTER=fixture`). Fixture daemons still need a temporary `PDD_DB_PATH` and a free `PDD_CONSOLE_PORT`.
- `PDD_TEST_ADAPTER=fixture` avoids real browser/backend calls for CLI/daemon runs; always pair it with a temporary `PDD_DB_PATH` to isolate the database and key. In Vitest, `test/setup.js` isolates `PDD_DB_PATH` and blocks real `patchright`/`fetch` without defaulting `PDD_TEST_ADAPTER`; in-process tests inject `mode`/`env`/`overrides` via `composeCommandRuntime` / `composeDaemonRuntime` or `createTestCtx` (`test/helpers/test-ctx.js`), while `test/helpers/isolated-cli.js` sets `PDD_TEST_ADAPTER=fixture` per spawned child process.
- `PDD_RATE_LIMIT_QPS`, `PDD_RATE_LIMIT_BURST`, `PDD_COOLDOWN_THRESHOLD`, and `PDD_COOLDOWN_MS` affect shared endpoint rate limiting.

## Git Worktrees

- Worktrees under `.claude/worktrees/` resolve `node_modules` from the main checkout, so `npm test` runs there as-is.
- `npm run lint` (knip) needs a local `node_modules` and reports unlisted `vitest`/`knip` binaries without one: the orchestrating session adds a junction (`node -e "require('fs').symlinkSync('<main>/node_modules','node_modules','junction')"`) and unlinks it before removing the worktree; worktree-isolated subagents run `npm test` and leave lint to the merge step.
- `.scratch/` is gitignored and lives only in the main checkout; from any linked worktree, resolve it via `$(git rev-parse --git-common-dir)/../.scratch` (no junction, so worktree removal by any tool/agent stays isolated from local tickets).
- A real-account run from any worktree sets `PDD_DB_PATH` to the main checkout's `data/pdd.db`.

## Verification

For local setup changes, run:

```bash
node bin/pdd.js doctor --json
npx vitest run test/infra/output-v2.test.js test/e2e/
```

For env/config path changes, also run `test/infra/config.test.js` and the account/auth storage tests (`test/adapter/merchant-auth-*.test.js`, `test/services/merchant-account-storage.test.js`).
