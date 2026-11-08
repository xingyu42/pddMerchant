# Dependency Flow Contract

## 1. Scope / Trigger

适用于任何修改 import、移动函数、抽公共模块、新增命令、复用 adapter/service/infra 能力的工作。

## 2. Signatures

项目主路径与职责：

```text
bin/pdd.js               CLI entry：signal/fatal handlers、global options、wireAction、commander 用法错误 envelope
src/commands/            命令 handler：多为 withCommand() 薄封装；init/login/account/config 直接 emit
src/commands/registry/   domain registrar：register(program, wireAction)
src/commands/runner/     withCommand internals；_runner.js 是 facade
src/commands/option-parsers.js  commander 解析期校验（integerArg、goodsIdListArg、withReportDays）
src/daemon/              常驻控制台 HTTP 服务；src/console/ 是其静态前端
src/services/            领域编排：orders、goods(-write/-cost/-profit/-traffic/-receipt/-publish)、promo、diagnose、
                         经营报表（operating-report、traffic、reviews、customer-service、experience）、
                         auth / merchant-session / password-relogin、daemon / patrol / console-*
src/services/views/      输出投影：白名单、单位换算、中文标签、headline；报表声明
src/adapter/             Patchright 浏览器、endpoint 传输（client → interpreter）、auth、mall、goods-publish、takeover
src/adapter/fixtures/    fixture provider；core.js 拥有单一 fixture cache
src/infra/               envelope、errors、logger、config、paths、timeouts、abort、units/metrics、SQLite 存储与租约
```

允许的依赖方向：

```text
commands -> services -> adapter -> infra
```

## 3. Contracts

- `bin/pdd.js` MAY import command registrars、`commands/runtime-options.js`、infra helpers，以及 `adapter/browser.js` 的 `closeAllBrowsers`（信号关闭）。
- `src/commands/**` MAY import `src/services/**`、runner facade、infra types/helpers。
- `src/commands/runner/**`、`commands/doctor.js`、`commands/login.js` MAY import `src/adapter/**`：它们拥有浏览器、鉴权、店铺与 fixture 生命周期；其他 handler 经 services 访问 adapter。
- `src/commands/daemon.js` MAY import `src/daemon/run.js`；`src/daemon/**` MAY import `src/services/**` 与 infra，不直接 import adapter。
- `src/services/views/**` MAY import infra（units、metrics）与 `services/operating-report.js`，不 import adapter。
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

- Good：新命令只新增 `src/commands/<domain>/...` handler、更新 `src/commands/registry/<domain>.js`（选项用 `option-parsers.js` 解析期校验），领域逻辑进入 `src/services/<domain>.js`，输出投影进入 `src/services/views/<domain>.js`，并在 `test/contract/data-contract-v2.test.js` 覆盖新命令。
- Base：service 调用 `runEndpoint()`，再返回稳定领域结构。
- Bad：adapter 为了复用业务判断 import service；应把通用判断下沉到 infra，或让 service 调 adapter 后处理。

## 6. Tests Required

- 修改 import/layer 边界：人工检查 import 方向（原 `test/layering-guard.unit.test.js` 已在 `cc0cb1c` 删除，分层目前仅靠 review 约束（不要重建该测试，除非另有任务））。
- 修改共享契约：运行受影响 domain 的 unit / contract / e2e 测试。
- 修改 runner 或 envelope：运行 `npm test`。

## 7. Wrong vs Correct

### Wrong

```js
// src/adapter/endpoints/goods.js
import { toGoodsView } from '../../services/views/goods.js'; // adapter 反向依赖 service/view
```

### Correct

```js
// src/services/goods-receipt.js：service 调 adapter，再交给 view 投影
import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_PRICE_LIST } from '../adapter/endpoints/goods-price.js';
import { toGoodsReceiptView } from './views/goods-receipt.js';

const result = await runEndpoint(ctx.page, GOODS_PRICE_LIST, params, ctx);
return { data: toGoodsReceiptView(result.goods, viewOptions) };
```
