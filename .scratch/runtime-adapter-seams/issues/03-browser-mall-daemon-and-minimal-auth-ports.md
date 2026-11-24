# 03: `BrowserRuntimePort`、`MallPort`、`DaemonProcessPort` 与最小 `AuthPort`（含信号清理钩子）

**What to build:** 冻结并实现四套核心外部接缝及其 Live / Fixture / InMemory 适配器：`BrowserRuntimePort`（6 方法：`checkAvailability`、`withSession`、`openSession`、`deriveConsumerContext`、`reclaimOrphans`、`closeAll`，管理实例级活跃浏览器与继承同一 `Runtime Browser Profile` 的消费端上下文并封装 ADR-0002 回退规则）；`MallPort`（3 方法：`detectCurrentMall`、`listMalls`、`switchMall`，Live 与 Fixture 共用同构归一化）；`DaemonProcessPort`（3 方法：`spawnDetached`、`stopByPid`、`isRunning`）；以及收窄至 3 个核心方法的 `AuthPort`（`checkMerchant`、`verifyAndSeal`、`checkConsumerOnline`，返回 `authoritative` 标志区分权威核验写入本地 SQLite 记录与非权威夹具核验）。同时将 `closeAll` 清理钩子交付 CLI 顶层信号及异常处理器以取代全局浏览器集合静态引用，并更新架构依赖流契约说明与补齐共享 Adapter Contract Test。参见 `../spec.md`。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] `BrowserRuntimePort` 对外交付不透明 `BrowserSession` 句柄并封装 ADR-0002；实例级 `closeAll` 挂接至顶层 `SIGINT`/`SIGTERM`/异常清理链并同步更新架构依赖流文档
- [ ] `MallPort` 覆盖探测、列表与切换且在 Live 与 Fixture 下产出同构店铺视图
- [ ] `DaemonProcessPort` 覆盖分离启动、进程号停止与运行检测，消除测试对底层进程管理模块的直接劫持
- [ ] 最小 3 方法 `AuthPort`（`checkMerchant`、`verifyAndSeal`、`checkConsumerOnline`）就位并正确传达 `authoritative` 布尔语义（控制是否写入本地 SQLite 核验记录），本地读写删仍保持在 SQLite 存储层
- [ ] 建立共享 Adapter Contract Test 证明 Live（假页面）、Fixture 与内存适配器在返回结构、错误码、ADR-0003 禁用态与 `CandidateSeal` 校验上行为等价，且 `npm run check` 通过
