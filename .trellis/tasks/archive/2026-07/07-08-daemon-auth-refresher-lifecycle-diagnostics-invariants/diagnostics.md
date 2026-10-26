# Daemon Auth Refresher Lifecycle Diagnostics

## Summary

This task keeps runtime behavior unchanged and freezes the current daemon/auth refresher lifecycle with focused tests plus a drift map. The safest next move is to review the documented gaps before changing daemon foreground/detached behavior, state schema, auth refresh policy, or config/env validation.

New focused tests added in this task:

- `test/daemon-lifecycle.unit.test.js` covers daemon command lifecycle seams without spawning a real daemon.
- `test/auth-refresher-lifecycle.unit.test.js` covers no-overwrite behavior when auth refresh cannot acquire the auth-state lock.

## Lifecycle Inventory

| Invariant | Current code behavior | Current test coverage | Classification | Recommendation |
|---|---|---|---|---|
| Daemon state path | `src/infra/paths.js` fixes daemon state at `data/daemon-state.json`; `src/commands/daemon.js` and `src/infra/daemon-launcher.js` read that path directly. | New `test/daemon-lifecycle.unit.test.js` injects a temp state path through module mocking. Existing config diagnostics recorded path/doc drift. | Code is source of truth for now. | Do not change path defaults here. Use a config/env behavior task before any path migration. |
| Daemon start repeated call | `src/commands/daemon.js` returns `already_running: true` when `ensureDaemonRunning()` reports `started: false`. `src/infra/daemon-launcher.js` checks existing pid before spawning. | New daemon lifecycle unit test verifies already-running envelope and state file path without spawning. | Covered. | Keep launch policy unchanged unless daemon lifecycle semantics are redesigned. |
| Daemon start confirmation failure | `src/commands/daemon.js` maps `confirmed === false` to `E_DAEMON_START_FAILED` with exit code 1 in envelope meta. | Not directly covered by the new tests. | Test gap. | Add a focused command unit test if start-failure UX is changed. |
| Daemon stale status cleanup | `src/commands/daemon.js` removes state when `status` sees a stored pid that is no longer alive. | New daemon lifecycle unit test verifies stale state deletion and one JSON stdout line. | Covered. | Keep status cleanup best-effort and isolated to daemon state path. |
| Daemon tokenless stop cleanup | `src/commands/daemon.js` cleans state with no `tokenFingerprint` and no legacy `token` before attempting process termination. | New daemon lifecycle unit test verifies cleanup and JSON stdout shape. | Covered. | Preserve this safety gate; it prevents killing a process based on unverifiable state. |
| Daemon stop process kill | `src/commands/daemon.js` uses platform-specific termination after reading token-bearing state, then deletes state only if the fresh state still matches the same token id. | Existing direct tests were not found. New tests intentionally avoid live process termination. | High-risk behavior, test gap. | Add isolated process-util/kill-path tests only with safe child processes or mocks; do not launch persistent daemon in normal tests. |
| Daemon atomic state write | `bin/pdd-daemon.js` writes a pid-scoped temp file and renames it to `DAEMON_STATE_PATH`. | Existing test coverage not direct; behavior inferred from code. | Documented, not covered. | If state schema changes, extract a small state writer helper and test atomic write/read behavior directly. |
| Daemon refresh interval/jitter | `bin/pdd-daemon.js` computes delay from `refreshIntervalMs` and `refreshJitterMs`, clamped to at least 60s. Invalid env values currently fall back through `src/infra/config.js`. | `test/pbt/daemon-loop.pbt.test.js` model-tests jitter bounds; config diagnostics recorded invalid numeric fallback/spec drift. | Behavior/spec drift remains. | Decide fallback vs config-error behavior in a dedicated config parser task before changing daemon runtime. |
| Daemon single-flight | `bin/pdd-daemon.js` skips `doRefresh()` when `refreshInProgress` or `shuttingDown` is true. | `test/pbt/daemon-loop.pbt.test.js` model-tests a single-flight guard, but not the actual daemon module internals. | Partially covered. | Consider extracting scheduler/refresh loop helpers only if lifecycle behavior is changed. |
| Daemon graceful shutdown | `bin/pdd-daemon.js` clears timer, aborts current refresh, waits up to 10s, closes browsers, and writes stopped state only if token fingerprint matches. | No direct automated test found. | Test gap. | Add tests after extracting shutdown/state helpers; current top-level daemon module is hard to import safely. |
| Auth refresh missing state | `src/adapter/auth-refresher.js` returns `{ success: false, reason: 'auth_missing' }` if the auth-state path is absent. | `test/pbt/auth-refresher.pbt.test.js` covers nonexistent paths. | Covered. | No behavior change needed. |
| Auth refresh abort before lock | `src/adapter/auth-refresher.js` returns `aborted` before acquiring lock if the signal is already aborted. | Not directly covered. | Test gap. | Add focused unit test when touching abort behavior. |
| Auth refresh lock acquisition failure | `src/adapter/auth-refresher.js` returns `lock_timeout` and does not call browser path when `acquireLock()` fails. | New auth refresher lifecycle unit test verifies existing auth-state bytes remain unchanged on lock failure. | Covered. | Keep lock failure as a non-mutating failure. |
| Auth refresh no-overwrite-on-validation failure | `src/adapter/auth-refresher.js` saves auth state only after heartbeat or full validation succeeds; expired/QR/network paths return failure without `saveAuthState()`. | No direct browser-path unit test found. The new lock-failure test covers one non-mutating failure path only. | Partially covered. | Add mocked browser-path tests before changing heartbeat/full-validation behavior. |
| Auth lock cleanup | `src/adapter/auth-refresher.js` releases lock in `finally` when a lock token exists. `src/infra/auth-lock.js` protects owner token on release. | `test/pbt/auth-lock.pbt.test.js` covers acquire/release, wrong-token safety, stale detection, idempotent release, and stale recovery. | Covered at lock helper level. | Add auth-refresher release-on-error test if browser error handling changes. |
| Fixture mode auth refresh | `src/adapter/auth-refresher.js` short-circuits to `mockRefreshAuth()` when `PDD_TEST_ADAPTER=fixture`. | `test/pbt/auth-refresher.pbt.test.js` covers fixture shape for success/expired. | Covered. | Keep fixture mode free of browser/auth-state side effects. |
| JSON stdout purity for daemon commands | `src/commands/daemon.js` emits envelopes through `emit()`. | New daemon lifecycle tests assert one stdout JSON line for start/status/stop seams. | Covered for direct command seams. | Add CLI subprocess e2e if daemon registry/options change. |

## Follow-Up Task Candidates

- `daemon-state-helper-extraction`: extract daemon state read/write/cleanup helpers only if upcoming lifecycle work needs deeper direct tests.
- `daemon-stop-kill-path-safety-tests`: cover token-bearing stop behavior with safe child-process or mocked process termination.
- `auth-refresher-browser-failure-no-overwrite`: mock browser/validation paths and assert failed heartbeat/full validation never writes auth-state.
- `config-refresh-env-validation-contract`: decide invalid `PDD_REFRESH_INTERVAL_MS` / `PDD_REFRESH_JITTER_MS` fallback vs config error behavior.

## Validation Notes

Planned validation for this task:

- `npx vitest run test/daemon-lifecycle.unit.test.js test/auth-refresher-lifecycle.unit.test.js`
- `npx vitest run test/pbt/daemon-loop.pbt.test.js test/pbt/auth-refresher.pbt.test.js test/pbt/auth-lock.pbt.test.js`
- `git diff --check`

No real login, real network, persistent daemon, or real auth secret is required.
