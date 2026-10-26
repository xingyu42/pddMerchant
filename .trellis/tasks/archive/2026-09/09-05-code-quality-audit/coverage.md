# 审查覆盖与边界

## 基线与安全边界

- HEAD：`03c53f7b3ef3532409558d92d43c530a7970a9bb`，分支 main。
- 原有 WIP：已暂存 `.gitattributes`；修改中的 `src/infra/daemon-launcher.js`、`src/infra/paths.js`；未跟踪的 VMProtect 交接文件。未读取交接文件内容，未改动这些文件。
- 审查采用当前工作区而不是只看最近 diff；报告不是“该提交引入的回归”清单。
- 未读取 `data/`、日志、真实登录态、注册表或本地秘密配置。配置只读提交的 example、package、Vitest、Knip 定义。
- 任务激活成功，状态 in_progress；工具提示会话身份不可用，未持久化 active-task 指针。使用 inline 工作流允许空子代理实现清单；没有启动 implement/check 子代理。

## 全项目摸底

目录清点：`src/` 134 文件，其中 adapter 46、commands 45、infra 22、services 21；`bin/` 2 文件；`test/` 195 文件（含 fixtures/helper，不等于测试文件数）；`docs/` 6 文件。

| 区域 | 摸底内容 | 本轮深度 |
| --- | --- | --- |
| bin / command registry / runner | 命令入口、配置注入、单次执行、诊断/行动命令接线 | runner 与相关调用链深查；其他命令仅结构和风险检索 |
| infra | 路径、配置、进程控制、错误/取消、输出和日志边界 | daemon 启停深查；其他为定向参照和检索 |
| adapter | auth、endpoint、mall、商品发布职责与风险线索 | auth-refresher 深查；endpoint 与 pageSession 为必要上下游 |
| services | 订单/商品/推广、诊断/分层/行动、发布与辅助服务 | 诊断及建议链深查；发布链仅摸底 |
| test | 测试结构、全局 setup、相关异常覆盖、隔离方式 | 8 个现有文件执行；4 个任务内复现文件执行 |
| config / scripts | package scripts、vitest、knip、config example | 阅读配置；没有安装依赖或执行外部工具下载 |
| docs / skills / .trellis | README、相关项目技能、架构/测试/端点/auth 规格 | 作为预期契约；历史文档、工具生成物不视作运行时源码 |

摸底是目录和职责覆盖加定向搜索，不是对每个文件逐行完成审查。未发现问题的区域不能因此标记“无缺陷”。

## 三个重点模块

### 1. 命令执行生命周期

主代理核对 `src/commands/runner/single-lifecycle.js`、`fixture-runtime.js`、`envelope-finalizer.js`、`_runner.js`，并追查 CLI timeout 映射、abort 工具、endpoint-client/endpoint-attempt 和独立诊断命令的 ctx 转发。

选择原因：总超时和 ctx 是跨命令共享契约，错误传播面大；有明确 promise/finally 时序证据。结果 F1、F9。

边界：未穷尽 batch-executor 的所有中断/账号组合，未运行真实浏览器。

### 2. 后台登录刷新与进程生命周期

主代理核对 `auth-refresher.js`、商家 `auth-state.js` 校验分支、`daemon-launcher.js`、`commands/daemon.js`、`bin/pdd-daemon.js` 的调度与状态写入，并对照当前 auth 规格与旧测试。

选择原因：三处成功确认存在独立缺口，且涉及登录态写回和后台是否真实存活。结果 F2、F3、F4。

边界：没有验证真实服务器续期、Windows 进程脱离终端行为、PID 复用概率、账号自然过期或真实权限失败。模拟只证明代码在这些条件下如何响应。

### 3. 诊断、商品分层与行动建议

主代理核对 `diagnose/collectors.js`、goods/orders collector、inventory-health、diagnose index、goods-segmentation、promo-roi、action-plan、action/plan 与 goods/segment 的命令编排。向上游扩展读取 goods/promo 响应归一化和 endpoint success/normalize 顺序。

选择原因：多个独立线索都指向不完整数据成为完整结论，并流入清仓/预算建议；同时存在可证明的重复规则和重复采集。结果 F5、F6、F7、F8、M1、M2。

边界：没有验证全部评分系数的产品合理性，也没有校验真实上游金额单位或账号数据。清仓/预算输出是建议，不是本轮发现自动写操作。

## 未纳入正式结论的线索

以下仅供下一轮定位，不计入 9 项功能问题或 2 项维护负担：

- 商品发布保存成功码：探查线索指向 `adapter/goods-publish/form-filler.js:1061` 与 `adapter/endpoints/goods-publish.js:15` 的兼容分支不同，尚未由主代理完成保存接口实际返回形状及上下游复核。
- 消费者登录校验：`adapter/auth-state.js:159` 只看最终 URL，不检查首页 HTTP 状态；代码分支已抽查，但匿名首页是否能证明登录还需要独立契约研究，本轮不延伸消费者认证审查。
- 店铺选择：探查指出 `adapter/mall-reader.js:237` 附近可能回退到列表第一项；现有测试接受此行为，未完成当前店铺标识的全链路核验。
- 本地 daemon 命令依赖全量配置：入口 runtimeConfigPolicy 可能阻止损坏配置下 stop/status；尚未完成配置失败路径复现。
- `form-filler.js`（1453 行）、`source-scraper.js`（621 行）、`services/goods-publish.js`（557 行）是下一轮维护审查候选。长度仅为定位信号，未单凭长度判定缺陷。

## 检查覆盖的限制

- 当前层级守卫 3 用例通过；它主要检查 adapter 向上依赖和 runner 回引 facade，不等于完整依赖图证明。补充对 infra 静态 import/export 上行目标的搜索未命中，仍不宣称覆盖所有动态引用。
- 现有 107 个定向测试通过与本次发现不矛盾：多数问题位于未覆盖的异常分支，部分旧测试锁定了宽松成功判定。
- 任务内 13 个复现是行为观察，不是新增生产质量门禁。使用独立配置，不加入默认 `npm test`。
- 未运行全量测试、live/e2e、Knip 或 lint；没有把未运行的检查记为通过。
- 探查子代理只做定位；正式结论由主代理逐项核对代码和本地复现，没有委派最终审查或代码修改。
