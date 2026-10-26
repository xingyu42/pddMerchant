# Auth account mall lifecycle SCAMPER planning

## Goal

Use SCAMPER to choose and plan the next cross-cutting optimization surface after endpoint execution, fixture/live parity, and command runtime work. The recommended surface is the auth/account/mall lifecycle: how pdd-cli chooses an auth state, resolves an account, validates login, resolves or switches mall context, and preserves those decisions across single-command, batch, fixture, and live execution.

User value: future auth/account/mall changes can be made without accidentally leaking credentials, selecting the wrong shop, mixing account state between batch items, or changing JSON envelope/error behavior.

## Background

- Previous cross-cutting lines are complete: endpoint execution contract, fixture/live parity diagnostics, command runtime/batch/envelope hardening, and local OpenSpec strict validation cleanup.
- Current Trellis context at creation on 2026-07-08 had no active task and a clean git working tree.
- `src/commands/runner/single-lifecycle.js:35` delegates account resolution to `resolveAccountContext()`.
- `src/commands/runner/single-lifecycle.js:63` validates merchant auth with deadline-aware timeout behavior.
- `src/commands/runner/single-lifecycle.js:82` resolves or switches live mall context before command `run(ctx)`.
- `src/commands/runner/single-lifecycle.js:152` chooses `runtime.authPath` from resolved account context, explicit auth path, or default `AUTH_STATE_PATH`.
- `src/commands/runner/single-lifecycle.js:159` performs legacy auth-state migration and appends warnings.
- `src/commands/runner/batch-executor.js:59` rejects incompatible `--all-accounts` combinations.
- `src/commands/runner/batch-executor.js:80` shapes per-account options by clearing `mall`, clearing `account`, setting account-specific `authStatePath`, and deriving correlation id.
- `src/infra/account-resolver.js:6` is the account/auth path decision point for explicit account, explicit auth path, default account, auto-single account, and legacy fallback.
- `src/infra/account-resolver.js:79` defines account metadata projected into envelopes.
- `src/infra/paths.js:14` currently resolves default merchant auth state to `data/auth-state.json` unless `PDD_AUTH_STATE_PATH` is set.
- `src/adapter/mall-reader.js:191` owns mall context read precedence and mock/live behavior.
- `src/adapter/mall-writer.js:54` owns mall switching and post-switch verification.
- `src/adapter/mall-id.js:41` validates caller-supplied mall ids.
- Existing coverage includes account resolver PBT (`test/pbt/account-resolver.pbt.test.js:11`), batch option invariants (`test/batch-orchestration.unit.test.js:83`, `test/batch-orchestration.unit.test.js:98`), multi-account e2e (`test/e2e/multi-account-switch.e2e.test.js:29`), and mall reader/writer/id tests.
- Trellis runner spec states runner owns auth state resolution, account context, mall switching, timeout, abort signal, and fixture branching at `.trellis/spec/commands/runner-lifecycle.md:30`.
- Trellis auth/mall spec records default auth paths, account env keys, strict mall id parsing, and mall probe order in `.trellis/spec/adapter/auth-mall-context.md`.
- OpenSpec drift candidates were observed during planning: `openspec/specs/auth-state-store/spec.md:8` says default `AUTH_STATE_PATH` should be OS user-data, while current code uses project-local `data/auth-state.json`; `openspec/specs/mall-context-resolution/spec.md:54` and `:85` mention `E_MALL_ID_INVALID`, while current `requireMallId()` maps invalid ids through `E_USAGE`.

## Requirements

- R1: Use SCAMPER lenses to map auth/account/mall lifecycle optimization candidates before implementation.
- R2: Prefer diagnostics and executable invariants as the first implementation slice; do not directly change auth/account/security behavior in the planning task.
- R3: Treat auth/account/mall behavior changes as OpenSpec-sensitive. New behavior, security/auth storage changes, envelope/error changes, or architecture pattern changes require an OpenSpec proposal before implementation.
- R4: Preserve existing envelope shape `{ ok, command, data, error, meta }`, JSON purity, and sensitive-data redaction rules.
- R5: Avoid real merchant network or real account dependency in automated tests; use fixture, unit, or PBT seams first.
- R6: Keep batch account isolation explicit: no shared auth path between per-account executions, no carried mall override, and no cross-account context pollution.
- R7: Capture spec drift as planning evidence; do not silently “fix” specs or behavior without deciding which side is intended.

## SCAMPER Map

### Substitute

