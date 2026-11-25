# Spec：鉴权、密码重登与控制台登录集群深化

Status: ready-for-agent

来源：2026-11-24 架构深模块审查与 Design It Twice 评审（协同规格群实施拓扑：T3 —— 在 T2(P0-1b) 完成无环叶模块与静态断链前置后、先于 T4(P1-3) 落地；统一承接夹具鉴权分叉删除与 `relogin-policy` 切换）。

## Problem Statement

当前鉴权与控制台登录集群跨越十余个耦合模块：密码重登模块向外导出 15 个符号（扇出 16），将高频轻量的凭据读写及只读状态摘要查询（被账号列表、环境诊断、控制台账号与夹具运行期消费）与重型浏览器自动重登编排捆绑在同一模块中；同时商家凭证核验静态依赖浏览器启动器、登录态存储静态依赖 mock 分发器，迫使轻量调用方传递耦合浏览器与夹具实现；既有的 `beginReloginAttempt` 雏形旁仍向外暴露 `recordReloginAttempt` 与 `recordReloginOutcome` 两个底层记账辅助，且未接收实例级 `CandidateSeal` 与 `commit` 注入。

控制台交互登录模块导出 13 个符号并持有模块级全局 `sessions` 映射表，在内部混入跨职责的账号删除入口 `removeConsoleAccount`，同时遍布 `isMockEnabled()` 与 `session.fixture` 双轨判断；`merchant-session`、`password-relogin` 与 `patrol` 之间还滞留相互交织的 `reloginForFixture` 与 `checkFixtureMerchantSession` 夹具鉴权双分叉；下方的 `console-login-browser` 薄包装仅 60 余行却暴露 8 个函数直接改写裸露 `session` 对象上的可变字段，迫使控制台单元测试长期依赖 3 组跨层模块劫持。

## Solution

以 P0-1 提供的双组合根、无环叶模块 `CandidateSeal` / `assertAuthTask`、已切断的鉴权-浏览器-夹具静态导入链、`AuthPort`（最小 3 方法加 `authoritative` 标志）与 `BrowserRuntimePort` 为前置底座，将原高耦合集群重组为职责正交的深模块群：零浏览器与零夹具依赖的 **`relogin-policy`**（为 `beginReloginAttempt` 显式注入实例级 `seal` 与 `commit`、私有化底层记账辅助、并将环境诊断与账号管理切换至其只读摘要接口）；单入口在线自动恢复模块 **`auto-relogin`**（合并 `merchant-session` 与 `patrol` 分叉，同步彻底删除 `reloginForFixture` 与 `checkFixtureMerchantSession`）；由 P1-4 直接向 `composeDaemonRuntime` 注册的具名 **`ConsoleLoginDriverPort`** 与 **`consoleExtraRoutes`**（整文件删除 `console-login-browser`，提供 Live CDP、Fixture 与 InMemory 三套适配器，统一保证进 `verifying` 时排空在途二维码刷新）；实例级 **`createConsoleApp`**；以及归位 `removeConsoleAccount` 的纯本地 **`console-accounts`**（随后由 P1-3 在 T4 吸收账号移除模块并切换其删除导入）。

## User Stories

