# Spec：运行时与测试接缝收敛（双组合根与 Ports & Adapters）

Status: ready-for-agent

来源：2026-11-24 架构深模块审查与 Design It Twice 评审（协同规格群实施拓扑：T0(P0-2 前置表征测试) → T1/T2(P0-1a/P0-1b) → T3(P1-4) → T4(P1-3)，其中 P0-2 主体在 T2+T0 完成后可与 T3/T4 并行 → T5(P2-5)）。

## Problem Statement

当前代码中 `isMockEnabled()` 环境开关判断散落在 21 个生产文件（31 处调用行），贯穿命令入口、命令执行器、领域服务与适配器四层，导致真实运行逻辑与测试模拟分支纠缠在一起，出现商品发布在业务层提前短路跳过纯计算校验、鉴权夹具为取用商家存储层的任务守卫 `assertAuthTask` 被迫在运行期动态导入（根因在于 `merchant-auth-storage → merchant-auth → browser → mock-dispatcher → fixtures/auth` 形成环形依赖）等结构摩擦。

与此同时，端点客户端、限流令牌桶、按端点冷却计数、夹具文件缓存、活跃浏览器注册表、运行时浏览器配置映射与已验证候选凭证集合均以模块级全局单例持有可变状态，迫使系统额外暴露测试复位后门；既有 43 处（16 个文件）`runEndpoint` 调用在未注入 `ctx.client` 时仍会静默回落到全局共享客户端；单元测试套件则同时依赖全局测试环境变量注入（`PDD_TEST_ADAPTER=fixture`）与 `src` 级 33 处跨层模块劫持（含 12 处端点运行入口劫持），令测试脆弱绑定内部模块路径并阻碍安全并发。

## Solution

建立遵循 ADR-0003 的双 Composition Root（命令运行时组合根 `composeCommandRuntime` 与守护进程运行时组合根 `composeDaemonRuntime`），将白名单内的运行时、适配器与测试环境变量一次性收口至顶层入口并冻结完整签名。在确实存在至少两套真实适配器的外部接缝处冻结最小端口契约（`EndpointPort`、`BrowserRuntimePort`、`MallPort`、最小 3 方法 `AuthPort`、`DaemonProcessPort` 与局部接缝 `OutputSink` / `clock`），并将限流、冷却、缓存、浏览器追踪与 `assertAuthTask` / `CandidateSeal` 全部转化为无环、按运行时实例持有的状态（不为尚未落地的 P0-2 / P1-4 预留未消费槽位，确保通过 `knip` 静态检查）。

对既有高频调用方保持平滑演进：将 `EndpointPort` 挂载在 `ctx.client`（兼容测试桩 `{ execute }`）并保留 `ctx.page` 作为透传至 `EndpointPort` 的不透明令牌，`runEndpoint` 收窄为无状态透传封装（消除全局单例回落）；测试侧先迁移操作环境变量的单测至组合根 `overrides`/`env` 再撤除全局夹具环境默认注入，统一转向穿过同一共享传输管道与归一化逻辑的默认 `raw` 上游响应测试接缝。

## User Stories

