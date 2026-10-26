# Design: Command runtime spec synchronization

## Context

This slice updates current documentation truth after the command runtime refactor chain. It does not introduce a new capability or change behavior.

The main risk is accidentally rewriting historical proposal/archive text. Historical OpenSpec changes are useful as records of what was true when those changes were designed. Current specs and project context, however, should match the current codebase so future agents follow the right files.

## Design Decision

Use **current truth docs only** for the first synchronization slice.

### In scope

- `openspec/project.md`
- `openspec/specs/cli-runtime/spec.md`
- `openspec/specs/endpoint-transport/spec.md`
- `openspec/specs/batch-command/spec.md`

### Out of scope

- `openspec/changes/archive/**`
- completed-but-unarchived change history such as `openspec/changes/goods-management-write-ops/**`
- runtime source code
- tests and fixtures

## Why No OpenSpec Proposal

OpenSpec proposals are required for new capabilities, breaking behavior, architecture changes, security changes, or performance work that changes behavior.

This task only aligns current docs with behavior already implemented and tested. It is documentation-only, so it can be implemented directly after Trellis start approval.

## File-Level Plan

### `openspec/project.md`

Current drift:

- Says `node:test` is the test runner.
- Says `npm test` runs 4 classes of `node:test` tests.

Target wording:

- Vitest is the test runner.
- PBT still uses the custom harness under `test/pbt/_harness.js`.
- `npm test` runs `vitest run`.

### `openspec/specs/cli-runtime/spec.md`

Current drift:

- Says `withCommand()` lives in `src/infra/command-runner.js`.
- Hard-codes `All 13 commands`.
- Context shape omits some current fields such as account/pageSession nuances.

Target wording:

- `src/commands/_runner.js` is the stable facade.
- Runner internals live under `src/commands/runner/**`.
- Scenario should avoid stale counts and say commands registered through `withCommand()` share runner lifecycle.
- Keep the existing behavior requirement: command handlers delegate lifecycle and do not inline browser/envelope work.

### `openspec/specs/endpoint-transport/spec.md`

Current drift:

- Mentions `command-runner.js` in singleton client and pageSession scenarios.

Target wording:

- Use `src/commands/runner/single-lifecycle.js` or generic `command runner live lifecycle` wording.
- Preserve endpoint behavior requirements.

### `openspec/specs/batch-command/spec.md`

Current drift:

- Says all `427` existing tests pass.

Target wording:

- Replace with count-free compatibility wording such as targeted runner/batch tests and full suite remain green.
- Do not change batch behavior requirements.

## Validation Design

Because this is docs-only:

1. Run targeted `rg` checks for old current-doc references:
   - `src/infra/command-runner.js`
   - `command-runner.js`
   - `all 427 existing tests`
   - `node:test`
   - `All 13 commands`
2. Scope those checks to current docs, not archives.
3. Run OpenSpec validation:
   - Prefer `openspec validate --strict --no-interactive` for all specs if supported.
   - If the CLI requires an explicit item, run strict validation for changed specs or use `openspec validate <spec-id> --type spec` if supported by local CLI.
4. No runtime test is required unless a non-doc file changes.

## Risks and Mitigations

- Risk: Overwriting historical context in archives.
  - Mitigation: Do not edit `openspec/changes/archive/**`.
- Risk: Turning docs-only sync into spec behavior change.
  - Mitigation: Preserve requirement semantics; change only file paths, test runner wording, and stale counts.
- Risk: OpenSpec validation command differs from expected CLI flags.
  - Mitigation: Try strict full validation first; if unsupported, validate the changed specs individually and record the exact command/result.

## Rollback

Rollback is documentation-only: revert the changed markdown files and rerun the same targeted `rg` checks.
