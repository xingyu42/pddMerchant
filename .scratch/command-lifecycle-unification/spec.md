# Spec：非 Runner 命令收敛与环境诊断服务化

Status: ready-for-agent

来源：2026-11-24 架构深模块审查与 Design It Twice 评审（协同规格群实施拓扑：T4 —— 在 T2(P0-1b) 与 T3(P1-4) 完成后落地，承接 P1-4 的 `relogin-policy` 并负责吸收账号移除；与 P0-2 支持无阻塞并行落地，`loginConsumer` 接收可选注入冷却实例并在 P0-2 尚未落地时先沿用既有共享配置兜底）。

## Problem Statement

当前有 4 个命令文件（`init`、`login`、`account`、`config`）绕开统一命令执行器 `withCommand()` 自行处理计时、异常捕获、envelope 拼装与输出发射：虽然输出模块 `emit()` 内部已调用 `buildEnvelope()`（具备 `v: 2`、原始字段剥离与原始调试开关支持），但绕开统一执行器依然导致了实际契约漂移——包括缺失 `correlation_id`、缺失统一命令计时与协作式超时预算管理、首次初始化命令漏传 `--no-color` 开关、`login` 与 `account` 直接返回构建信封前的原始视图对象，以及账号管理在四个导出中重复了四套几乎一致的样板代码。

与此同时，`doctor` 与 `login` 中 6 条直接导入适配器层的依赖属于既有依赖流规范曾临时授权的历史例外，现在应随着组合根与注入端口到位而全部收回并消除残留 `isMockEnabled()`；更隐蔽的缺陷在于现行 `doctor` 遗漏 `needsBrowser: false` 标志，导致 Live 模式下执行器先启动一份空浏览器并在 Chromium 缺失时提前崩溃而失却准确 `E_CHROMIUM_MISSING` 诊断，健康环境下又启动第二份浏览器；此外 `doctor` 注册项上存在无任何读取方的冗余 `--probe` 选项，以及 35 行旧版存储探测与 15 行账号移除等过碎模块。

## Solution

保持 `withCommand` 作为命令层单一声明入口（使 30 个既有业务命令实现零改动），直接引用 P0-1 冻结签名的 `composeCommandRuntime` 与 `OutputSink`（含 `hasEmitted()` 单次发射守门），收敛出统一的 `envelope-kernel` 与三种封闭生命周期预设（`merchant` / `local` / `maintenance`），建立全命令到预设的完整映射与加载期合法性校验，通过挂载于命令处理器的 `runtimeConfigPolicy` 作为唯一配置策略真相源消除双处维护。

将环境诊断、`init`/`login` 交互授权、`account` 与 `config` 的领域逻辑全面下沉至领域层，收回 `doctor`/`login` 的 6 条命令层直连适配器授权例外并清除残余 `isMockEnabled()`（或延续 P0-1 注入模式），修复 `doctor` 单浏览器延迟启动顺序并移除冗余 `--probe` 选项，明确 `resolvedAccount` 由 `runner`（CLI）或外部调用方解析注入以消除与 `DoctorReport` 的重复，在 T4 顺次承接 P1-4 交付的 `relogin-policy` 并将账号移除浅模块吸收进账号领域服务同时更新控制台账号模块导入，由 P1-3 引入交互式登录适配器供下沉后的商家与消费端登录消费，并接收可选注入的软封冷却实例（支持在 P0-2 并行尚未落地时沿用既有共享配置兜底，待 P0-2 落地时统一切换）。

## User Stories

