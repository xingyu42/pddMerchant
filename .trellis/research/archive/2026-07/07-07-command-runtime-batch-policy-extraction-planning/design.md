# Design: Batch policy extraction

## Context

`src/commands/runner/batch-executor.js` is the correct owner for batch execution because it is the runner module that coordinates `withCommand()` routing, `executeBatch()`, and per-account `executeSingle()` calls. The goal is not to move ownership out of the runner layer. The goal is to reduce policy density inside the file while preserving every observable batch contract.

The previous task added `test/batch-orchestration.unit.test.js`, which protects the highest-risk behavior before this refactor.

## Design Decision

Use **same-module helper extraction first**.

That means the first implementation should keep all extracted helpers inside `src/commands/runner/batch-executor.js` unless a very small sibling under `src/commands/runner/` is clearly justified after tests remain green.

### Why

- It preserves the existing dependency direction: commands runner may import infra helpers, but infra must not learn about commands.
- It avoids creating a new architecture pattern just to reduce one file.
- It keeps rollback simple: helpers can be inlined if the refactor feels worse.
- It does not require OpenSpec because public behavior is unchanged.

### Alternatives Considered

1. **New sibling module such as `batch-policy.js`**
   - Pro: clearer file size reduction.
   - Con: higher import/export surface and slightly more architecture churn.
   - Decision: defer unless same-file extraction is insufficient.
2. **Move generic helpers to `src/infra/`**
   - Pro: potential reuse.
   - Con: wrong ownership for command-specific batch policy; risks over-generalization.
   - Decision: do not do this in the first slice.
3. **Extract cooldown attribution**
   - Pro: it is already standalone and exported.
   - Con: it has its own behavior and tests; mixing it into this refactor increases scope.
   - Decision: leave unchanged unless mechanical movement is unavoidable.

## Proposed Helper Boundaries

### `validateBatchOptions(opts)`

Inputs:

- `opts.account`
- `opts.authStatePath`
- `process.env.PDD_AUTH_STATE_PATH`
- `opts.mall`

Output:

- Throws existing `PddCliError` for mutual exclusions.
- Returns `warnings`, initially containing `unused_flag_mall_in_batch` when applicable.

Contracts:

- Must fail before `listAccounts()`, `ensureDaemonRunning()`, `executeSingle()`, jitter, or `emit()`.
- Must preserve existing error codes, messages, hints, and exit codes.

### `buildPerAccountOptions(opts, slug, batch)`

Inputs:

- original command opts;
- account slug;
- batch `{ correlationId }`.

Output:

- A per-account opts object with:
  - `account: undefined`
  - `authStatePath: accountAuthStatePath(slug)`
  - `allAccounts: false`
  - `mall: undefined`
  - `_correlationId: `${batch.correlationId}:${slug}``

Contracts:

- Must not mutate the original `opts`.
- Must preserve unrelated command options such as `size`, `page`, `json`, and `noColor`.

### `batchJitterMs(random = Math.random)`

Output:

- Integer in `[2000, 4999]`.

Contracts:

- Only computes duration.
- Does not sleep.
- Does not inspect abort state.

### Optional `buildBatchFinalizerMeta(batch, accountResults, exitCodeOverride?)`

Use only if it reduces duplication clearly between empty and non-empty finalization. If it makes the code harder to read, skip it.

## Compatibility

- `src/commands/_runner.js` facade remains unchanged.
- `withCommand()` remains exported from `batch-executor.js`.
- `executeBatch()` remains internal.
- `applyCooldownAttribution()` remains exported for existing tests.
- Batch output and `process.exitCode` behavior remain unchanged.

## OpenSpec Decision

No OpenSpec proposal is required for the recommended slice because it is a no-behavior internal refactor under an existing capability. Existing `batch-command` and `cli-runtime` specs remain the behavioral source of truth.

OpenSpec becomes required if implementation changes:

- CLI flags or eligibility;
- envelope or exit-code behavior;
- account iteration semantics;
- SIGINT behavior;
- public module/facade contracts;
- cross-module architecture pattern.

## Risks and Mitigations

- Risk: Extracted helper accidentally changes validation order.
  - Mitigation: keep mutual-exclusion tests that assert no side effects before error.
- Risk: Extracted per-account opts accidentally drops command options.
  - Mitigation: keep batch orchestration test that asserts `size` survives and account/mall/allAccounts/auth path are shaped correctly.
- Risk: New helper exports become unnecessary public API.
  - Mitigation: keep helpers non-exported unless tests need public pure helpers; prefer testing through `withCommand()` behavior.
- Risk: Same-file helper extraction gives less visible architecture improvement.
  - Mitigation: accept this trade-off for the first slice; evaluate sibling module only after green tests.

## Rollback

Rollback is simple: inline the helpers back into their original call sites and rerun the same validation commands.