1. 作为账号列表、环境诊断、命令行告警与控制台链接的维护者，我希望在 P0-1 切断商家核验到浏览器与登录态存储到 mock 分发器的静态导入链之后，通过零浏览器、零 Playwright、零夹具导入的 `relogin-policy` 读取重登摘要、待办告警与管理凭据，以便轻量命令彻底摆脱重型浏览器依赖链。
2. 作为守护进程与重登维护者，我希望直接在既有 `beginReloginAttempt` 基础上私有化 `recordReloginAttempt` 与 `recordReloginOutcome` 并迁移相关单测，同时为其增加组合根注入的实例级 `seal`（`CandidateSeal`）与 `commit` 入参，完整封装尝试前计时落库、凭据版本防陈旧覆写、签章校验与单条短同步事务内的租约加 CAS 提交。
3. 作为运维人员，我希望 30 分钟同错因重登冷却作为可配置默认值（`passwordReloginMinIntervalMs`）运作，仅当自动或手动重登门禁放行且需要登录时才解密密码凭据，且 `getReloginSummary` 在主密钥不配套或密文损坏时依然可读，以便密码误输熔断或待处理状态始终正常展示。
4. 作为维护者，我希望在线命令与巡航路径共用单一的 `auto-relogin` 入口（`recover`）与 P0-1 `AuthPort`（含 `authoritative` 语义），同时在本规格内统一删除 `reloginForFixture` 与 `checkFixtureMerchantSession` 双重夹具分叉，以便 `merchant-session`、`password-relogin` 与 `patrol` 彻底收归同一主线。
5. 作为安全维护者，我希望无论自动重登还是控制台交互登录，设备连续性快照均剔除全部 `PASS_ID` 并继承 `Runtime Browser Profile`，且 `PASS_ID` 仅作为获取信号——在关闭登录页后经 `AuthPort` 执行独立 `Merchant Authentication Check` 并由 `CandidateSeal` 签章后，方可**作为已验证重登凭据提交（经 `Merchant Authentication Check` 确立 `Merchant Session Validity`）**。
6. 作为维护者，我希望彻底删除直接改写裸 `session` 可变字段的 `console-login-browser` 薄包装，由 P1-4 向 `composeDaemonRuntime` 引入具名 `ConsoleLoginDriverPort` 统一交互登录驱动接缝，以便全部浏览器与 CDP 接管资源生命周期严格封闭在驱动句柄内部。
7. 作为控制台守护进程开发者，我希望 `daemon` 路由层通过单一实例化的 `consoleApp` 句柄与 P1-4 注册的 `consoleExtraRoutes` 完成全部控制台操作与停机清理，以便清除模块级全局 `sessions` 映射与全部 `isMockEnabled()` 判断。
8. 作为运维与安全审计者，我希望 Live 模式下 `/api/sessions/:id/fixture-complete` 在路由器中彻底缺席（由 `composeDaemonRuntime` 在装配期决定），且控制台内部零 fixture 分支，以便守住 ADR-0003 生产安全防线。
9. 作为控制台用户，我希望添加新店铺时在空白浏览器态下启动且事前不持账号租约、不写重登状态，待独立核验确认店铺身份后再走账号登记或既有店铺更新并保存凭据，同时在任何结束路径即时清空内存请求体凭据。
10. 作为控制台用户，我希望同一账号或添加任务的新会话主动中止同键旧会话并等待旧资源与租约彻底释放后再推进，同时全局保持最多 2 个不同键活跃或清理中的会话上限（第 3 个返回 429 `E_CONSOLE_BUSY`）。
11. 作为控制台用户，我希望在短信验证（`sms` 态单飞提交）、屏幕接管（5fps 背压帧流与固定锚点手势序列回放）与二维码同上下文刷新之间按 P4 状态机流转，并将 Live 路径既有的“进入 `verifying` 瞬间清空提示文案并排空在途二维码刷新”提升为 `ConsoleLoginDriverPort` 全适配器统一契约。
12. 作为控制台用户，我希望 `takeover` 或 `sms` 在已有账号模式下超时后准确累加超时计数（连超 2 次触发 `blocked` 熔断），而主动取消、二维码超时或新增店铺超时不触及超时计数器。
13. 作为控制台用户与维护者，我希望 P1-4 将 `removeConsoleAccount` 迁回纯本地的 `console-accounts` 模块（通过注入的活跃登录谓词拒绝删除正在登录中的店铺并返回 409 `E_CONSOLE_SESSION_STATE`，同时保持 `pdd console link` 零依赖）并将环境诊断与账号命令切换至 `relogin-policy` 读取重登摘要，随后由 P1-3（T4）吸收账号移除模块并切换 `console-accounts` 的删除导入源。
14. 作为测试开发者，我希望使用 `InMemoryConsoleLoginDriver`、真实临时 SQLite、实例级 `CandidateSeal` 与可控 `clock` 直接跨越 `createConsoleApp` 的公开接口驱动各种挑战与异常流转，以便彻底消除控制台测试中的 3 处模块劫持与 200ms 轮询等待。
15. 作为自动重登的维护者，我希望在密码修改或清除后，陈旧登录尝试返回的失败结果通过 `credentialUpdatedAt` 版本守卫跳过状态覆盖并仅记录告警，以便新密码的恢复状态被可靠保护。
16. 作为高并发环境下的运维人员，我希望会话在浏览器阶段遇到局部启动失败或取消信号时由驱动句柄自行幂等清理已创建的浏览器与接管通道，以便守护进程长期运行期间零僵尸浏览器残留。
17. 作为测试维护者，我希望自动重登引擎在命令预算耗尽时提前中止并恢复外层预算计时器，以便重登尝试既持有独立 90 秒预算又受外层中断信号严格约束。
18. 作为长期维护者，我希望终端会话进入终态后保留 5 分钟供前端轮询确认结果随后自动释放内存引用与 `unref` 定时器，以便长期运行的守护进程既能完整回报状态又保持内存恒定。