1. 作为系统维护者，我希望仅将 `PDD_TEST_*`、`PDD_SOURCE_PROXY_*`、`PDD_SCRAPE_SIMULATE`、`PDD_IMAGE_TRANSFORM` 与 `PDD_DEBUG_RAW` 等运行时/适配器/测试白名单环境变量收口在双组合根入口解析一次（实现组合根以外零白名单环境变量直读与 P0-1 自辖模块零 `isMockEnabled()`），分属下游 P0-2 / P1-3 / P1-4 的 7 个既有调用文件先在 P0-1 内机械改读注入的 `runtime.mode === 'fixture'`、留待归属 Spec 删除分支后再彻底移除 `isMockEnabled` 导出，同时保持 `PDD_DB_PATH`、输出颜色开关与 `readEnvLayer` 配置合并层现状。
2. 作为系统维护者，我希望命令行入口、普通命令、诊断与登录使用 `composeCommandRuntime`，而常驻控制台守护进程专享 `composeDaemonRuntime`，以便从结构上兑现 ADR-0003 隔离约束，并在命令组合根显式保留所需的只读 `daemonIsRunning` 告警探测（`daemon_not_running`）的同时对守护进程控制逻辑保持零依赖。
3. 作为运维与安全审计者，我希望 Live 模式下的 `composeDaemonRuntime` 在结构上省略测试辅助路由并忽略守护与巡检测试时序覆盖参数，以便生产进程零误启测试后门风险。
4. 作为平台运行时的消费者，我希望按选定模式动态装配 Live Bundle 与 Fixture Bundle，以便 Live 进程跳过夹具模块加载，且 Fixture 进程零加载 Patchright 浏览器引擎。
5. 作为领域服务调用方，我希望所有端点请求继续走统一校验、限速、冷却、HTTP 429 指数退避、响应解释与归一化管道，以便 Live 与 Fixture 模式下输出语义与错误码完全一致。
6. 作为端点调用方，我希望 `EndpointClient` 只在最末端暴露单一 `EndpointTransportPort` 接缝，以便限流、冷却与业务错误解释逻辑获得最大局部性（Locality）。
7. 作为现有 43 处（16 个文件）`runEndpoint` 调用方的维护者，我希望 `EndpointPort` 明确挂载于 `ctx.client`（兼容 `{ execute }`），`ctx.page` 作为传回 `EndpointPort` 的不透明令牌继续透传，且 `runEndpoint` 保留无状态转发封装并在缺失客户端时直接抛出 `E_CONFIG_INVALID` 杜绝全局单例回落。
8. 作为批量账号命令（`--all-accounts`）的使用者，我希望批处理通过 `scopeRuntime` 共享父级限流令牌桶与按端点冷却表，同时为每个账号隔离取消信号、截止时间与浏览器会话，以便完整保留跨账号限流冷却归因（`cooldown_inherited_from`）。
9. 作为并行测试的作者，我希望每个运行时实例独立持有自己的限流器、冷却表、夹具缓存、活跃浏览器集合与候选签章工具 `CandidateSeal`，以便测试用例零串扰并发且无需调用全局缓存或限流复位后门。
10. 作为浏览器运行时的维护者，我希望 `BrowserRuntimePort` 在 runner、鉴权/店铺/守护进程适配器与新建端口层交付不透明 `BrowserSession` 句柄并封装 ADR-0002 规则，同时由组合根向 CLI 顶层信号及异常处理器注册 `closeAll` 清理钩子，以便既兼容现有服务的 `ctx.page` 透传，又确保 `Ctrl+C` 后零孤儿浏览器残留。
11. 作为认证安全与架构维护者，我希望任务守卫 `assertAuthTask` 与实例级 `CandidateSeal` 各自下沉为 `infra` 无环纯内存叶模块，以便打断 `merchant-auth-storage → merchant-auth → browser → mock-dispatcher → fixtures/auth` 环路并移除运行期动态导入，同时切断商家核验到浏览器启动器及登录态存储到 mock 分发器的静态导入边以解除 P1-4 前置阻塞。
12. 作为认证流程维护者，我希望 `AuthPort` 收窄至最小方法集并交付 `authoritative` 布尔语义，区分真实在线核验后写入本地 SQLite 核验记录与非权威夹具校验，而将 `checkFixtureMerchantSession` 与 `reloginForFixture` 分叉的删除统一归口至 P1-4 落地。
13. 作为测试开发者，我希望单元测试通过默认工作在 `raw` 上游响应层的测试辅助注入内存 `EndpointTransportPort`，以便覆盖真实的 `page-api` 校验、429 重试、`interpretResponse` 与 `spec.normalize` 契约，并彻底移除端点模块劫持。
14. 作为命令与守护进程测试作者，我希望通过双组合根的 `overrides` 参数及内存 `streams` / `clock` 注入可控适配器，以便无需劫持浏览器、输出模块或子进程模块即可完成全链路集成验证。
15. 作为测试基础设施维护者，我希望先将 26 个操控测试环境变量的非 E2E 测试文件（含 17 个切换 `PDD_TEST_ADAPTER` 的测例）迁至组合根 `overrides`/`env` 注入，随后撤除全局测试初始化中的 `PDD_TEST_ADAPTER=fixture` 默认注入，同时继续保留逐用例临时 SQLite、`NO_COLOR=1` 与离线浏览器/网络拦截。
16. 作为长期维护者，我希望 SQLite 保持本地可替代（Local-substitutable）内部接缝而不抽象远程数据库仓储端口，以便单元测试继续运行在真实隔离临时库上验证事务、租约与 CAS 冲突。
17. 作为 AI 与脚本调用方，我希望无论是 Live 模式还是 Fixture 沙箱子进程运行，单行 JSON envelope v2 契约、退出码映射与敏感信息脱敏规则保持完全同构。
18. 作为后续并发与下游规格的开发者，我希望 P0-1 冻结 `composeCommandRuntime` / `composeDaemonRuntime` 完整入参签名、各外部端口方法表与 `OutputSink`（含已发射标记），以便 P0-2、P1-3 与 P1-4 按统一契约对接且零触发静态未使用导出告警。

