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
runDaemon({ signal, components = defaultComponents(), exit, foreground = true, runtimeConfig })
// defaultComponents(): patrol = createPatrol({ persist: savePatrolEnabled }); [createConsoleServer({ patrol }), patrol]
// -> { stopped_reason } | { status: 'already_running' }
// component.start({ signal, ownerTag, log, runtimeConfig }); component.stop();
withCommand({ needsAuth: false, needsMall: 'none', needsBrowser: false, ... })
```

`pdd daemon start|stop|restart|status|run` uses the ordinary runner finalizer. `needsBrowser:false` with `needsAuth:false` skips browser and account resolution in both live and fixture mode. Existing commands keep the default `needsBrowser:true`. `restart` is `stop` (cooperative, 15 s then same-host force kill) followed by `start`; data is the start view plus `restarted` (whether a daemon was stopped), optional `forced`, headline `daemon 已重启` / `daemon 已启动`. The daemon loads code at startup while console static files are read from disk per request, so code updates need a restart.

### 3. Contracts

- `src/daemon/` is a commands-level entry point; its runtime dependencies come through services. Components start in order and stop in reverse order, including a component whose startup failed. P3 defaults to the HTTP component; tests may inject an explicit empty list. HTTP startup publishes `daemon_console_url`, and shutdown clears it only for the current owner.
- Acquire the heartbeat lease, immediately clear stale stop requests, then clean marked orphan browsers. Contention returns `already_running` with exit 0. Heartbeat every 30 seconds renews a 90-second lease, checks stop requests and purges expired console rows. Stop requests are additionally polled every second (capped by the heartbeat interval) so a cooperative stop finishes inside the 15-second stop budget; a pending request runs a full heartbeat first, so a replaced owner still ends with `lease_lost`.
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
- Base: status returns `console_url` only while the lease is valid (null otherwise); `patrol_enabled` reflects configuration even when no round has run.
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

## 9. Scenario: Opt-In Merchant Patrol (P6)

### 1. Scope / Trigger

Applies to `services/patrol.js`, daemon component wiring, shared deadlines and fixture patrol timing. Patrol is explicitly enabled; each account first runs a browser-free checkLogin probe and only falls back to the ordinary command's browser auth path when relogin may be needed.

### 2. Signatures

```js
createPatrol({ random = Math.random, clock = { now, sleep }, persist }) // -> { start(context), stop(), setEnabled(enabled), isEnabled() }
runPatrolRound({ signal, ownerTag, log, runtimeConfig }, clock)
armDeadline(opts, parentSignal, startedAt) // infra/abort.js; single-lifecycle.js keeps its re-export
withMerchantAuthUpdate(accountId, callback, { timeoutMs: 0, signal, deadlineAt })
reloginForFixture(accountId, runtime, { tx }) // optional existing account transaction; no nested lease
```

### 3. Contracts

- Start only when `runtimeConfig.patrolEnabled === true`. `setEnabled(enabled)` (console switch) serialises changes: it awaits `persist(enabled)` first and only then starts or aborts the loop, so a failed write leaves the running state untouched; after `stop()` it never restarts. Aborting mid-round follows the stop rules below. Wait a jittered interval before the first round and after each completed round; no overlapping rounds. Delay is `round(patrolIntervalMs * (0.8 + random() * 0.4))`.
- Enumerate enabled merchant accounts in ID order and check sequentially. Acquire each account lease once with `timeoutMs:0`; contention logs info `{ account: slug, code:'patrol_account_busy' }` and skips. Re-check disabled status after acquiring the lease. Account failures log only slug and a fixed error code, then continue.
- Live flow, stage 1 (no browser): unless `tx.state.merchant_auth.last_check.verdict === 'rejected'`, `selectCheckCookiesFromState(tx.state)` -> `probeCheckLogin(cookies, { signal, deadlineAt })`. `verified` ends the account with no browser and no write; `indeterminate` -> `recordMerchantCheck` + `assertMerchantVerified` (fixed-code `E_AUTH_CHECK_INDETERMINATE` warning, no browser, no relogin); `rejected` -> `recordMerchantCheck` then stage 2. `E_AUTH_CANDIDATE_INVALID` from cookie selection/header building (e.g. missing PASS_ID) and a known-rejected state also go to stage 2.
- Live flow, stage 2 (browser): `withBrowser({ storageState:tx.state, ownerTag })` -> `verifyStoredMerchant` with the bound account identity (a just-recorded rejection short-circuits as `known_rejected`, so rejected materials are not re-sent) -> `recordMerchantCheck` for non-verified results -> `reloginInCommand` for rejected results; other results use `assertMerchantVerified`. No homepage navigation or business endpoints.
- A verified check alone retains the saved snapshot: ordinary commands only perform their final snapshot commit after a successful business result. Password relogin keeps its existing verified candidate commit. Rejected/indeterminate checks retain the existing check-recording rules.
- Each account has a 120s deadline. Relogin pauses/resumes it and retains its independent 90s budget. Daemon cancellation remains active throughout; abort closes and awaits the current account browser, releases the lease and skips remaining accounts. An interrupted round leaves the previous completion timestamp intact.
- Complete rounds (including no accounts or all skipped/failed accounts) write ISO `daemon_last_patrol_at`. Status and `/healthz` expose its existing local-time projection.
- Fixture uses `mockIsAuthValid` / `fixtureSessionRecovered` and `reloginForFixture` inside the held lease, with no browser. `PDD_TEST_PATROL_INTERVAL_MS` accepts a positive safe integer only in fixture mode; invalid values and live mode use `runtimeConfig.patrolIntervalMs`. It changes timing only; default-disabled patrol stays off.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Disabled/default config | No timer, round, browser or timestamp write |
| Busy account lease | Immediate skip; info with slug and fixed code |
| Rejected auth | Existing breaker, throttle and awaiting-human decisions |
| Healthy session (probe verified) | No browser launch, no state write |
| Indeterminate auth | Record check in live mode; fixed-code warning; no browser, no password attempt |
| Known rejected / PASS_ID missing | Skip or abandon the request probe; browser verify + relogin |
| Account failure / account timeout | Fixed-code warning; next account still runs |
| Daemon stop during account | Abort, await browser cleanup, release lease; no completed-round timestamp |
| Round-level storage failure | `E_PATROL_ROUND_FAILED` warning; retry after the next interval |

### 5. Good/Base/Bad Cases

- Good: challenge creates one human action; the next round does not submit another password attempt.
- Base: an occupied account is skipped while a later enabled merchant is checked.
- Bad: patrol commits a merely checked snapshot as if a business command had succeeded, or acquires a second fixture lease inside the first.
- Bad: treat a request-probe `indeterminate` as rejected and launch a browser relogin on network jitter.

### 6. Tests Required

- `test/services/patrol.test.js`: jitter limits, timing seam guards, strict opt-in, delayed first round, occupied/disabled/consumer skips, sequential request-only probes under leases (no browser on verified/indeterminate), browser relogin for probe-rejected / known-rejected / PASS_ID-missing, unchanged verified revision, check recording, fixed-code failures, cancellation/awaited cleanup, account timeout, throttle and breaker.
- `test/e2e/patrol.e2e.test.js`: offline fixture daemon, one successful password attempt across rounds, challenge -> awaiting-human/open action with no second attempt, timestamps in status/healthz, default-off with a short timing seam.
- Shared deadline/runner/auth storage tests and `npm test -- --maxWorkers=2` after changing this cross-layer flow.

### 7. Wrong vs Correct

```js
// Wrong: a nested fixture lease waits on the patrol's own account lease.
await withMerchantAuthUpdate(id, () => reloginForFixture(id, runtime));
// Correct: pass the held transaction and retain the existing relogin state machine.
await withMerchantAuthUpdate(id, (tx) => reloginForFixture(id, runtime, { tx }), { timeoutMs: 0 });
```
