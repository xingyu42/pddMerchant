# Cross-cutting quality config daemon SCAMPER planning

## Goal

Plan the next parent cross-cutting optimization pass for `pdd-cli` after endpoint execution, fixture/live parity, command runtime, auth/account/mall lifecycle, and observability/logging/redaction work are complete.

This parent task covers three remaining high-value directions:

1. Quality gate / CI / real lint enforcement.
2. Config / env / path contract convergence.
3. Daemon / auth refresher / background lifecycle hardening.

User value: future changes get safer automatic checks, clearer runtime configuration boundaries, and more reliable long-running auth refresh behavior without weakening existing envelope, fixture, auth, logging, or OpenSpec contracts.

## Background

- Current Trellis context at creation had no active task and a clean git working tree.
- Recent cross-cutting lines are archived and complete: endpoint execution contract, fixture/live parity, command runtime/batch/single lifecycle, auth/account/mall lifecycle, and observability/logging/redaction.
- Memory and current repo evidence both identify a concrete quality weakness: `package.json:17` defines `npm run lint` as `echo no-lint`.
- `vitest.config.js:5` includes `test/**/*.test.js`; `vitest.config.js:10` uses `pool: 'forks'`, so test execution is real and broad enough to serve as the current hard quality gate.
- `.github/workflows` is missing in this checkout, so there is no repo-local CI workflow to enforce tests on push/PR.
- `.env.example:9`, `.env.example:56`, `.env.example:61`, and `.env.example:64` document auth path, log destination, daemon refresh interval, and daemon jitter env vars.
- `src/infra/config.js:37` to `src/infra/config.js:40` map auth/log/daemon env keys into runtime config.
- `src/infra/config.js:102` rejects console-like log destinations; `src/infra/config.js:114` loads runtime config and `src/infra/config.js:124` to `src/infra/config.js:125` default daemon refresh interval/jitter.
- `src/infra/paths.js:15` resolves `PDD_AUTH_STATE_PATH`; `src/infra/paths.js:22` stores daemon state under project-local `data/daemon-state.json`; `src/infra/paths.js:27` resolves `PDD_ACCOUNTS_DIR`.
- `openspec/specs/auth-state-store/spec.md:6` says the default auth-state path should be OS user-data, while current `src/infra/paths.js:15` still defaults to project-local `data/auth-state.json`; this is known spec/code drift and must not be silently changed without a decision.
- `openspec/specs/auth-refresher/spec.md:9` owns silent auth refresh behavior.
- `openspec/specs/daemon-lifecycle/spec.md:9`, `:34`, `:59`, and `:75` define daemon start/stop/status/refresh-loop contracts.
- `bin/pdd-daemon.js:46` to `bin/pdd-daemon.js:50` write daemon state atomically with tmp + rename; `bin/pdd-daemon.js:62` to `bin/pdd-daemon.js:63` compute refresh interval/jitter from runtime config.
- `src/commands/daemon.js:6`, `:34`, and `:55` expose daemon state path through command envelopes.

## Requirements

- R1: Use SCAMPER lenses to plan the three directions before implementation.
- R2: Treat this task as a parent planning task; do not modify runtime behavior in this parent.
- R3: Split follow-up work into independently verifiable child tasks, with each child documenting its own dependencies and OpenSpec boundary.
- R4: Prefer diagnostics/invariants first for each direction unless the child is explicitly just CI/tooling configuration.
- R5: Do not add new npm dependencies unless a child task proves they are necessary and compatible with the existing V0.1 no-new-dependency constraint in `openspec/project.md`.
- R6: Preserve envelope shape, JSON stdout purity, fixture mode, auth/account isolation, and sensitive-data redaction.
- R7: Any behavior change to auth paths, daemon lifecycle, runtime config semantics, public CLI output, or CI policy that affects contributors/users must pass an OpenSpec decision first.
- R8: Keep real merchant network, real credentials, QR content, and local `data/` secrets out of all automated tests.

## SCAMPER Map

### 1. Quality gate / CI / real lint enforcement

- Substitute: replace placeholder lint with a real static quality gate or a repo-local script that checks concrete invariants.
- Combine: combine existing targeted Vitest/PBT suites with a CI workflow once the repo has agreed gate commands.
- Adapt: reuse the existing `npm test` reality as the hard gate; introduce lint gradually so it does not block on unrelated historical style drift.
- Modify / Magnify / Minify: start with diagnostics for current scripts and CI absence before adding tools.
- Put to another use: use CI as the automatic guard for all previous cross-cutting contracts.
- Eliminate: eliminate misleading “lint passed” reports caused by `echo no-lint`.
- Reverse / Rearrange: define the gate before adding more cross-cutting code, so future tasks have a real guardrail.

Recommended first child: **Quality gate CI lint diagnostics and plan**.

