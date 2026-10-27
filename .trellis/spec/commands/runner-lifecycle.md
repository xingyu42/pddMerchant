# Runner Lifecycle Contract

## 1. Scope / Trigger

适用于修改 `src/commands/_runner.js`、`src/commands/runner/**`、single lifecycle、batch executor、fixture runtime、envelope finalizer、timeout/abort/auth/account/mall wiring。

## 2. Signatures

Runner 相关模块职责：

```text
src/commands/_runner.js                    facade; keep import surface stable
src/commands/runner/envelope-finalizer.js  success/error envelope emission
src/commands/runner/fixture-runtime.js     fixture adapter command path
src/commands/runner/single-lifecycle.js    one command execution lifecycle
src/commands/runner/batch-executor.js      batch command execution and partial handling
```

`withCommand(commandName, options, action)` 的 action 形态：

```js
async function action(ctx) {
  return serviceCall(ctx, options);
}
```

## 3. Contracts

- Runner owns exactly-once envelope finalization。
- Runner owns auth state resolution, account context, mall switching, timeout, abort signal, fixture adapter branching。
- `ctx` is the boundary object for command/service code; do not bypass it with global state unless infra owns that state。
- Batch mode MUST preserve per-item errors and use exit code 7 for partial outcomes。
- Fixture runtime MUST emulate lifecycle enough that command tests exercise the same envelope/error behavior。

## 4. Validation & Error Matrix

| 条件                            | Runner 行为                                               |
| ------------------------------- | --------------------------------------------------------- |
| action resolves data            | success envelope, exit code 0                             |
| action throws `PddCliError`     | error envelope with mapped exit code                      |
| action is aborted by timeout    | timeout/network/general mapped error; no second envelope  |
| batch has mixed success/failure | partial envelope, exit code 7, warnings/details preserved |
| fixture adapter enabled         | no browser launch; fixture dispatcher supplies payload    |

## 5. Good/Base/Bad Cases

- Good：services receive `ctx` and use its logger/auth/mall context rather than reading process globals repeatedly。
- Base：single command flow has one action and one finalizer path。
- Bad：batch executor prints progress to stdout in `--json` mode or calls process exit directly。

## 6. Tests Required

- Runner finalizer unit tests for success/error/unknown error/partial。
- Abort and timeout tests for no double emission。
- Fixture runtime tests for bypassing real Playwright。
- E2E subprocess tests for actual exit code and stdout envelope。

## 7. Wrong vs Correct

### Wrong

```js
try {
  await action(ctx);
  finalizeSuccess(...);
} catch (error) {
  finalizeError(error);
  throw error;
}
```

### Correct

```js
try {
  const data = await action(ctx);
  return finalizeSuccess(commandName, data, meta);
} catch (error) {
  return finalizeError(commandName, error, meta);
}
```

## 8. Executable Runner Invariants

These invariants are covered by runner contract tests and should stay stable during command runtime refactors:

- `executeSingle(..., { emitResult: true })` MUST emit exactly once on both success and error paths, and the emitted envelope MUST equal the returned envelope.
- `executeSingle(..., { emitResult: false })` MUST return the same envelope shape without calling `emit()`.
- Runtime warnings collected by the runner MUST merge with command result warnings exactly once, preserving runner warnings before result warnings.
- When `timeoutMs` is supplied, command `ctx` MUST include a non-aborted `signal` and numeric `deadlineAt` derived from the command deadline.
- These assertions are observable runner contracts; tests should avoid depending on private call order unless the order is itself the documented contract.

## 9. Batch Orchestration Invariants

These invariants are covered by batch orchestration tests and should remain stable before any `batch-executor.js` policy extraction:

- `withCommand({ needsAuth: true })` with `opts.allAccounts === true` MUST route through batch execution; `needsAuth: false` commands MUST remain on the single-command path.
- `--all-accounts` combined with `--account` MUST fail with `E_USAGE` before account iteration, jitter, or envelope emit. Accounts are enumerated with `listAccounts({ kind: 'merchant', includeDisabled: true })`; an empty database fails with `E_USAGE` (`No registered accounts found`).
- When all accounts in the database are disabled, batch execution MUST emit and return an OK empty batch envelope and skip per-account execution and jitter.
- Single and batch commands MUST NOT launch background auth processes; merchant checks and verified persistence happen within the current command.
- Per-account execution MUST call `executeSingle()` with `emitResult: false`, `allAccounts: false`, no `mall` override, `account: undefined`, and the account-specific `accountId`.
- Inter-account jitter MUST run only between accounts, never after the last account, and MUST receive the batch abort signal.
- Ordinary non-empty batch completion MUST emit exactly once and return the emitted batch envelope.