1. 作为 CLI 与 AI 调用方，我希望 `init`、`login`、`account.*` 与 `config.*` 输出的 JSON envelope 都经统一终结内核生成，以便每条命令稳定携带 `correlation_id`、真实 `latency_ms`、一致的 `noColor` 策略、统一协作式超时治理与规范 envelope 返回语义。
2. 作为用户，我希望当本地配置损坏时，`pdd config show|set|unset|validate` 依然能够在维护模式（`maintenance`）下启动并诊断或修复配置，而不受运行配置校验阻断。
3. 作为维护者，我希望 `runtimeConfigPolicy` 直接作为命令声明的一部分由 CLI 入口自动读取，以便单点维护配置加载策略。
4. 作为用户，我希望在 Live 模式下运行 `pdd doctor` 时，系统先检查 Chromium 可用性再决定是否开启浏览器，以便缺失浏览器时准确返回 `E_CHROMIUM_MISSING`，且健康环境下只启动一次浏览器同时完成商家与消费端 `Login Online Check`。
5. 作为安全与合规审计者，我希望 `doctor` 严格遵循 ADR-0002 与 ADR-0003：仅聚焦 Chromium 可用性、本地存储健康与登录在线核验（禁止输出指纹打分），在仅执行读取检查时通过 `AuthPort` 执行只读 `Merchant Authentication Check` 确立当下 `Merchant Session Validity`（零写回、零租约、零自动重登），且对后台守护进程保持零依赖。
6. 作为维护者，我希望诊断逻辑封装为返回纯值 `DoctorReport`（`{ ok, view, raw, warnings, failure }`）的领域模块并吸收旧版存储探测薄文件（仅依赖 `BrowserRuntimePort`、`AuthPort` 与 `log`，无需携带输出流注入），同时固定商家可选账号仅由 `runner`（CLI 入口）或外部复用方解析注入而不重复返回 `resolvedAccount`，以便单一出处清晰且便于控制台复用。
7. 作为多账号环境下的使用者，我希望未保存任何账号时 `doctor` 仍可运行并明确报告未配置；已存单个账号或传入 `--account` 时由 `runner` 以可选模式正确解析并在 `meta` 中保留账号元信息。
8. 作为用户，我希望旧版存储探测在 `doctor` 最早期运行，且严格限制只读一级非符号链接检查、绝不泄露路径或文件内容，以便后续因 `E_CHROMIUM_MISSING` 或登录失效抛错时结果中依然保留 `legacy_storage_detected` 告警与提示。
9. 作为用户，我希望 `pdd login --consumer` 按命令解析名称精确标注为 `login.consumer`，其对 `--password` 的 `E_USAGE`（退出码 2）拦截在进程内命令处理函数接缝处生效（CLI 解析器对未注册的 `--password` 直接按未知选项报错），下沉后的消费端登录接收可选注入的软封冷却实例（并行阶段先兼容沿用既有共享配置，待 P0-2 落地组合根冷却注入点后统一切换），且扫码提示严格写入 `stderr` 保持 `--json` 单行纯净，同时清理 `doctor` 上无读取方的 `--probe` 冗余选项并同步更新用户 CLI 技能文档。
10. 作为用户与维护者，我希望 `account add` 复用统一的商家交互有头登录流程并保留 `credentials_not_saved_headed_login` 告警；`account remove` 在未传 `--confirm` 时默认返回预演结果并支持无解密清空关联足迹；且由 P1-3（T4）在 P1-4 落地 `relogin-policy` 与 `console-accounts` 后，将 15 行账号移除模块吸收进账号领域服务并同步切换 `console-accounts` 的导入源。
11. 作为架构师，我希望正式收回 `doctor` 与 `login` 对适配器层的 6 条历史授权例外并全部转为经服务层与注入端口调用，同时清除命令层残余的 `isMockEnabled()`，令 `commands -> services -> adapter -> infra` 分层彻底干净。
12. 作为测试开发者，我希望直接向 `withCommand` 生成的命令函数传入 P0-1 冻结的 `composeCommandRuntime({ overrides, streams, clock, configOptions, runtimeConfigPolicy })` 与 `OutputSink` 替身，以便无需对输出或浏览器模块进行劫持即可断言完整信封与退出码。
13. 作为测试开发者，我希望在配置维护单元测试中既能直接验证领域层抛出 `PddCliError`，又能验证命令层在 `maintenance` 模式下返回标准错误信封。
14. 作为既有命令的维护者，我希望通过显式 `命令 → 预设` 映射与兼容规则（`needsAccount: true ≡ 'required'`、未传预设时 `needsBrowser: false` 兼容归入 `local`），确保全部 30 个业务 `merchant` 命令实现零改动平滑运行。
15. 作为维护者，我希望在 `withCommand` 定义期立即捕获 `needsBrowser: false` 与 `needsAuth: true` 混用等非法生命周期组合，以便在模块加载时暴露配置错误。
16. 作为开发者，我希望将 `doctor` 的人类终端渲染函数与 `toDoctorView` 同源维护在认证视图模块中，以便中文状态标签与诊断行展示保持单一出处。
17. 作为本地命令用户，我希望在 `init`、`login`、`account.add` 等交互命令执行超时或被 `Ctrl+C` 中断时，统一经执行内核的协作式预算机制清理浏览器并输出标准超时或中止信封，以便退出码与自动化解析保持一致。

## Implementation Decisions

### 统一命令执行内核、冻结入口引用与封闭生命周期预设