## Implementation Decisions

### 职责拆分：零浏览器策略模块与单入口自动重登引擎

- **零浏览器、零夹具 `relogin-policy` 模块（以 P0-1 断链为前置）**：
  - 前提条件：依赖 P0-1 先行切断商家凭证核验向浏览器启动器的静态导入、以及登录态存储向 mock 分发器的静态导入，确保策略模块仅依赖本地 SQLite 存储、租约检查与加密存储原语，实现严格零浏览器、零网络与零夹具导入。
  - 对外具名提供高频轻量读取（`getReloginSummary`、`getAccountActionWarnings`）、管理写操作（`setAccountPassword`、`clearAccountPassword`、`clearReloginBlock`、`markManualLoginSucceeded`、`recordTakeoverTimeout`）、纯设备态提取（`extractDeviceState`，克隆并剔除所有 `PASS_ID` 以保持设备连续性，区别于 `Merchant Cookie Repair`，并在损坏态回退空快照）、门禁决策 `decideRelogin` 与原子尝试句柄 `beginReloginAttempt`。
  - 在既有 `beginReloginAttempt` 基础上推进两项精确增量：① 将原本向外暴露的 `recordReloginAttempt` 与 `recordReloginOutcome` 降为私有实现细节；② 为 `beginReloginAttempt` 显式增加组合根注入的实例级 `seal`（`CandidateSeal`）与 `commit` 入参（替代隐式全局或静态存储默认绑定）。
  - 执行精确门禁与事务顺序：外部先通过 `decideRelogin` 门禁（手动模式先判熔断再判凭据；自动模式依次判凭据、熔断、`awaiting_human` 与可配置默认值 `passwordReloginMinIntervalMs` 控制的 30 分钟按历史原因节流，全部门禁阻断均在解密前返回）→ 持租约在外部 I/O 前写入 `last_attempt_at` → 失败路径检查 `credentialUpdatedAt` 版本防陈旧覆写并在单事务内同步 `relogin_states` 与 `pending_actions` → 成功路径先事务外校验注入的 `seal` 与初始化主密钥指纹，再于单条短同步事务内校租约、经注入 `commit` 执行 revision CAS 提交、手动成功重置与结果落库，提交成功后才同步内存事务对象。
  - 在 P1-4 落地时同步将环境诊断与账号管理命令对 `getReloginSummary` 的导入切换至 `relogin-policy`。
- **单入口 `auto-relogin` 模块与夹具双分叉清理**：
  - 由双组合根注入 P0-1 最小 `AuthPort`（含 `authoritative` 标志）、`BrowserRuntimePort`、实例级 `CandidateSeal`、`commit` 与 `clock`，提供单一 `recover` 方法统一承接命令行与巡航的自动恢复，在本规格内一次性彻底移除 `reloginForFixture` 与 `checkFixtureMerchantSession` 双重夹具分叉，统一 `merchant-session`、`password-relogin` 与 `patrol` 主线。
  - 严格维护外层命令预算的暂停/恢复、90 秒独立子预算及 20 秒核验预留、继承 `Runtime Browser Profile`、获取 `PASS_ID` 后立即关页再经 `AuthPort` 独立完成 `Merchant Authentication Check` 确立 `Merchant Session Validity`、经 `beginReloginAttempt` 作为**已验证重登凭据提交**（仅当 `authoritative` 为真时写入本地 SQLite 核验记录）并续期账号租约；巡航非保留模式与所有失败路径确保关闭临时浏览器上下文。

### 由 P1-4 引入 `ConsoleLoginDriverPort` 与删除浅包装

