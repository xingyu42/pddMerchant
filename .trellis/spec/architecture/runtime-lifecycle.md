# Runtime Lifecycle Contract

## 1. Scope / Trigger

适用于修改 `bin/pdd.js`、command registry、`withCommand()`、runner internals、fixture runtime、batch executor、signal/fatal handler、envelope finalization 的工作。

## 2. Signatures

一次 CLI 调用的标准链路：

```text
node bin/pdd.js <domain> <command> [flags]
  -> Commander parses global + command options
  -> registry/<domain>.js register(program, wireAction)
  -> wireAction binds to withCommand({name, needsAuth, needsMall, run})
  -> runner resolves auth/account/mall/timeout/abort/fixture mode
  -> service executes domain flow
  -> adapter captures endpoint/XHR or fixture payload
  -> infra finalizes envelope exactly once
  -> process exits with ExitCodes 0-7
```

Real example — `src/commands/orders/list.js`:

```js
import { withCommand } from '../_runner.js';
import { getOrderListView } from '../../services/orders.js';

export const run = withCommand({
  name: 'orders.list',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNumber = 1, size = 20, since, until } = ctx.config;
    // service 读取 ctx.mallCtx 并返回 v2 data：{ headline, items, total, mall_id }
    return getOrderListView(ctx.page, { page: pageNumber, size, since, until }, ctx);
  },
});

export default run;
```

## 3. Contracts

- Every command MUST finalize via success/error finalizer exactly once。
- `--json` mode MUST write exactly one JSON envelope line to stdout。
- Human diagnostics MAY go to stderr/logger, never pollute JSON stdout。
- Signal/fatal errors MUST map to a valid `PddCliError` / `ExitCodes` envelope where possible。
- Fixture mode MUST bypass real browser/platform calls while preserving command envelope semantics。
- `runSingleLifecycle` MUST await live execution inside its timer-owning `try/finally`; returning an unawaited promise clears the deadline too early. Clear timers and composed-signal listeners only after execution settles.
- Standalone diagnosis handlers MUST forward `{ ...ctx, mallId }`, preserving `signal`, deadline, client and page-session context instead of replacing context with `{ mallId }`.

## 4. Validation & Error Matrix

| 条件                            | expected behavior                                             |
| ------------------------------- | ------------------------------------------------------------- |
| handler throws `PddCliError`    | error envelope，exit code 来自 error mapping                  |
| handler throws unknown error    | mapped to GENERAL 或对应 infra mapping，仍输出 envelope       |
| command validates usage failure | `ExitCodes.USAGE` / code 2                                    |
| auth expired                    | `ExitCodes.AUTH` / code 3，hint 指向 login/init               |
| partial batch failure           | `ok` 根据 batch contract，exit code 7，`meta.warnings` 可增长 |
| cooperative live operation reaches deadline | one `E_TIMEOUT` envelope; dispose timer and abort listeners |

## 5. Good/Base/Bad Cases

- Good：command handler 只解析 options 并调用 service；runner 统一做 auth、mall、timeout、envelope。
- Base：fixture adapter 下服务返回同形数据，e2e 子进程只断言 envelope 和数据字段。
- Bad：handler 内部 `process.exit(1)` 或 `console.log(JSON.stringify(...))`，绕开 runner finalizer。

## 6. Tests Required

- 命令注册/flags：对应 command smoke/e2e。
- runner/finalizer：runner、output、abort、timeout 相关 unit。
- fixture path：`PDD_TEST_ADAPTER=fixture` 的 e2e 子进程测试。
- JSON purity：断言 stdout 只有 envelope，stderr 不影响 envelope 解析。
- `runner-contract.unit.test.js` MUST cover the actual live branch with mocked browser/account dependencies, timeout and success cleanup, including the `AbortSignal.any` fallback. `diagnosis-data-flow.unit.test.js` MUST assert all four diagnosis handlers preserve context.

## 7. Wrong vs Correct

### Wrong

```js
program.command('foo').action(async () => {
  const data = await runFoo();
  console.log(JSON.stringify(data));
  process.exit(0);
});
```

### Correct

```js
// src/commands/orders/detail.js
export const run = withCommand({
  name: 'orders.detail',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { sn } = ctx.config;
    if (!sn) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: 'pdd orders detail 需要 --sn <order_sn>',
        hint: '示例：pdd orders detail --sn 85',
        exitCode: ExitCodes.USAGE,
      });
    }
    const result = await getOrderDetail(ctx.page, sn, ctx);
    return { order: result.order, mall_id: ctx.mallCtx?.activeId ?? null };
  },
});
```

## 8. Scenario: Explicit Console Daemon Lifecycle (P2)

### 1. Scope / Trigger

Applies to `src/daemon/run.js`, daemon commands/services, process adapters and daemon lease shutdown. The daemon is started explicitly; ordinary commands and doctor retain their current-process authentication flow.

### 2. Signatures

