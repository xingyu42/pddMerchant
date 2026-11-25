# ADR 0008: Closed Three-Preset Command Lifecycle and Envelope Kernel

## Status

Accepted — 2026-11-25

## Context

Non-runner commands (`init`, `login`, `doctor`, `account.*`, `config.*`) historically bypassed `withCommand()`, causing contract drift (`missing correlation_id`, omitted `--no-color`, missing timeouts) and accumulating direct `adapter/` imports. Furthermore, omitting `needsBrowser: false` on `doctor` triggered a duplicate browser launch and broke `E_CHROMIUM_MISSING` reporting, while requiring runtime config validation blocked `config.*` diagnostics whenever `config/config.json` held invalid syntax.

## Decision

- **Universal `withCommand` + `envelope-kernel` routing**: Every CLI command—including `init`, `login`, `login.consumer`, `doctor`, `account.*`, and `config.*`—routes through `withCommand` and `runWithEnvelopeKernel`, which owns dynamic command naming, `correlation_id`, latency timing, cooperative timeout/deadline inheritance, `OutputSink.hasEmitted()` single-emit guarding, and attaches `runtimeConfigPolicy` directly to the returned handler.
- **Closed three-preset lifecycle model**: Declare command runtime requirements using three mutually exclusive `lifecycle` presets validated strictly at module load time (`E_CONFIG_INVALID` on invalid combinations):
  - `merchant` (default): full runtime config, account lease/verification, browser session, mall context, and `--all-accounts` support.
  - `local`: full runtime config, zero runner-prelaunched browser (`needsBrowser: false`, `needsAuth: false`), configurable `needsAccount` (`none | optional | required`) and `needsMall` (`none | stored`), rejecting `--all-accounts` with `E_USAGE`.
  - `maintenance`: skips runtime config validation, SQLite, account lookup, and browser launch (`runtimeConfigPolicy: 'maintenance'`), guaranteeing `config.*` remains reachable to inspect or repair damaged local configuration.

## Considered Options

- **Leaving local/maintenance commands outside `withCommand`**: Rejected because every special-case command duplicated envelope construction, exit-code mapping, and signal handling while drifting from runner contracts.
- **Arbitrary open boolean flags (`needsBrowser`, `needsAuth`, `needsConfig`)**: Rejected because impossible flag combinations (such as `needsBrowser: false` with `needsAuth: true`) persisted undetected until runtime failures occurred.

## Consequences

- `src/commands/` retains zero non-runner `adapter/` imports; `doctor` runs Chromium checks before opening at most one browser session, and `config.*` diagnoses corrupted config files inside standard v2 envelopes.
- New CLI commands must choose one of `merchant`, `local`, or `maintenance`; unsupported flag combinations fail immediately on module load.