### 2. Config / env / path contract convergence

- Substitute: replace scattered env/path assumptions with one tested matrix of runtime config and path precedence.
- Combine: align `.env.example`, `src/infra/config.js`, `src/infra/paths.js`, Trellis specs, and OpenSpec specs.
- Adapt: reuse prior auth/account/mall lifecycle diagnostics style: freeze behavior, record drift, then decide whether docs or code should change.
- Modify / Magnify / Minify: magnify validation around unsafe env values and sensitive paths without moving defaults yet.
- Put to another use: use env/path tests as guardrails for daemon and account registry work.
- Eliminate: eliminate silent fallback or stale documentation where current behavior and specs disagree.
- Reverse / Rearrange: decide the auth-state path drift before touching daemon/auth refresher paths.

Recommended second child: **Config env path contract diagnostics and drift map**.

### 3. Daemon / auth refresher / background lifecycle hardening

- Substitute: replace implicit daemon lifecycle assumptions with executable invariants around state, start/stop/status, refresh loop, and shutdown.
- Combine: combine daemon command envelope checks, auth refresher RAII checks, lock behavior, and config refresh interval/jitter tests.
- Adapt: reuse existing fixture and mock seams; do not require real browser/login in daemon tests.
- Modify / Magnify / Minify: magnify daemon state file and process-safety invariants before changing behavior.
- Put to another use: daemon status can later become a stronger `doctor` diagnostic once contracts are frozen.
- Eliminate: eliminate fragile assumptions around stale PID, token/state matching, and background logs leaking into stdout.
- Reverse / Rearrange: do config/env/path diagnostics first because daemon behavior depends on those defaults and env parsing.

Recommended third child: **Daemon auth refresher lifecycle diagnostics and invariants**.

## Recommended Order

1. **Quality gate CI lint diagnostics and plan** — highest leverage because current `lint` is placeholder and no CI exists.
2. **Config env path contract diagnostics and drift map** — required before safely touching daemon/auth paths.
3. **Daemon auth refresher lifecycle diagnostics and invariants** — depends on config/path decisions and should avoid live network.

## Proposed Child Task Backlog

### Child 1: Quality gate CI lint diagnostics and plan

Goal: classify the current quality gate reality and produce the smallest safe first enforcement step.

Expected scope:

- Confirm current scripts and absence of CI.
- Decide whether first step is documentation/test script cleanup, built-in Node checks, or introducing lint tooling.
- Avoid adding dependencies until explicitly justified.
- Preserve `npm test` as the current hard gate.

OpenSpec boundary: usually no proposal for diagnostics or non-breaking tooling docs; proposal may be needed if CI changes user/contributor workflow in a meaningful way.

### Child 2: Config env path contract diagnostics and drift map

Goal: freeze current env/path/config behavior and identify docs/spec drift before any path migration or validation change.

Expected scope:

- Build a matrix for auth paths, accounts paths, log destination, rate/cooldown envs, daemon refresh envs, and fixture envs.
- Compare `.env.example`, Trellis specs, OpenSpec specs, and code.
- Record whether drift should be fixed in code or docs.

OpenSpec boundary: required before changing default auth-state path, daemon state path, env precedence, config validation semantics, or sensitive path behavior.

### Child 3: Daemon auth refresher lifecycle diagnostics and invariants

Goal: cover daemon start/stop/status/refresh-loop/auth-refresher invariants without real login/network.

Expected scope:

- Start with unit/PBT/subprocess seams where possible.
- Cover daemon-state write/read safety, stale state cleanup, refresh interval/jitter bounds, single-flight behavior, shutdown behavior, and stdout JSON purity.
- Cover auth refresher no-overwrite-on-failure and browser/lock cleanup through fixture/mocks.

OpenSpec boundary: required before changing daemon lifecycle semantics, state schema, token/security behavior, foreground/detached behavior, or auth refresh policy.

## Acceptance Criteria

- [x] Parent Trellis planning task is created.
- [x] The three directions are captured with evidence, value, risk, and recommended order.
- [x] Follow-up child task backlog is defined with dependencies and OpenSpec boundaries.
- [x] No runtime code is changed in this parent planning task.
- [x] Planning artifacts include `prd.md`, `design.md`, and `implement.md`.
- [x] No blocking repository-answerable question remains.

## Out Of Scope

- Creating or starting child implementation tasks in this parent planning turn.
- Adding CI files, lint tooling, or dependencies.
- Changing env/path defaults or auth-state storage behavior.
- Changing daemon runtime behavior or daemon state schema.
- Running live PDD network, real browser login, QR login, or credential-dependent daemon flows.

## Open Questions

None blocking. Recommended next gate: create/start the first child task, `Quality gate CI lint diagnostics and plan`.
