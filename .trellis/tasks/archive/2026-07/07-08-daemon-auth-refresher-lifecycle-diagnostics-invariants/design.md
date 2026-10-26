# Design

## Boundary

This task hardens understanding and tests around lifecycle contracts. It should not redesign the daemon or auth refresher in place.

## Evidence Sources

- Daemon entry and commands: `bin/pdd-daemon.js`, `src/commands/daemon.js`, daemon launcher/state helpers under `src/infra/`.
- Auth refresh flow: auth refresher adapter/service code, auth-state helpers, auth lock helpers, account registry interactions.
- Specs: `openspec/specs/daemon-lifecycle/spec.md`, `openspec/specs/auth-refresher/spec.md`, auth-state-store specs.
- Tests: daemon command tests, subprocess/e2e JSON purity tests, auth-state/account lifecycle tests.

## Invariant Categories

- Process lifecycle: start, stop, status, stale PID, detached vs foreground, repeated start.
- State lifecycle: atomic write/read behavior, invalid state handling, stale state cleanup, schema compatibility.
- Auth lifecycle: single-flight refresh, no overwrite on failed refresh, lock cleanup, browser cleanup, shutdown.
- Output lifecycle: one JSON line on stdout under `--json`, diagnostics on stderr, redaction preserved.

## Dependency

Use the config/env/path diagnostics output before deciding whether daemon state paths or auth-state defaults are correct. If that task is not complete, record path-dependent assertions as provisional.

## OpenSpec Boundary

OpenSpec is required before changing daemon lifecycle semantics, auth refresh policy, state schema, token/security handling, or foreground/detached behavior. Focused tests for existing behavior can stay in this task.
