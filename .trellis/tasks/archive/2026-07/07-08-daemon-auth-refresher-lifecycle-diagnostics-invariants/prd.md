# Daemon auth refresher lifecycle diagnostics and invariants

## Goal

Define and verify the daemon/auth refresher lifecycle invariants needed before changing background process behavior, refresh policy, state schema, or auth cleanup behavior.

## Background

The cross-cutting SCAMPER planning parent identified daemon/auth refresher hardening as the third planned slice. It depends on config/env/path diagnostics because daemon state paths, auth-state paths, refresh intervals, and environment overrides must be understood before changing lifecycle behavior.

This task should map current behavior and add focused invariant coverage where the existing seams allow it. It should avoid real login, real network, and real browser dependency unless a separate integration task is approved.

## Requirements

- Inspect daemon start/stop/status behavior, daemon launcher boundaries, daemon state read/write safety, stale PID cleanup, and foreground/detached process handling.
- Inspect auth refresher lifecycle behavior including refresh interval, jitter/backoff if present, single-flight behavior, no-overwrite-on-failure behavior, lock cleanup, and shutdown handling.
- Identify which invariants are already covered by tests and which are only documented or implicit.
- Prefer fixture/mocked tests for lifecycle invariants and stdout purity; do not require live login or external PDD access.
- Record config/env/path prerequisites discovered by the config diagnostics task before proposing behavior changes.

## Acceptance Criteria

- [ ] A diagnostics artifact lists daemon and auth refresher lifecycle invariants with code/test/spec anchors.
- [ ] Current daemon state file behavior and stale PID handling are documented.
- [ ] Current auth refresh failure behavior is documented, especially whether valid auth state can be overwritten on failure.
- [ ] JSON stdout purity for daemon-facing commands is checked where applicable.
- [ ] Missing tests are either added as focused invariant tests or recorded as follow-up tasks with clear priority.
- [ ] No real login, real network, or persistent auth secret is required for validation.

## Out Of Scope

- Changing daemon foreground/detached semantics.
- Changing daemon state schema or auth refresh policy.
- Changing default paths or env precedence.
- Adding process managers, schedulers, or new dependencies.
- Implementing live browser/PDD integration coverage.

## Open Questions

This task should start after the config/env/path diagnostics task unless the user explicitly chooses to parallelize and accepts the path-contract drift risk.