- 直接消费 P0-1 冻结签名的 `composeCommandRuntime({ mode, env, overrides, streams, clock, configOptions, runtimeConfigPolicy })` 与 `OutputSink`（复用 `emit(envelope, options)`、`hasEmitted()` 与 `streams`）。
- 在命令执行器内部建立共享 `envelope-kernel`，集中承担动态命令名解析（如区分 `login` 与 `login.consumer`）、统一计时与 `correlation_id` 生成、协作式超时预算装载（支持 `defaultTimeoutMs`）与安全释放、统一 `buildEnvelope` / `errorToEnvelope` 组装，以及两阶段防重复发射守门（CLI 主入口读取 `runtimeConfigPolicy` 并装配运行时；一旦进入 `withCommand`，全部正常与异常结果经 `OutputSink.emit` 精确发射一次，CLI 主入口仅同步退出码并在 `hasEmitted()` 为假时执行外层兜底发射，如 Commander 未知选项参数故障）。
- 为 `withCommand` 引入三种互斥 `lifecycle` 预设与加载期校验规则（其中 `merchant` 与 `local` 沿用 P0-1 既定的 `runtimeConfigPolicy: 'required'` 默认配置策略）：
  - `merchant`（缺省）：完整商家生命周期（需运行配置 `'required'`、可选 `--all-accounts` 批量执行、账号租约、浏览器会话、鉴权核验与复核、店铺上下文与待办告警）。
  - `local`：本地与自控生命周期（需运行配置 `'required'`、跳过执行器预启动浏览器与自动鉴权，支持 `needsAccount: 'none' | 'optional' | 'required'` 及 `needsMall: 'none' | 'stored'`，拒绝 `--all-accounts` 抛出 `E_USAGE`）。
  - `maintenance`：维护生命周期（挂载 `runtimeConfigPolicy: 'maintenance'`，跳过运行配置加载、账号解析、SQLite 与浏览器启动，即使配置损坏也可诊断/修复，拒绝 `--all-accounts`）。
  - **向后兼容与加载期断言**：`needsAccount: true` 等价映射为 `'required'`；未显式声明 `lifecycle` 时，声明 `needsBrowser: false` 的命令自动兼容归入 `local`，其余默认 `merchant`；加载期立即校验并拒绝非法组合（如 `needsBrowser: false` 与 `needsAuth: true` 混用、`needsMall: 'stored'` 却将 `needsAccount` 设为非必填、`maintenance` 声明鉴权/浏览器/账号/店铺）。
- **全命令 → 生命周期预设完整映射表**（同时在命令注册中移除 `doctor` 无读取方的冗余 `--probe` 选项并同步清理用户 CLI 技能指南中的对应参数示例）：

| 命令集 | 目标预设 | 关键生命周期标志与行为 | 源码迁移策略 |
|---|---|---|---|
| `diagnose.*`（9）、`goods.{list,profit,receipt,reviews,segment,stock,templates,traffic}`（8）、`orders.*`（4）、`promo.roi`（1） | `merchant` | `needsAuth: true`, `needsMall: 'switch'` | 零改动沿用默认预设 |
| `goods.publish`（1）、`goods.update.*`（5） | `merchant` | `needsAuth: true`, `needsMall: 'switch'`, `allowAllAccounts: false` | 零改动沿用默认预设 |
| `shops.current`、`shops.list` | `merchant` | `needsAuth: true`, `needsMall: 'current'` | 零改动沿用默认预设 |
| `console`、`daemon` | `local` | `needsBrowser: false`, `needsAuth: false`, `needsMall: 'none'`, `needsAccount: 'none'` | 兼容 `needsBrowser: false` 并拒绝批量 |
| `goods.cost.{import,list,remove,set}` | `local` | `needsBrowser: false`, `needsAuth: false`, `needsAccount: 'required'`, `needsMall: 'stored'` | `needsAccount: true ≡ 'required'` |
| `doctor` | `local` | `needsAccount: 'optional'`, `needsMall: 'none'` | 补充免执行器预启浏览器修复双启动 |
| `init`、`login` / `login.consumer`、`account.add` | `local` | `needsAccount: 'none'`, `needsMall: 'none'`, 交互 `defaultTimeoutMs` | 由旧直写接入 `withCommand` 领域下沉 |
| `account.{list,remove,default}` | `local` | `needsAccount: 'none'`, `needsMall: 'none'`（本地 SQLite 事务） | 由旧直写接入 `withCommand` 领域下沉 |
| `config.{show,set,unset,validate}` | `maintenance` | `runtimeConfigPolicy: 'maintenance'`, 零配置/零库/零浏览器 | 由旧直写接入 `withCommand` 领域下沉 |

