# Design: Batch orchestration invariants

## Context

The command runtime line now has core `executeSingle()` runner contracts frozen by `test/runner-contract.unit.test.js`. The next risk is the batch orchestration path in `src/commands/runner/batch-executor.js`.

`batch-executor.js` is allowed to coordinate both `withCommand()` routing and batch execution because it is the only runner module that should touch both the single lifecycle and batch-only concerns. The goal of this slice is not to split the file yet. The goal is to make the existing orchestration behavior executable and safe to refactor later.

## Runtime Flow Under Test

```text
withCommand({ name, needsAuth, allowAllAccounts, run })
  -> executeCommand(opts)
     -> if opts.allAccounts && !allowAllAccounts: throw E_USAGE before batch
     -> if opts.allAccounts && needsAuth: executeBatch(spec, opts)
     -> else: executeSingle(spec, opts, { emitResult:true, skipDaemonStart:false })

executeBatch(spec, opts)
  -> validate --account / --auth-state-path / PDD_AUTH_STATE_PATH exclusions
  -> add unused_flag_mall_in_batch when opts.mall exists
  -> list enabled accounts
  -> if enabled list empty: emit OK empty batch envelope
  -> ensureDaemonRunning() once
  -> install SIGINT abort listener
  -> run accounts sequentially through executeSingle(... emitResult:false ...)
  -> apply cooldown attribution
  -> aggregate per-account warnings
  -> abortable jitter between accounts only
  -> buildBatchEnvelope + emit once
```

## Chosen Slice

Add batch orchestration invariant tests only. Do not change runtime behavior in this slice.

## Contracts To Freeze

- Batch routing: `opts.allAccounts && needsAuth` routes through batch; `needsAuth:false` remains single-command behavior.
- Mutual exclusion: `--account`, `--auth-state-path`, and `PDD_AUTH_STATE_PATH` fail before account iteration and before daemon start.
- Empty enabled accounts: returns/emits OK empty batch envelope without daemon start, per-account execution, or jitter.
- Daemon: `ensureDaemonRunning()` is called once per non-empty batch, not once per account.
- Per-account options: each account gets `allAccounts:false`, `mall:undefined`, account-specific `authStatePath`, and a per-account correlation id suffix.
- Jitter: called between accounts, never after last account, and receives the batch abort signal.
- Emit: batch emits exactly once at the end for ordinary non-empty batch completion.

## Compatibility

- No CLI output shape changes.
- No envelope or exit-code changes.
- No new exports are required.
- No new runtime dependency.
- Tests should mock account registry, daemon launcher, `executeSingle()`, `abortableSleep()`, and `emit()` to avoid real browser, daemon, account files, and real sleep.

## OpenSpec Need

No OpenSpec proposal is required for this slice because it adds tests for existing behavior and should not change runtime semantics.

If implementation reveals a necessary behavior change, stop and update this design; if the behavior change affects public batch semantics, create/update OpenSpec before coding it.

## Risks And Mitigations

- Risk: Tests overfit private implementation details.
  - Mitigation: Assert observable orchestration effects and public module interactions already described by OpenSpec, such as daemon-once, emit-once, per-account option shaping, and mutual exclusions.
- Risk: Batch tests accidentally sleep.
  - Mitigation: Mock `abortableSleep()`.
- Risk: Existing tests already print batch envelopes to stdout.
  - Mitigation: For new tests, mock `emit()` so the contract is explicit and quieter.
- Risk: Mocking module imports incorrectly due ESM hoisting.
  - Mitigation: Follow existing Vitest `vi.hoisted()` / dynamic import pattern used by runner tests.

## Rollback

Rollback is test-only: remove the new batch orchestration test file or new cases. Runtime files should remain untouched.