```js
runDaemon({ signal, components = [createConsoleServer()], exit, foreground = true, runtimeConfig })
// -> { stopped_reason } | { status: 'already_running' }
// component.start({ signal, ownerTag, log, runtimeConfig }); component.stop();
withCommand({ needsAuth: false, needsMall: 'none', needsBrowser: false, ... })
```

`pdd daemon start|stop|status|run` uses the ordinary runner finalizer. `needsBrowser:false` with `needsAuth:false` skips browser and account resolution in both live and fixture mode. Existing commands keep the default `needsBrowser:true`.

### 3. Contracts

- `src/daemon/` is a commands-level entry point; its runtime dependencies come through services. Components start in order and stop in reverse order, including a component whose startup failed. P3 defaults to the HTTP component; tests may inject an explicit empty list. HTTP startup publishes `daemon_console_url`, and shutdown clears it only for the current owner.
- Acquire the heartbeat lease, immediately clear stale stop requests, then clean marked orphan browsers. Contention returns `already_running` with exit 0. Heartbeat every 30 seconds renews a 90-second lease, checks stop requests and purges expired console rows.
- SIGINT/SIGTERM and platform-specific SIGBREAK (Windows) or SIGHUP initiate shutdown. Daemon run owns these signals instead of the ordinary CLI signal handler. Stop components, close browsers, then atomically release the owned lease and clear its stop request; a replacement owner's request stays intact. A five-second hard deadline calls the injected `exit(1)` (production: `process.exit`).
- `start` clears a stopped instance's stale console address in a short transaction, detaches a hidden process with ignored stdio, inherits env, calls `unref()` and polls at 200ms for ten seconds. Readiness requires both a valid lease and a published console address. `stop` requests cooperative shutdown and polls at 500ms for fifteen seconds, then rechecks owner token, host and unexpired heartbeat in a short synchronous transaction before killing the pid and deleting only the matching row.
- Status fields: `headline`, `running`, `pid`, `started_at`, `heartbeat_at`, `last_patrol_at`, `console_url`, `patrol_enabled`. `_at` values use Asia/Shanghai local strings; missing values are null. Start adds `started`; stop returns `stopped`, `running` and optional `forced`; run returns `stopped_reason`.
- Fixture-only timing seams: `PDD_TEST_DAEMON_LEASE_TTL_MS` and `PDD_TEST_DAEMON_HEARTBEAT_MS` accept positive safe integers in milliseconds. `daemonTimings()` guards both with `isMockEnabled()`; invalid values fall back to 90000/30000, and live mode ignores both variables. Timing overrides flow explicitly to infra lease helpers.
- Daemon logs use `channel:'daemon'`; foreground mode tees the existing rotating file destination to stderr through the logger's writable `destination` option. Stdout stays one envelope when the command exits.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Valid lease exists at run/start | Exit 0; no second owned runtime |
| No lease appears within ten seconds | `E_DAEMON_START_TIMEOUT` |
| Heartbeat loses ownership | `stopped_reason:'lease_lost'`; stop without another heartbeat |
| Stop timeout with foreign host | `E_DAEMON_STOP_TIMEOUT`, `reason:'foreign_host'`; no kill |
| Owner changes before forced stop | `E_DAEMON_STOP_TIMEOUT`, `reason:'lease_active'`; preserve replacement |
| Kill fails other than ESRCH | `E_DAEMON_STOP_TIMEOUT`, `reason:'kill_failed'`; retain row |
| Cleanup hangs | Hard exit after five seconds; lease expires by heartbeat TTL |

### 5. Good/Base/Bad Cases

- Good: two starts return the same pid; killing the process leaves a valid heartbeat lease until TTL expiry, after which start acquires a new lease.
- Base: P2 status returns `console_url:null`; patrol configuration is visible while patrol execution remains P6.
- Bad: ordinary commands silently spawn a daemon, or old shutdown code clears a replacement owner's stop request.

### 6. Tests Required

- `test/daemon/run.test.js`: stop request, stale request clearing, heartbeat/purge, lease loss, all host signals, abort during startup, partial startup cleanup, hard exit, logger redaction and timing guard.
- `test/services/daemon.test.js`: polling deadlines, same-host force stop, foreign host, replacement owner, expired heartbeat and kill failure.
- `test/adapter/daemon-process.test.js`, `test/adapter/daemon-browser.test.js`: detached options/env and marked-process-only cleanup.
- `test/e2e/daemon.e2e.test.js`: isolated fixture DB, repeat start, status, stop, foreground envelope and process.kill followed by short-TTL takeover. `data-contract-v2.test.js` covers all four commands.
- Runner tests cover pending-action warnings in live/fixture success and error paths, no warning for needsAuth:false, and one `daemon_not_running` per single or batch envelope.

### 7. Wrong vs Correct

```js
// Wrong: pid liveness does not establish daemon ownership.
process.kill(lease.pid);
deleteLeaseUnconditionally();
// Correct: recheck ownership/host/heartbeat while holding a short sync transaction.
withDaemonLeaseOwner(ownerToken, () => forceStopOwnedLease());
```