### 下沉环境诊断为深领域模块（单一出处与双浏览器修复）

- 新增独立环境诊断领域模块 `doctor`，提供纯业务入口 `diagnoseEnvironment(options, deps)`，接收外部可选传入的已解析商家账号（CLI 路径由 `runner` 按 `needsAccount: 'optional'` 解析后传入，非 CLI 复用方按需注入）、`BrowserRuntimePort`、`AuthPort` 与 `log`（不依赖 `OutputSink`），返回纯值结果 `DoctorReport`：`{ ok, view, raw, warnings, failure }`（不在 `DoctorReport` 中重复返回 `resolvedAccount`，保持单一账号解析出处）。
- 吸收原 35 行旧版存储探测浅模块至诊断领域内部（保持防符号链接一级只读扫描与路径脱敏），将人类终端渲染函数 `renderDoctor` 迁入认证视图模块与 `toDoctorView` 同源维护，并正式收回命令层对适配器直连的历史授权例外。
- 固化诊断严格顺序：
  1. 最先执行旧版存储探测，命中即写入 `legacy_storage_detected` 告警与提示；
  2. 读取外部传入的商家账号、消费端账号上下文及经 P1-4 `relogin-policy` 获取的零解密密码重登摘要；
  3. 调用 `BrowserRuntimePort.checkAvailability()` 检查浏览器可执行文件，失败立即返回 `E_CHROMIUM_MISSING`，零浏览器启动；
  4. 调用本地可替代鉴权存储只读检查选中商家与消费端登录态文件健康度，严格透传主密钥缺失或带账号上下文的解密失败，消费端文件损坏抛出 `E_CONSUMER_AUTH_STATE_INVALID`；
  5. 仅当商家或消费端至少一方本地登录态可读时，通过 `BrowserRuntimePort` 开启**单次** `BrowserSession`（并通过 `deriveConsumerContext` 在同一 `Runtime Browser Profile` 下派生消费端页面），依次经 P0-1 最小 `AuthPort` 执行只读 `Merchant Authentication Check`（零租约、零写回、零重登）与 `checkConsumerOnline` 消费端 `Login Online Check`；
  6. 执行既有登录断言与全账号存储健康清点（单账号无法解密降级为行级故障标记并继续遍历其余账号），经视图白名单投影输出结果。

### 交互登录、账号与配置编排服务化（与 P1-4 / P0-2 协同分工）

- **交互登录编排下沉与适配接口**：
  - 在适配器层新增独立交互登录适配入口（商家有头/扫码登录 `loginMerchantInteractive` 与消费端交互登录 `loginConsumerInteractive`），使 P0-1 的 `AuthPort` 保持最小 3 方法正交边界。
  - 在认证领域模块提供 `loginMerchant`、`loginConsumer` 与 `createQrTerminalPresenter`（所有扫码提示与二维码字符画严格写入组合根注入的 `streams.stderr` 流，隔离 `stdout`）。
  - `loginConsumer` 在领域层完成消费端 `--password` 拦截（明确作为进程内命令处理器测试接缝保留，CLI 外层未注册 `--password` 选项按未知选项报错）、目标消费端账号解析、消费端交互登录适配器调用（消除直接 `isMockEnabled()`，读取运行时模式）、接收可选注入的持久化软封冷却实例（若与 P0-2 并行推进期间尚未接入组合根冷却实例，先沿用既有共享冷却配置兜底，待 P0-2 落地时统一切换并删除兜底分支）、`uid` 一致性校验（`E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH`）及原子落库视图投影。
- **账号管理下沉与协同接管**：
  - 设立账号领域模块统一承载列表查询、添加账号（委托有头商家登录并附带 `credentials_not_saved_headed_login`）、移除账号与设置默认账号。
  - 明确分工与先后时序：P1-4（T3）先拆出 `relogin-policy`（并更新诊断与账号模块重登摘要导入）及纯本地 `console-accounts`；P1-3（T4）随后将 15 行账号移除模块吸收进账号领域模块（保留默认 dry-run 与无解密 SQLite 足迹统计）并同步将 `console-accounts` 的删除调用导入切换为统一账号领域模块。
- **配置维护与命令层薄化**：
  - 设立配置维护领域入口统一封装受管配置读取、验证、原子写入与损坏配置只读诊断；`doctor`、`init`、`login`、`account`、`config` 全部缩减为声明 `withCommand`（及对应预设/策略）与透传调用领域入口的薄壳，彻底清零非执行器的命令层到适配器层导入边。

## Testing Decisions

