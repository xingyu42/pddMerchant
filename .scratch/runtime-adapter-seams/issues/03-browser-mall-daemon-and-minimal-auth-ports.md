# 03: `BrowserRuntimePort`、`MallPort`、`DaemonProcessPort` 与最小 `AuthPort`（含信号清理钩子）

**What to build:** 冻结并实现四套核心外部接缝及其 Live / Fixture / InMemory 适配器：`BrowserRuntimePort`（6 方法：`checkAvailability`、`withSession`、`openSession`、`deriveConsumerContext`、`reclaimOrphans`、`closeAll`，管理实例级活跃浏览器与继承同一 `Runtime Browser Profile` 的消费端上下文并封装 ADR-0002 回退规则）；`MallPort`（3 方法：`detectCurrentMall`、`listMalls`、`switchMall`，Live 与 Fixture 共用同构归一化）；`DaemonProcessPort`（3 方法：`spawnDetached`、`stopByPid`、`isRunning`）；以及收窄至 3 个核心方法的 `AuthPort`（`checkMerchant`、`verifyAndSeal`、`checkConsumerOnline`，返回 `authoritative` 标志区分权威核验写入本地 SQLite 记录与非权威夹具核验）。同时将 `closeAll` 清理钩子交付 CLI 顶层信号及异常处理器以取代全局浏览器集合静态引用，并更新架构依赖流契约说明与补齐共享 Adapter Contract Test。参见 `../spec.md`。

**Blocked by:** 01, 02

**Status:** resolved

- [x] `BrowserRuntimePort` 对外交付不透明 `BrowserSession` 句柄并封装 ADR-0002；实例级 `closeAll` 挂接至顶层 `SIGINT`/`SIGTERM`/异常清理链并同步更新架构依赖流文档
- [x] `MallPort` 覆盖探测、列表与切换且在 Live 与 Fixture 下产出同构店铺视图
- [x] `DaemonProcessPort` 覆盖分离启动、进程号停止与运行检测，消除测试对底层进程管理模块的直接劫持
- [x] 最小 3 方法 `AuthPort`（`checkMerchant`、`verifyAndSeal`、`checkConsumerOnline`）就位并正确传达 `authoritative` 布尔语义（控制是否写入本地 SQLite 核验记录），本地读写删仍保持在 SQLite 存储层
- [x] 建立共享 Adapter Contract Test 证明 Live（假页面）、Fixture 与内存适配器在返回结构、错误码、ADR-0003 禁用态与 `CandidateSeal` 校验上行为等价，且 `npm run check` 通过

## Comments

- 2026-11-25: 已合入 `feat/runtime-adapter-seams`（合并提交 `44cf720`）。共变更 24 个文件：新增 `src/infra/runtime-cleanup.js` 并将顶层 `closeAll` 清理钩子接入 `bin/pdd.js`（避免直接导入 `browser.js`，同步更新 `.trellis/spec/architecture/dependency-flow.md`）；完成 `BrowserRuntimePort`（6 方法、`WeakMap` profile 与活跃会话管理）、`MallPort`（3 方法，`mall-port.js`/`mall-context.js`/`fixtures/mall.js`）、`DaemonProcessPort`（3 方法，`daemon-process.js`/`fixtures/daemon.js`）与最小 3 方法 `AuthPort`（`auth-port.js`/`fixtures/auth.js`，携带 `authoritative` 标志控制 SQLite 核验记录持久化）的 Live/Fixture/InMemory 适配器；新增 `test/helpers/in-memory-ports.js` 及 5 套单元测试/契约测试（`runtime-cleanup`、`browser-runtime-port`、`mall-port`、`daemon-process-port`、`auth-port`，共新增 87 个用例）。合入后执行 `npm run check` 全量通过：`npm run lint`（`knip`）退出码 0；`npm test`（`vitest run`）150 个测试文件全部通过（`150 passed (150)`），2484 个用例通过、1 个 Windows 环境用例跳过（`2484 passed | 1 skipped (2485)`，耗时 `68.42s`）。