- 整文件移除 `console-login-browser`，由 P1-4 向 `composeDaemonRuntime` 直接引入与注册清晰的 `ConsoleLoginDriverPort` 接缝与 Fixture 专用 `consoleExtraRoutes`（Live 模式下恒为空集）：`openSession({ sessionId, mode, ownerTag, deviceState, signal, deadlineAt })` 返回全封装 `DriverSessionHandle`（具名提供 `attemptPassword`、`captureQr`、`openTakeover`、`submitSmsCode`、`waitForAcquisition`、`verify`、`close`）。
- 底层 `browser`、`context`、`page`、`takeover` 句柄完全私有封闭在驱动闭包内部，启动阶段任意局部失败均由适配器自行回收已创建资源，关闭操作保证幂等；同时将 Live 路径既有的“排空在途二维码刷新并关闭接管与登录页后，再经 P0-1 最小 `AuthPort.verifyAndSeal` 与 `CandidateSeal` 独立核验”固化为全适配器通用契约。
- 接入三套真实适配器：
  1. `LiveConsoleLoginDriver`：复用 `BrowserRuntimePort` 继承 `Runtime Browser Profile`，封装登录表单监听、CDP 5fps 帧流与手势重放、短信输入、同上下文重拍二维码、200ms 信号轮询及在途二维码刷新排空与独立核验。
  2. `FixtureConsoleLoginDriver`：零浏览器进程，消费测试剧本、`openFixtureTakeover` 共享手势验证与固定二维码图像，在内部持有按 `sessionId` 缓冲的完成门闩并经 `consoleExtraRoutes` 注册的测试完成路由驱动。
  3. `InMemoryConsoleLoginDriver`：供服务层单元测试确定性推进状态、模拟在途 QR 排空、发出模拟帧与控制验证门禁。

### 实例级 `createConsoleApp` 与 `console-accounts` 协同归位

- 将原先模块级的全局会话表收归 `createConsoleApp` 实例内部，由 `composeDaemonRuntime` 在每次守护进程启动时独立创建并传递给 HTTP 路由器与服务器停机流程（取代停机时对登录模块的直接全局调用）。
- `createConsoleApp` 聚合 `health`、`auth`、`patrol`、`accounts` 与 `sessions` 命名空间，完整保留 P4 状态机与注册表不变量：16 字节随机内存会话 ID；同键（`accountId` 或 `'add'`）新会话中止旧会话并串行等待其资源清理与租约释放；最多 2 个不同活跃或清理中键（第 3 个返回 `429 E_CONSOLE_BUSY`）；已有账号全程 12 分钟账号租约并在获租约后二次确认起跑条件；`add` 会话空白态零预租约、零重登态写入并在核验后按身份决定新建或更新再保存密码；9 态（`filling|takeover|sms|qr|verifying|succeeded|failed|timed_out|cancelled`）消息固定文案与 `verifying` 入口立即清空消息/二维码；`sms` 与 `qr/refresh` 单飞锁；仅 `takeover`/`sms` 在已有账号模式下超时记入两连熔断；5 分钟终态回收（`unref` 定时器）及守护进程停止时拒绝新启动（`503 E_CONSOLE_STOPPING`）并全部取消回收。
- 无论 Live 还是 Fixture，已有账号登录成功后统一共用 `beginReloginAttempt`（传入注入的 `seal` 与 `commit`）作为已验证重登凭据提交路径。
- 将 `removeConsoleAccount` 迁回纯本地的 `console-accounts` 模块，通过构造注入的活跃登录检查谓词（`isAccountLoggingIn`）解除与登录会话模块的双向耦合，并保留 `pdd console link` 零成本独立调用能力；先沿用既有账号移除逻辑，随后在 T4（P1-3）吸收账号移除模块时将 `console-accounts` 的删除委托切换至统一账号领域服务。

## Testing Decisions

1. **控制台会话与账号集成接缝：`createConsoleApp` + `InMemoryConsoleLoginDriver` + 实例级 `CandidateSeal` + 可控 `clock`**
   结合真实隔离临时 SQLite 数据库测试全部核心契约，彻底移除针对浏览器、密码登录与二维码模块的三组 `vi.mock` 与环境变量桩：滑块/风控接管与 SSE 帧流/手势、SMS 错码与单飞并发校验、二维码刷新与超时不累加计数、在途 QR 排空与 `verifying` 入口清空消息、同键取代与资源未释放前占位 2-key 槽位、进行中删号 409 拦截、`add` 新店登记与已有店更新及凭据清理、CAS 冲突/身份不符回滚、两连超时熔断与停机取消。
