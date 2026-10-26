# Dependency Flow Contract

## 1. Scope / Trigger

适用于任何修改 import、移动函数、抽公共模块、新增命令、复用 adapter/service/infra 能力的工作。

## 2. Signatures

项目主路径与职责：

```text
bin/pdd.js               CLI entry：signal/fatal handlers、global options、wireAction
src/commands/            命令 handler：withCommand() 薄封装
src/commands/registry/   domain registrar：register(program, wireAction)
src/commands/runner/     withCommand internals；_runner.js 是 facade
src/services/            领域逻辑：orders/goods/promo/diagnose/action 等
src/adapter/             Playwright、XHR/fetch、auth、mall、endpoint、rate-limit
src/adapter/fixtures/    fixture mock；core.js 拥有单一 fixture cache
src/infra/               envelope、errors、logger、paths、timeouts、abort
```

允许的依赖方向：

```text
commands -> services -> adapter -> infra
```

## 3. Contracts

- `bin/pdd.js` MAY import command registrars and infra-level fatal/signal helpers。
- `src/commands/**` MAY import `src/services/**`、runner facade、infra types/helpers。
- `src/services/**` MAY import `src/adapter/**` 与 `src/infra/**`。
- `src/adapter/**` MAY import `src/infra/**`。
- `src/infra/**` MUST NOT import `commands`、`services`、`adapter`、`bin`。
- 底层目录 MUST NOT import 上层目录；新共享逻辑应放在最低可拥有该契约的层。

## 4. Validation & Error Matrix

| 条件                                      | 结果                                               |
| ----------------------------------------- | -------------------------------------------------- |
| `src/infra/**` import `src/services/**`   | layering violation，必须重构                       |
| `src/adapter/**` import `src/services/**` | layering violation，adapter 泄露业务编排           |
| `bin/pdd.js` 出现领域算法/endpoint 解析   | 入口过胖，移入 command/service/adapter             |
| 两层都实现同一 raw payload 解析           | 契约重复，归一化放到 adapter 或 service 单一所有者 |

## 5. Good/Base/Bad Cases

- Good：新命令只新增 `src/commands/<domain>/...` handler、更新 `src/commands/registry/<domain>.js`，领域逻辑进入 `src/services/<domain>.js`。
- Base：service 调用 `runEndpoint()`，再返回稳定领域结构。
- Bad：adapter 为了复用业务判断 import service；应把通用判断下沉到 infra，或让 service 调 adapter 后处理。

## 6. Tests Required

- 修改 import/layer 边界：人工检查 import 方向（原 `test/layering-guard.unit.test.js` 已在 `cc0cb1c` 删除，分层目前仅靠 review 约束（不要重建该测试，除非另有任务））。
- 修改共享契约：运行受影响 domain 的 unit/smoke/e2e 测试。
- 修改 runner 或 envelope：运行 `npm test`，或至少覆盖 runner、output、errors、smoke 测试。

## 7. Wrong vs Correct

### Wrong

```js
// src/adapter/some-endpoint.js
import { decideGoodsStatus } from '../services/goods.js';
```

### Correct

```js
// src/services/goods.js
import { runEndpoint } from '../adapter/run-endpoint.js';

export async function decideGoodsStatus(ctx, input) {
  const payload = await runEndpoint(ctx, input);
  return normalizeGoodsStatus(payload);
}
```