- Candidate S1: Substitute implicit auth/account/mall assumptions with an executable lifecycle matrix.
  - Evidence: account selection, auth path choice, mall switching, and envelope account meta are currently spread across runner, account resolver, paths, and mall adapter modules.
  - Expected value: future changes can be checked against one matrix instead of relying on memory.
  - Risk: matrix can become tautological if it only mirrors implementation internals.
  - Suggested first action: test observable ctx/envelope behavior for representative combinations, not private helper order.

### Combine

- Candidate C1: Combine single-command and batch account isolation checks into one shared test vocabulary.
  - Evidence: `executeBatch()` calls `executeSingle()` with shaped per-account opts, and batch tests already assert some shaping.
  - Expected value: catches drift where single path and batch path choose different account/auth/mall semantics.
  - Risk: over-shared helpers could hide legitimate single/batch differences.
  - Suggested first action: add a small table of scenarios only if tests start duplicating setup.

### Adapt

- Candidate A1: Adapt the prior endpoint/runner sequence: diagnostics -> invariants -> compatible cleanup -> optional extraction.
  - Evidence: previous lines succeeded because they froze behavior before refactoring.
  - Expected value: safe for auth/security-sensitive code.
  - Risk: over-planning if the first audit finds no high-value gaps.
  - Suggested first action: diagnostics/invariants first; postpone extraction.

### Modify / Magnify / Minify

- Candidate M1: Magnify boundary tests around `resolveAccountContext()` and runner context injection.
  - Evidence: `resolveAccountContext()` owns multiple branches: explicit path, explicit account, empty registry, default account, auto-single, account-required, and fallback.
  - Expected value: prevents wrong account/auth path selection.
  - Risk: if tests mock too much, they may miss filesystem/env realities.
  - Suggested first action: combine pure resolver tests with one command-level fixture/live seam assertion.

### Put to another use

- Candidate P1: Use this audit to classify OpenSpec drift before code follows stale docs.
  - Evidence: default auth path and mall invalid error code differ between current code and OpenSpec text.
  - Expected value: prevents future agents from “fixing” the wrong side accidentally.
  - Risk: spec cleanup can distract from executable safety.
  - Suggested first action: create a warning-first drift note/checklist, then decide separately whether to update specs or behavior.

### Eliminate

- Candidate E1: Eliminate duplicated or hidden mall/auth assumptions from services and commands.
  - Evidence: project specs say services should receive `ctx` and not read global auth/mall state directly.
  - Expected value: lower risk of domain commands bypassing account isolation.
  - Risk: broad search/refactor could become too large.
  - Suggested first action: static scan and tests first; only refactor if bypasses are found.

### Reverse / Rearrange

- Candidate R1: Rearrange future work so observability/redaction comes after auth/account/mall boundaries are frozen.
  - Evidence: logging/redaction needs a clear list of sensitive fields and context fields.
  - Expected value: makes later redaction work easier and safer.
  - Risk: delays logging improvements.
  - Suggested first action: finish auth/account/mall lifecycle diagnostics first, then route to observability.

## Recommended First Implementation Slice

**Auth/account/mall lifecycle diagnostics and invariants**.

Scope:

- Add contract coverage for representative auth/account/mall combinations across resolver and runner boundaries.
- Confirm fixture/live ctx account and mall fields stay consistent for selected scenarios.
- Confirm batch per-account isolation remains explicit and no mall override leaks into per-account execution.
- Record OpenSpec drift candidates without changing public behavior.

Do not start with:

- Moving auth state default path.
- Changing `E_USAGE` vs `E_MALL_ID_INVALID` behavior.
- Refactoring account registry or mall switcher modules.
- Adding new logging/redaction fields.

## Acceptance Criteria

- [x] The recommended next cross-cutting surface is selected: auth/account/mall lifecycle.
- [x] SCAMPER candidates are mapped with evidence, expected value, risk, and suggested action.
- [x] The first implementation slice is diagnostics/invariants first, not behavior change.
- [x] OpenSpec proposal trigger is documented for any future auth/security/mall behavior change.
- [x] OpenSpec drift candidates are recorded as planning evidence.
- [x] No blocking repository-answerable question remains.

## Out Of Scope

- Direct implementation in this planning task.
- Real browser/network login or live merchant-account tests.
- Credential, cookie, QR, phone, receiver/address, image, or encrypted credential exposure.
- Changing auth storage default path or migration behavior without OpenSpec approval.
- Changing mall id error code semantics without OpenSpec approval.
- Broad logging/redaction work; recommended as a later SCAMPER surface.

## Open Questions

None blocking. The recommended next gate is user approval to create/start the first implementation task: `Auth account mall lifecycle diagnostics and invariants`.