2. **重登策略与自动恢复接缝：`relogin-policy` 与 `auto-relogin` 单测（含旧辅助测试迁移）**
   在真实临时 SQLite 上直接针对 `beginReloginAttempt`（注入 `seal` 与 `commit`）迁移原 `test/services/password-relogin.test.js`（L14、L130–344）中针对已私有化底层记账函数 `recordReloginAttempt`/`recordReloginOutcome` 的测试断言；覆盖门禁优先级、configurable `passwordReloginMinIntervalMs` 30 分钟节流、崩溃前预记录 `last_attempt_at`、密码变更后的 `credentialUpdatedAt` 版本防陈旧覆盖、事务回滚保留内存状态，以及经注入内存 `AuthPort`（验证 `authoritative` 与清除 `reloginForFixture` / `checkFixtureMerchantSession` 分叉）覆盖预算暂停/恢复与核验后租约续期。
3. **适配器定向契约测试与既有 E2E 回归（Replace, Don't Layer）**
   针对 `LiveConsoleLoginDriver` 增补薄适配器单测，守护部分初始化回收、排空 QR 后关页再核验时序及 `Runtime Browser Profile` 继承；继续保留既有 CDP 接管、SSE 流与核心 E2E 回归门禁（`test/e2e/password-relogin*.e2e.test.js` 4 个文件、`test/e2e/patrol.e2e.test.js`、`test/e2e/merchant-auth.e2e.test.js`），并在删除 `reloginForFixture` / `checkFixtureMerchantSession` 时同步迁移 `test/services/merchant-session.test.js` 与 `test/services/patrol.test.js` 中 `import * as relogin` 的模块打桩。按“replace, don't layer”删除指向已私有化底层记账辅助与已移除夹具分叉函数的冗余浅层测试，并通过 `npm run check`。
4. **参考先例（Prior Art）**：沿用既有控制台登录与账号存储单元测试、CDP 接管测试、SSE 测试以及控制台/巡航全链路 E2E 测试风格。

## Out of Scope

- P0-1 双组合根、`BrowserRuntimePort`、最小 `AuthPort`、`CandidateSeal` / `assertAuthTask` 叶模块与静态断链前置（见 `.scratch/runtime-adapter-seams/`）。
- P1-3 统一命令执行内核、`doctor` 单浏览器改造及吸收 `account-removal` 并更新 `console-accounts` 导入（见 `.scratch/command-lifecycle-unification/`）。
- 修改控制台 HTTP 安全边界（Host 校验、`X-PDD-Console` CSRF、Cookie 属性、64 KiB 上限、CSP 与安全头）或前端交互页面协议。
- 变更 SQLite `credentials`、`relogin_states`、`pending_actions` 表结构或加密算法细节。
- 修改 ADR-0003 定义的显式守护进程启停模式与巡航无浏览器第一阶段探测语义。

## Further Notes

- **明确的 P0-1 前置条件（T2 → T3）**：需先由 P0-1 完成 `assertAuthTask` 与 `CandidateSeal` 无环叶模块下沉、切断 `merchant-auth → browser` 与 `auth-state → mock-dispatcher` 静态导入链，并提供 `composeDaemonRuntime`、最小 `AuthPort`（含 `authoritative` 与 `verifyAndSeal`）、`BrowserRuntimePort` 与 `clock`。
- **明确的 P1-3 协同交接（T3 → T4）**：本规格（T3）交付零浏览器 `relogin-policy`（并将 `doctor` 与 `account` 的 `getReloginSummary` 导入切换过来）及独立 `console-accounts`；紧随其后的 P1-3（T4）负责吸收 `account-removal` 并同步更新 `console-accounts` 的删除委托导入，确保无同文件并发编辑冲突。
- 在迁移 `console-login` 测试时同步补齐共享 `takeover` 手势回放器的确定性调用封装，确保内存驱动与真实/Fixture 驱动共享完全一致的手势坐标与时序校验规则。
