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
- `needsAccount` 默认 false，仅命令显式启用时让 `needsBrowser:false + needsAuth:false` 分支解析本地 merchant 账号并填写 ctx/account meta；无账号报 E_ACCOUNT_REQUIRED / exit 2。未启用时保留既有跳过账号解析行为。
- `needsMall:'stored'` 为显式本地范围声明，runner 不启动浏览器、不探测/切换店铺、不解密登录态、不做认证/重登；service 从 config.mall 或账号 identity 确定存储范围。该能力只新增 opt-in 分支，既有命令、超时、finalizer 与 batch 行为不变。
- 本地成本命令全部 allowAllAccounts:false；goods.profit 使用原有只读认证/多账号循环。回归入口 `test/commands/goods-cost-runtime.test.js`、`test/e2e/goods-cost.e2e.test.js`，共享生命周期必须全量 npm test。

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
- `--all-accounts` combined with `--account` MUST fail with `E_USAGE` before account iteration, jitter, or envelope emit. Accounts are enumerated with `listAccounts({ kind: 'merchant' })` (every registered merchant; there is no disabled state); an empty database fails with `E_USAGE` (`No registered accounts found`).
- Single and batch commands MUST NOT launch background auth processes; merchant checks and verified persistence happen within the current command.
- Per-account execution MUST call `executeSingle()` with `emitResult: false`, `allAccounts: false`, no `mall` override, `account: undefined`, and the account-specific `accountId`.
- Inter-account jitter MUST run only between accounts, never after the last account, and MUST receive the batch abort signal.
- Ordinary non-empty batch completion MUST emit exactly once and return the emitted batch envelope.

## 10. Password Relogin Step

Full scenario (state machine, errors, lease rules) lives in [auth-mall-context.md](../adapter/auth-mall-context.md) section 9; this section covers only the runner wiring.

```js
// single-lifecycle.js
armDeadline(opts, parentSignal, startedAt) -> { signal, deadlineAt /* getter */, pause(), resume(), dispose() }
// fixture-runtime.js
appendActionWarnings(spec, runtime); // needsAuth only; pushes getAccountActionWarnings(accountId, slug)
```

- Live: inside `withMerchantAuthUpdate`, `assertAuthValid` delegates verification, check recording and rejected-only recovery to `services/merchant-session.js` (`checkMerchantSession`). It returns an optional replacement `{ context, page }`; the runner closes the old context and continues on the replacement. `runtime.verifiedMallId` comes from the verified identity or committed `transaction.state`. `goto(PDD_HOME)`, `createPageSession` and `persistAuthStateAfterSuccess` all use the new context.
- `checkMerchantSession(context, { tx, task, mode, runtime, browser })` has explicit modes: `command` records rejected/indeterminate checks and recovers only rejected sessions; `patrol` retains the same recovery with its post-verification task/deadline check; `login` records checks and returns rejection for human authorization. Login preparation uses `login`. Read-only checks bypass it: doctor calls `verifyStoredMerchant` without a lease, recording or recovery, and successful command persistence calls `verifyMerchantContext` on fresh material before its own commit/warning policy.
- `pause()` clears the deadline timer and stores the remaining time (throws the timeout error if none is left); `resume()` re-arms with the remaining time and updates `deadlineAt`. Both are no-ops without `--timeout`. Relogin time therefore does not consume the command budget, and SIGINT still aborts.
- Fixture: runner and patrol delegate their browser-free preflight to `checkFixtureMerchantSession(accountId, runtime, { tx })`. It retains the existing no-record policy and treats the session as invalid when `PDD_TEST_AUTH_INVALID=1` and the account state has no `PDD_FIXTURE_RELOGIN=1` cookie; it calls `reloginForFixture` before continuing. `PDD_TEST_AUTH_INDETERMINATE=1` still fails first with `E_AUTH_CHECK_INDETERMINATE`. Successful recovery now uses a branded verified candidate and the shared atomic commit handle; complete fixture/browser orchestration unification remains deferred to preserve persisted transitions.
- `appendActionWarnings` runs on both success and error paths in live and fixture mode, before the envelope is built.
- `needsAuth:false` commands never call relogin and never append action warnings.
- 当前账号有 open 待办且 daemon 租约无效时，`appendActionWarnings` 同时附 `{ code:'daemon_not_running' }`；单次 envelope 与 batch 汇总均按该 code 去重。daemon 状态由 `services/daemon.js` 读取，普通命令保持显式后台启动策略。详见 `architecture/runtime-lifecycle.md` 第 8 节。
- Batch mode needs no change: `runAccountLoop` awaits `executeSingle` per account, so relogins run one at a time.
- Tests: `test/commands/runner-deadline.test.js` (pause/resume), `test/adapter/merchant-auth-lifecycle.test.js` (context swap after relogin), `test/e2e/password-relogin.e2e.test.js`.