## Implementation Decisions

### 双 Composition Root、签名冻结与 env 白名单（遵循 ADR-0003）

- 全系统设立两个顶层组合根并冻结接口签名：
  - `composeCommandRuntime({ mode, env, overrides, streams, clock, configOptions, runtimeConfigPolicy })` 返回 `{ mode, ports, outputSink, clock, scopeRuntime, closeAll }`；其中 `runtimeConfigPolicy` 延续现行 `'required'`（默认校验并装载运行配置）与 `'maintenance'`（跳过运行配置校验，供 P1-3 配置维护命令使用），`configOptions` 透传配置读取参数。
  - `composeDaemonRuntime({ mode, foreground, runtimeConfig, env, overrides, clock })` 专责显式启动的守护进程运行入口，承接既有 `foreground`（文件轮转日志分流）与 `runtimeConfig`（日志级别、控制台端口等配置），在 Live 模式下结构性省略 `/api/sessions/:id/fixture-complete` 辅助路由并完全忽略守护进程与巡检测试时序覆盖环境变量；后续 P1-4 落地时再由其接入 `ConsoleLoginDriverPort` 与 `consoleExtraRoutes`。
- 环境变量收口严格限定为白名单范围：`PDD_TEST_ADAPTER`、`PDD_TEST_FIXTURE_DIR`、其余 `PDD_TEST_*` 夹具测试变量、`PDD_SOURCE_PROXY_*`、`PDD_SCRAPE_SIMULATE`、`PDD_IMAGE_TRANSFORM` 与 `PDD_DEBUG_RAW` 仅在组合根入口一次性解析并冻结，达到组合根以外零白名单环境变量直读；基础设施路径层的 `PDD_DB_PATH`、终端输出层的 `NO_COLOR`/`FORCE_COLOR` 及配置模块既有的 `readEnvLayer` 合并层维持现状。
- **跨 Spec `isMockEnabled()` 平滑过渡规则**：P0-1 自辖模块彻底清除 `isMockEnabled()`；分属下游 Spec 的 7 个既有调用文件（商品发布协调器、源抓包、类目解析归属 P0-2；环境诊断与登录命令归属 P1-3；控制台登录与巡航归属 P1-4）在 P0-1 内仅机械替换为读取注入的 `runtime.mode === 'fixture'`（禁止越界实施结构性分支删除，避免并发修改冲突），待 T3/T4/P0-2 全部落地且进入 T5 前再彻底移除已废弃的 `isMockEnabled` 导出与对应分发模块（并在该清理变更中同步更新引用路径）。
- `composeCommandRuntime` 仅装配 CLI 运行所需的真实活跃端口集（`EndpointPort`、`BrowserRuntimePort`、`MallPort`、最小 `AuthPort`、`DaemonProcessPort`、`OutputSink` 与 `clock`），坚持“零未消费占位槽位”以避免 `knip` 静态检查产生孤立导出（后续由 P0-2 挂入商品发布端口、P1-4 扩展控制台路由与驱动端口）。命令组合根对控制台路由与巡检会话保持零依赖，仅保留 ADR-0003 要求的只读 `daemonIsRunning` 状态查询以维持 `daemon_not_running` 告警。
- 双组合根按模式按需加载对应的 Live Adapter Bundle 或 Fixture Adapter Bundle，确保 Live 进程跳过夹具加载、Fixture 进程零加载浏览器引擎，维持严格的 `commands -> services -> adapter -> infra` 单向依赖。