1. **命令级生命周期接缝（零输出与浏览器模块劫持）**
   直接调用经 `withCommand` 包装的命令处理函数，传入 `composeCommandRuntime({ overrides, streams, clock, configOptions, runtimeConfigPolicy })`：
   - 验证 `init`、`login`、`account.*`、`config.*` 全部产出含 `meta.v: 2`、`correlation_id`、真实 `latency_ms`、正确 `noColor` 处理的标准信封，且注入的 `stdout` 流恰好收到单行 JSON、`OutputSink.hasEmitted()` 精确触发一次；
   - 验证针对进程内命令处理接缝调用 `login`（`--consumer --password`）时返回 `command: 'login.consumer'` 与 `E_USAGE`（exit 2），同时核实 CLI `--probe` 已移除、命令行层未知 `--password` 按常规 `unknownOption` 失败；验证扫码引导严格落入注入的 `stderr`；
   - 验证 `config.validate` / `config.set` 在本地 JSON 损坏时仍可通过 `maintenance` 模式抵达并返回标准错误信封（exit 1）；
   - 验证 `doctor` 在 Chromium 缺失时浏览器会话打开次数为 0、在双端已配置时浏览器会话打开次数严格为 1，异常时保留 `legacy_storage_detected`，且 `goods.cost.*` / `console` / `daemon` 按 `local` 预设拒绝 `--all-accounts`。
2. **领域层接口单元测试**
   在隔离临时 SQLite 与临时配置目录上，直接向 `diagnoseEnvironment`（校验无重复 `resolvedAccount` 字段且支持外部传入账号上下文）、`loginMerchant` / `loginConsumer`（验证注入软封冷却实例与 `streams.stderr`）、账号领域模块（含原账号移除干跑/实删路径）与配置领域模块注入内存端口，覆盖解密异常分类、多账号巡检单条降级、身份不匹配、二维码回退与主密钥错配可删场景。
3. **端到端、契约与文档路径守卫迁移（Replace, Don't Layer）**
   - 保留全部 CLI Fixture E2E 与 `data-contract-v2` 契约覆盖；调整少量直接进程内调用命令函数并断言未包装异常的旧测例，改断言标准错误信封或直测领域抛错；移除已被合并的旧版存储探测与账号移除孤立浅测。
   - 在同一次变更内更新受移除文件（旧版存储探测、账号移除浅模块）与生命周期例外收回影响的文档与 steering `SKILL.md` 路径，同步移除 `skills/pdd-cli/SKILL.md` 第 59 行 `pdd doctor [--probe xhr]` 中的 `[--probe xhr]` 参数说明，并通过 `test/contract/doc-paths.test.js` 与 `npm run check`。
4. **参考先例（Prior Art）**：沿用既有命令超时与运行时生命周期测试、登录存储事务测试及配置编辑契约测试结构。

## Out of Scope

- P0-1 双组合根签名与 `BrowserRuntimePort`/`AuthPort`/`OutputSink` 底层实现细节（见 `.scratch/runtime-adapter-seams/`）。
- 商品发布领域与组合根软封冷却实例注入点的实现（见 `.scratch/goods-publish-deepening/`）。
- 控制台交互登录驱动、会话状态机、`relogin-policy` 与 `console-accounts` 建立（见 `.scratch/auth-console-login-deepening/`）。
- 修改任何对外命令名称、既有有效参数选项、退出码约定、错误码或 `data` 契约 v2 字段与中文标签（清理确认无人读取的孤立 `--probe` 参数除外）。
- 为 `doctor` 新增浏览器指纹评分或自动修复账户能力（受 ADR-0002 与 ADR-0003 约束）。

## Further Notes

- 严格按 `T2(P0-1b) → T3(P1-4) → T4(P1-3)` 顺序推进（与 `P0-2` 采用无阻塞并行交接：`loginConsumer` 先通过可选注入冷却参数并以共享配置兜底，待 P0-2 落地组合根冷却注入点后统一切换并删除兜底）：先由 P1-4 交付 `relogin-policy` 与 `console-accounts` 并完成 `doctor`/`account` 重登摘要导入切换，再由 P1-3 完成命令执行内核收敛、吸收 `account-removal` 并更新 `console-accounts` 导入。
- 完成后同步更新 `.trellis/spec/commands/command-contracts.md`、`.trellis/spec/commands/runner-lifecycle.md` 与 `.trellis/spec/architecture/dependency-flow.md`（lines 35–37）中的非 runner 例外说明，正式声明全命令统一纳入信封终结、`doctor` 单会话修复以及收回 `doctor`/`login` 命令层直连适配器授权。
