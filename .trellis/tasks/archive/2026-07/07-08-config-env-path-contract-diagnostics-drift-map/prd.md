# Config env path contract diagnostics and drift map

## Goal

Build a repo-backed diagnostics map for pdd-cli configuration, environment variables, and runtime paths before changing any defaults or validation semantics.

## Background

The cross-cutting SCAMPER planning parent identified config/env/path convergence as the next dependency-sensitive slice after the quality gate work. The current repo has known drift risk around auth-state default paths, account storage overrides, log destination validation, endpoint rate/cooldown envs, daemon refresh envs, and fixture envs.

This task is diagnostic first. It should freeze the current behavior and identify drift between code, `.env.example`, Trellis specs, OpenSpec specs, tests, and user-facing docs. Runtime behavior changes belong in follow-up tasks after the drift map is reviewed.

## Requirements

- Capture the current env/path/config contract for merchant auth state, consumer auth state, account registry, accounts directory, daemon state, log destination, fixture adapter inputs, endpoint rate limiting, cooldown, and daemon refresh timing.
- Compare executable code and tests against `.env.example`, Trellis specs, OpenSpec specs, and relevant docs.
- Mark each mismatch as one of: code is source of truth, docs/spec should be updated, behavior should change later, or unclear and needs review.
- Keep the output usable as an implementation handoff: include file anchors, observed behavior, expected behavior, risk, and recommended next action.
- Do not change runtime defaults, env precedence, path resolution, validation behavior, or security-sensitive path handling in this diagnostics task.

## Acceptance Criteria

- [ ] A diagnostics artifact lists every relevant env var and path with code/test/doc/spec anchors.
- [ ] Known auth-state default path drift is explicitly recorded with a recommendation and follow-up boundary.
- [ ] Log destination validation and stdout/stderr rejection behavior are checked against code and tests.
- [ ] Fixture adapter envs and endpoint rate/cooldown envs are checked against current test coverage.
- [ ] Daemon-related env/path findings are captured as prerequisites for the daemon/auth refresher lifecycle task.
- [ ] No production behavior changes are made unless a separate Trellis/OpenSpec task is created and approved.

## Out Of Scope

- Changing default auth-state, account, daemon, or log paths.
- Adding new config schema machinery or dependencies.
- Introducing CI, real lint tooling, or daemon lifecycle behavior changes.
- Editing OpenSpec capability specs unless the diagnostics prove a spec-only correction is required and the change is explicitly approved.

## Open Questions

None blocking. If the diagnostics expose behavior/spec conflict, record the recommended decision instead of changing behavior inside this task.