### 消除全局单例、解除环路与信号清理

- 彻底退役进程级共享端点客户端单例模块及其复位测试后门；限流令牌桶、按端点分键的冷却状态表、夹具文件解析与缓存 `FixtureStore`、活跃浏览器实例集合、按浏览器实例绑定的 `Runtime Browser Profile` 与候选材料签章器全部转为按运行时实例持有。
- 将任务守卫 `assertAuthTask` 与实例级 `CandidateSeal` 各自下沉为 `infra` 无环纯内存叶模块：既打断 `merchant-auth-storage → merchant-auth → browser → mock-dispatcher → fixtures/auth` 循环并彻底清除运行期动态导入，又切断商家凭证核验向浏览器启动器、以及登录态存储向 mock 分发器的静态导入链，彻底解除 P1-4 `relogin-policy` 零浏览器/零夹具依赖的阻塞前提。
- 通过组合根向外导出 `closeAll` 句柄并由 CLI 顶层入口挂载至进程信号（`SIGINT`/`SIGTERM`）与未捕获异常清理处理器（与批处理自身 `SIGINT` 监听协调一致），替代原本对模块级全局浏览器集合的静态引用，同步更新架构依赖流契约中的顶层例外记录，防止中断后残留孤儿浏览器。
- `--all-accounts` 批处理通过 `scopeRuntime` 从单次批处理的父级运行时派生每个账号的作用域：共享同一限流令牌桶与冷却表（保留 `cooldown_inherited_from`），隔离取消信号、截止时间、日志关联标识与浏览器会话。

### 冻结外部 Port 最小方法表与局部接缝

