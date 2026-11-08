---
name: pdd-local-development
description: Set up, run, configure, or troubleshoot the pdd-cli local development environment. Use when working on install/start commands, Playwright Chromium setup, runtime env vars, SQLite storage paths, logs, account storage, package scripts, git worktrees, or no-build Node.js ESM execution.
---

# PDD Local Development

Use this skill when a task depends on local runtime setup or environment behavior.

## Must Read

- `package.json` for Node version, scripts, dependencies, and `bin.pdd`.
- `README.md` for quick start, command list, env vars, troubleshooting, and exit codes.
- `.env.example` for the broadest env-var inventory.
- `src/infra/paths.js` for default data paths and `PDD_DB_PATH`.
- `src/infra/config.js` for config/env merge rules and runtime defaults.
- `src/infra/logger.js` for log destination and redaction behavior.

## Commands

```bash
npm install
npx patchright install chromium
node bin/pdd.js doctor --json
node bin/pdd.js orders list --size 20 --json
npm test
npx vitest run test/<file>.test.js
npm run lint
```

`npm run lint` is currently a no-op (`echo no-lint`). There is no build step; the project runs directly as Node.js ESM.

## Runtime Facts

- Node.js must be `>=24`; source files use ESM import/export.
- The CLI binary is `pdd -> ./bin/pdd.js`.
- Merchant/consumer accounts and encrypted auth state share SQLite storage, defaulting to `data/pdd.db`; `PDD_DB_PATH` overrides the database path.
- The generated `master.key` lives beside the database (default `data/master.key`). Both files are sensitive: never commit them, and back up/restore them together.
- Auth updates use account leases + revision CAS (compare-and-swap); account removal cascades to related data. Browser storage state is decrypted in memory.
- Old JSON storage is left untouched; re-login every account after upgrading. `doctor` reports detected legacy data without paths or contents.
- CLI logs are fixed under `log/cli/YYYY-MM-DD.log`; the explicit `pdd daemon` writes `log/daemon/YYYY-MM-DD.log` (foreground `daemon run` also tees to stderr). Foreground/bootstrap logging goes to stderr. `PDD_LOG_DESTINATION` is unsupported.
- `pdd daemon` / console settings: `PDD_CONSOLE_HOST` (default `127.0.0.1`), `PDD_CONSOLE_PORT` (`47821`), `PDD_CONSOLE_PUBLIC_URL`, `PDD_PATROL_ENABLED` (`false`), `PDD_PATROL_INTERVAL_MS` (`1800000`, min `300000`). Fixture-only timing seams: `PDD_TEST_DAEMON_LEASE_TTL_MS`, `PDD_TEST_DAEMON_HEARTBEAT_MS`, `PDD_TEST_PATROL_INTERVAL_MS`. Fixture daemons still need a temporary `PDD_DB_PATH` and a free `PDD_CONSOLE_PORT`.
- `PDD_TEST_ADAPTER=fixture` avoids real browser/backend calls in tests; always pair it with a temporary `PDD_DB_PATH` to isolate the database and key.
- Git worktrees under `.claude/worktrees/` resolve `node_modules` from the main checkout, so tests run there as-is; only a worktree outside the repo needs a `node_modules` junction. A real-account run from any worktree sets `PDD_DB_PATH` to the main checkout's `data/pdd.db`.
- `PDD_RATE_LIMIT_QPS`, `PDD_RATE_LIMIT_BURST`, `PDD_COOLDOWN_THRESHOLD`, and `PDD_COOLDOWN_MS` affect shared endpoint rate limiting.

## Avoid

- Do not commit the database, master key, credentials, or files under `log/`.
- Do not add a build step or TypeScript assumption; this checkout is JavaScript ESM.
- Do not document CI/CD unless a repo-local CI config exists. Current checkout has no root `.github` workflow.
- Do not redirect the CLI file channel through an env-configured destination. Inspect the fixed log files; foreground/bootstrap diagnostics are expected on stderr.

## Verification

For local setup changes, run:

```bash
node bin/pdd.js doctor --json
npx vitest run test/infra/output-v2.test.js test/e2e/
```

For env/config path changes, also run tests touching `src/infra/config.js`, `src/infra/paths.js`, account storage, or auth state (`test/adapter/merchant-auth-*.test.js`, `test/services/merchant-account-storage.test.js`).
