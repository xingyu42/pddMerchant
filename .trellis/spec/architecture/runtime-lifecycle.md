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