- **`EndpointPort`（挂载于 `ctx.client`）与内部 `EndpointTransportPort`**：`EndpointPort` 对外冻结 `call` 与 `execute` 两个方法（兼容既有测试注入的 `{ execute }` 桩），内部完整隐藏策略解析、`page-api` 校验、限速等待、冷却记账、HTTP 429 `[1000, 2000, 4000]` 退避、响应解释与 `spec.normalize`。内部仅暴露 `EndpointTransportPort.send`。现有业务与视图向适配器传入的 `ctx.page` 作为透传回 `EndpointPort` 的不透明令牌保留，runner 与新端口收口，既有 43 处 `runEndpoint` 保留无状态转发包装并在缺失注入客户端时直接抛出 `E_CONFIG_INVALID`。
- **`BrowserRuntimePort`**：对外冻结方法表为 `checkAvailability()`、`withSession(opts, fn)`、`openSession(opts)`、`deriveConsumerContext(session, opts)`（继承同一 `Runtime Browser Profile`，支撑消费端在线检查与后续 `Proxy Attempt Context`）、`reclaimOrphans()`、`closeAll()`，向外部只交付不透明 `BrowserSession` 句柄并封装 ADR-0002 启动及回退规则。
- **`MallPort`**：对外冻结 `detectCurrentMall`、`listMalls`、`switchMall`，Live 与 Fixture 复用同一进程内归一化与严格店铺标识校验。
- **`AuthPort`（最小 3 方法契约）**：对外仅冻结 `checkMerchant`（无浏览器协议级检查）、`verifyAndSeal`（浏览器会话内核验并由注入 `CandidateSeal` 签章）与 `checkConsumerOnline`（消费端 `Login Online Check`），返回值包含 `authoritative` 标志以决定是否写入**本地 SQLite 核验记录**。本地 SQLite 登录态读写/删除保留在本地可替代存储层，交互扫码登录归属 P1-3，密码自动重登与控制台登录归属 P1-4，消除端口膨胀与跨 Spec 重叠。
- **`DaemonProcessPort`**：对外冻结 `spawnDetached`、`stopByPid`、`isRunning`，收敛后台进程分离启动与信号终止。
- **`OutputSink` 与 `clock`**：`OutputSink` 对外冻结 `emit(envelope, options)`、`hasEmitted()`、`writeDebugRaw(payload)` 与 `streams: { stdout, stderr }`（满足 P1-3 两阶段单次发射守门与 PDD_DEBUG_RAW 隔离）；`clock` 对外冻结 `now()` 与支持 `AbortSignal` 的 `sleep(ms, signal)`。

### 不变量与错误模式

- 所有适配器与组合根异常一律使用 `PddCliError` 与 `ExitCodes`：`runEndpoint` 缺客户端或配置越权抛出 `E_CONFIG_INVALID`；未知传输模式或非法 `page-api` 规格/载荷抛出 `E_USAGE`；Fixture 缺失或列表路径损坏抛出 `E_FIXTURE_MISSING` / `E_FIXTURE_SHAPE`（Fixture 模式下零启动真实浏览器）；冷却激活期抛出 `E_RATE_LIMIT`；预算耗尽或中断抛出 `E_TIMEOUT` 及其对应中止错误。
- 命令主生命周期顺序在整合后保持不变：账号解析 → 截止时间装载 → 账号租约 → 浏览器会话 → `Merchant Authentication Check` → 店铺解析/切换 → 业务逻辑 → 关闭附带页 → 成功后复核 `Merchant Session Validity` 并 CAS 提交 → 收集告警 → `OutputSink` 唯一发射信封 → 释放计时器。

## Testing Decisions

好的测试应当只通过稳定公开接口验证外部可观察行为（返回视图、JSON envelope、退出码、持久化状态与冷却计数），避免绑定内部模块路径或调用全局复位后门。

1. **最高接缝：CLI 与 Daemon 子进程 Fixture E2E**
   继续通过 `PDD_TEST_ADAPTER=fixture` 配合临时沙箱 `PDD_TEST_FIXTURE_DIR` 启动命令行子进程，穿过双组合根与 Fixture Bundle，验证单行 JSON 纯净度、退出码、`--all-accounts` 跨账号冷却继承、ADR-0003 `daemon_not_running` 只读告警及守护进程流程。
2. **核心单元接缝：`EndpointClient`（`ctx.client`）+ 内存 `EndpointTransportPort`（替代 12 处端点劫持）**
   在测试辅助中提供默认工作在 `raw` 上游响应层的 `createTestCtx`，将内存原始响应挂入 `ctx.client`，确保服务测试真实穿过 `page-api` 校验、429 退避、`interpretResponse` 与 `spec.normalize`；继续兼容旧测注入的 `{ execute }` 替身。
