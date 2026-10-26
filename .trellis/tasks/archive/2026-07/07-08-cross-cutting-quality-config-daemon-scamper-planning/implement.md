# Implementation Plan

## Purpose

This file plans follow-up work for the parent task. It is not itself an implementation checklist for runtime changes.

## Recommended Child Task Order

### 1. Quality gate CI lint diagnostics and plan

Recommended slug: `quality-gate-ci-lint-diagnostics-plan`

Steps:

1. Reconfirm `package.json` scripts and current `npm run lint` behavior.
2. Reconfirm whether repo-local CI workflow exists.
3. Run current gates:
   - `npm test`
   - `npm run lint` with explicit note that it is placeholder-only.
4. Produce a minimal enforcement proposal:
   - no-dependency option first;
   - dependency-backed lint only if justified;
   - CI workflow only after gate commands are agreed.
5. Decide whether to create an OpenSpec change or keep as tooling/docs-only.

Likely files:

- `package.json`
- `vitest.config.js`
- optional `.github/workflows/**`
- README / task docs if documenting gate reality

### 2. Config env path contract diagnostics and drift map

Recommended slug: `config-env-path-contract-diagnostics-drift-map`

Steps:

1. Read config/path/env specs and source:
   - `.env.example`
   - `src/infra/config.js`
   - `src/infra/paths.js`
   - `.trellis/spec/infra/env-paths.md`
   - `openspec/specs/auth-state-store/spec.md`
2. Build a behavior matrix for env defaults, overrides, invalid values, and sensitive paths.
3. Add diagnostics/invariant tests only where coverage is missing.
4. Record drift decisions separately from runtime changes.
5. Stop for OpenSpec before moving defaults or changing semantics.

Likely files:

- config/path tests under `test/`
- `src/infra/config.js` only if defect is proven
- `src/infra/paths.js` only if defect is proven

### 3. Daemon auth refresher lifecycle diagnostics and invariants

Recommended slug: `daemon-auth-refresher-lifecycle-diagnostics-invariants`

Dependencies:

- Should run after child 2 identifies config/path drift, because daemon state and auth refresh paths depend on those defaults.

Steps:

1. Read daemon/auth refresher source and specs:
   - `src/commands/daemon.js`
   - `bin/pdd-daemon.js`
   - `src/infra/daemon-launcher.js`
   - `src/adapter/auth-refresher.js`
   - `openspec/specs/daemon-lifecycle/spec.md`
   - `openspec/specs/auth-refresher/spec.md`
2. Run existing daemon/auth-refresher tests if present; otherwise locate gaps.
3. Add diagnostics/invariants around daemon state, stale PID cleanup, refresh interval/jitter, single-flight, shutdown, stdout purity, no-overwrite-on-failure, and lock/browser cleanup.
4. Avoid real network/login; use fixture/mocks/temp dirs/subprocess seams.
5. Stop for OpenSpec before behavior/schema/security changes.

Likely files:

- daemon/auth-refresher tests under `test/`
- runtime files only if a true contract bug is found

## Parent Validation

For this parent task:

```bash
python ./.trellis/scripts/task.py validate ./.trellis/tasks/07-08-cross-cutting-quality-config-daemon-scamper-planning
python ./.trellis/scripts/get_context.py
```

No code tests are required for this parent because it only writes planning artifacts.

## Stop Conditions

- Do not start implementation from the parent task without explicit user approval.
- Do not create OpenSpec changes unless a child task needs behavior/policy changes.
- Do not add dependencies or CI files during this parent planning task.
- Do not change runtime config, path, daemon, or auth refresher behavior in this parent task.
