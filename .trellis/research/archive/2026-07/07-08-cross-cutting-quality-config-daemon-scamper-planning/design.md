# Design: Cross-cutting quality config daemon SCAMPER planning

## Design Direction

This parent task is a planning container for three remaining cross-cutting optimization directions. It does not change runtime behavior.

The recommended sequence is:

```text
parent planning
  -> child 1: quality gate / CI / lint diagnostics
  -> child 2: config / env / path diagnostics + drift map
  -> child 3: daemon / auth refresher lifecycle diagnostics
  -> optional OpenSpec proposal(s) before behavior changes
```

## Why This Order

1. Quality gate first because previous cross-cutting work increased test value, but the repository still lacks a real lint gate and repo-local CI workflow.
2. Config/env/path second because daemon and auth refresher behavior depends on runtime defaults and path precedence.
3. Daemon/auth refresher third because it is more stateful, long-running, and security-sensitive; it should not be changed before config/path drift is understood.

## Boundary Model

### Quality gate / CI / lint

Owners:

- `package.json`
- `vitest.config.js`
- future `.github/workflows/**` if introduced
- README / Trellis quality docs if updated

Contracts:

- `npm test` remains the hard verified gate until a real lint/CI gate exists.
- `npm run lint` must not be described as a real lint gate while it is `echo no-lint`.
- No new dependency by default.

### Config / env / path

Owners:

- `.env.example`
- `src/infra/config.js`
- `src/infra/paths.js`
- `.trellis/spec/infra/env-paths.md`
- OpenSpec auth/config-related specs

Contracts:

- Env parsing and path defaults must be explicit and testable.
- Sensitive paths under `data/` must not be committed or printed.
- Known auth-state default drift must be resolved deliberately, not as drive-by cleanup.

### Daemon / auth refresher

Owners:

- `src/commands/daemon.js`
- `bin/pdd-daemon.js`
- `src/infra/daemon-launcher.js`
- `src/adapter/auth-refresher.js`
- `src/infra/auth-lock.js`
- daemon/auth OpenSpec specs

Contracts:

- Daemon commands emit standard envelopes and do not launch browser through `withCommand`.
- Daemon logs/debug output must not pollute JSON stdout.
- Auth refresher must avoid overwriting auth state on failure and must clean browser/locks.
- Tests should rely on fixture/unit/PBT/subprocess seams, not real account credentials.

## OpenSpec Decision

No OpenSpec proposal is required for this parent planning task.

A proposal is likely required before:

- adding or changing repo CI policy in a way that changes contributor workflow;
- introducing new lint dependencies or enforcement rules if they become normative project policy;
- changing auth-state default path or migration behavior;
- changing env precedence or runtime config semantics;
- changing daemon state schema, start/stop/status behavior, refresh policy, token/security checks, or foreground/detached behavior;
- changing public CLI envelope/error/stdout behavior.

## Risk Controls

- Child tasks must start diagnostics-first.
- Do not add new dependencies in the parent task.
- Do not edit runtime behavior in the parent task.
- Do not use live network or credentials in tests.
- Keep each child independently verifiable and small enough to finish/commit/archive separately.