3. **运行时集成接缝与全局环境迁移（替代 33 处模块劫持与全局环境变量默认注入）**
   - 通过 `composeCommandRuntime` 与 `composeDaemonRuntime` 的 `overrides` 参数注入内存适配器、`streams` 与 `clock`，验证生命周期时序、`hasEmitted()` 防重复发射、`closeAll` 清理hooks与 ADR-0003 禁用态；共享 Adapter Contract Test 证明 Live（接假页面）、Fixture 与内存适配器行为同构；SQLite 继续直跑隔离临时库。
   - 将既有的 26 个操作测试环境变量的非 E2E 测试文件（含 17 个通过 `vi.stubEnv` 或直改 `process.env` 切换 `PDD_TEST_ADAPTER` 的用例）逐批迁移至 `overrides` / 显式 `env` 传入；完成后从 `test/setup.js` 撤除全局 `PDD_TEST_ADAPTER=fixture` 默认注入（继续保留每用例临时 SQLite、`NO_COLOR=1` 及 `patchright`/`fetch` 硬拦截）。
4. **淘汰冗余测试与文档路径契约同步（Replace, Don't Layer）**
   - 随着全局单例、复位后门与夹具缓存清理接口下线，删除专门验证全局复位后门的过时测试。
   - 在 P0-1 移除 `rate-limiter-singleton.js` 时同步更新 `.agents/skills/pdd-adapter-auth-integration/SKILL.md` 中的对应引用；待 T3/T4/P0-2 消除 7 个下游文件分支并在 T5 前正式移除 `mock-dispatcher.js` 时同步更新该文件与 `.agents/skills/pdd-testing-troubleshooting/SKILL.md` 中的引用；同步更新 `.trellis/spec/architecture/dependency-flow.md` 第 35 行浏览器关闭钩子说明，并确保每次变更均通过 `test/contract/doc-paths.test.js` 与 `npm run check`（`knip` + 全量 Vitest）。
5. **参考先例（Prior Art）**：沿用既有传输对等测试（比较 Live 与 Fixture 在 `40002`/`54001`/分页/冷却记账上的一致性）以及隔离沙箱子进程 E2E 测试风格。

## Out of Scope

- 删除 `checkFixtureMerchantSession` 与 `reloginForFixture` 分叉的实施（已整合移交 `.scratch/auth-console-login-deepening/` 在 T3 统一收口；本规格仅交付 `AuthPort.authoritative` 与无环叶模块前提），以及 P0-2 / P1-3 / P1-4 所辖 7 个文件中的结构性模拟分支清理（P0-1 阶段仅机械替换为注入 `runtime.mode === 'fixture'`，待下游各 Spec 清理完毕且进入 T5 前再彻底移除 `isMockEnabled` 导出）。
- 商品发布协调器拆解、动态属性收敛、冷却注入点与单调用基础设施清理（归属 `.scratch/goods-publish-deepening/`）。
- 非 runner 命令信封统一、预设关闭与 `doctor` 服务化（归属 `.scratch/command-lifecycle-unification/`）。
- 控制台交互登录驱动、会话状态机与密码重登策略拆解（归属 `.scratch/auth-console-login-deepening/`）。
- 碎模块合并、跨领域订单采集归位与过时模块目录图谱清理（归属 `.scratch/shallow-module-cleanup/`）。
- 为 SQLite 抽象独立的数据库仓储外部端口，或重新引入独立背景保活进程。

## Further Notes

- 推荐将本规格内部拆分为两个连续批次推进：**P0-1a**（组合根签名与 env 白名单、`assertAuthTask` 与 `CandidateSeal` 无环叶模块、`EndpointPort` / `EndpointTransportPort`、单例退役、`OutputSink` / `clock`）→ **P0-1b**（`BrowserRuntimePort` 与 `closeAll` 清理钩子、`MallPort`、最小 3 方法 `AuthPort`、`DaemonProcessPort`、迁移 26 个测试文件与清理 `test/setup.js`）。
- 建议先行明确保留 `runEndpoint` 无状态转发兼容层，使既有 43 处业务调用无需在 P0-1 一次性切换签名，保障后续 T3/T4/P0-2 按模块平滑演进。
