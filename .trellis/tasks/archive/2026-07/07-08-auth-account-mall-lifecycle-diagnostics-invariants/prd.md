# Auth account mall lifecycle diagnostics and invariants

## Goal

Add executable diagnostics/invariant coverage for the auth/account/mall lifecycle selected by the SCAMPER planning parent task. The work should freeze current observable behavior before any auth storage, account selection, mall switch, or redaction changes.

User value: future changes cannot silently select the wrong account, use the wrong auth-state path, leak a mall override into batch execution, or change account/mall envelope behavior without tests catching it.

## Parent / Dependency

Parent planning task: `07-08-auth-account-mall-lifecycle-scamper-planning`.

This child depends on the parent decision: diagnostics/invariants first, no behavior change unless tests expose a true defect. OpenSpec proposal is required before changing auth/security storage behavior, mall id error semantics, account registry schema, mall probe order, or security-sensitive logging behavior.

## Confirmed Facts

- `src/infra/account-resolver.js` chooses auth/account context for explicit path, explicit account, empty registry, default account, auto-single account, and multi-account-required cases.
- `src/commands/runner/single-lifecycle.js` injects resolved account/auth/mall state into command ctx and envelopes through the finalizer.
- `src/commands/runner/batch-executor.js` shapes per-account options by clearing `account` and `mall`, setting per-account `authStatePath`, and deriving per-account correlation id.
- Existing tests already cover batch mutual exclusions, empty disabled-account batch behavior, per-account option shaping, account resolver basics, multi-account e2e, and mall reader/writer/id behavior.
- Known planning drift candidates are not to be fixed in this task: default auth path spec vs code, and `E_MALL_ID_INVALID` spec vs current `E_USAGE` behavior.

## Requirements

- R1: Add or extend tests only for observable auth/account/mall lifecycle contracts that are currently under-specified.
- R2: Keep the change coverage-only unless a test exposes a true bug in current intended behavior.
- R3: Do not use real merchant network, real credentials, or files under real `data/`; tests must use fixture, mocks, or temp env paths.
- R4: Preserve envelope shape, exit-code mapping, and sensitive-data behavior.
- R5: Keep batch account isolation explicit: per-account auth path, cleared account flag, cleared mall override, and no cross-account context pollution.
- R6: If behavior change appears necessary, stop and route through OpenSpec before editing runtime code.

## Acceptance Criteria

- [x] Resolver tests cover representative source/authPath/meta cases: explicit auth path, default account, auto-single account, multi-enabled-without-default error, and no-account fallback. Covered by `test/auth-account-mall-lifecycle.unit.test.js`.
- [x] Runner-level tests cover account context injection into command ctx and success envelope meta for fixture mode without real browser/network. Covered by `test/auth-account-mall-lifecycle.unit.test.js`.
- [x] Batch-level tests continue to prove per-account authPath and cleared mall/account options; existing `test/batch-orchestration.unit.test.js` remains green and did not need duplicate assertions.
- [x] Mall lifecycle tests were not duplicated; existing mall reader/writer/id unit and PBT suites remain green.
- [x] OpenSpec drift candidates remain documented in the parent planning task; this child made no OpenSpec or runtime behavior changes.
- [x] Targeted Vitest commands pass: auth/account/runner/batch group passed 5 files / 29 tests; mall group passed 5 files / 53 tests; new lifecycle file passed 7 tests.
- [x] `npm run lint` was run and returned `no-lint`, the repository-known no-op.

## Out Of Scope

- Moving default auth state path.
- Changing invalid mall id error code semantics.
- Changing account registry schema or credential storage.
- Changing mall probe order or switch behavior.
- Logging/redaction expansion.
- Real login, real browser-network, or live merchant tests.

## Open Questions

None blocking. Start with baseline tests, then add the smallest coverage that closes the matrix gaps.

