# 迁移浏览器运行时到 Patchright

## Goal

将 pdd-cli 的 Chromium 自动化运行时从当前实际安装的官方 Playwright 迁移到 Patchright，消除依赖声明与安装结果的偏差，并在不改变 CLI、认证、商家操作、消费者抓取安全策略和输出契约的前提下使用 Patchright 的驱动级自动化特征修补。

## Background

- `package.json` 当前把 `playwright` 声明为 `npm:rebrowser-playwright@^1.48.0`，但 `npm ls playwright playwright-core rebrowser-playwright --depth=1` 实际解析为 `playwright@1.59.1` 与 `playwright-core@1.59.1`，Rebrowser 未被确认生效。
- 生产代码中 `src/adapter/browser.js` 和 `src/commands/doctor.js` 直接从 `playwright` 导入 `chromium`。
- `src/adapter/browser.js` 统一承担浏览器启动、Context 创建、敏感登录态加载、消费者代理 Context 和资源清理；它当前还注入 `src/infra/stealth-scripts.js` 的页面级指纹脚本。
- 消费者源商品抓取通过 fresh `browser.newContext()` 读取共享 `consumer-auth-state.json`；代理尝试使用独立 Context，且账号降级后立即停止并删除消费者登录快照。
- Patchright 官方 Node.js 包名为 `patchright`，只支持 Chromium。官方建议真实 Chrome、持久化 Context、headed、默认 viewport 且不自定义 UA/headers，但这些建议会改变当前浏览器生命周期与部署要求，不能作为普通依赖替换悄然引入。
- Patchright 会改变 `Console.enable`、`addInitScript`、WebSocket routing、部分事件和请求头观察行为，因此必须验证本仓库的 init script、XHR、route、认证保存和清理路径。
- 当前工作区包含青果代理、消费者登录和 doctor 等未提交改动；迁移不得覆盖或回退这些改动。

## Requirements

### R1. 直接迁移运行时

- 使用官方 `patchright` Node.js 包替换当前 `playwright`/Rebrowser 声明，不保留运行时 A/B 开关或双实现。
- 所有生产代码中的 Chromium 入口必须来自同一个仓库内适配边界，避免 `doctor` 或其他模块绕过适配器直接绑定另一套运行时。
- 依赖锁文件必须与 `package.json` 一致，`npm ls` 不得再解析出顶层官方 `playwright` 作为 pdd-cli 的浏览器运行时。
- `ghost-cursor-playwright` 可以继续携带其内部 `playwright-core` 依赖，但该依赖不得被生产代码导入或用于启动浏览器。

### R2. 保持外部契约

- 保持 Node.js ESM、无构建步骤的运行方式。
- 保持 CLI 命令、选项、退出码及 `{ ok, command, data, error, meta }` envelope 形状。
- `--json` stdout 仍为单行 JSON；不得新增运行时 `console.log`。
- 保持商家认证、消费者认证、账号注册表、mall context、daemon 续期和 goods publish 的既有业务语义。

### R3. 兼容认证和浏览器生命周期

- 继续通过 `saveAuthState()` 与既有锁机制读写认证数据，不记录或输出 Cookie、二维码内容、代理节点或其他敏感信息。
- 登录成功后生成的认证状态必须仍能被 doctor、daemon/refresh、商家命令和消费者源商品抓取读取。
- 浏览器、Context 和 Page 在成功、异常、超时及初始化脚本失败时都必须关闭，不新增进程或 Profile 锁泄漏。
- 商家流量保持直连；源商品代理仍只作用于消费者抓取 Context。
- 本任务保留 fresh Context + `storageState` 生命周期，不新增 `userDataDir`、持久化 Profile 或 Profile 锁。

### R4. 收敛重复或冲突的隐蔽处理

- 审计现有启动参数、固定 UA/viewport/deviceScaleFactor 和 `stealth-scripts.js`，删除由 Patchright 已覆盖且可能制造冲突的处理。
- 不得在没有一致性证据时继续伪造 Chrome 版本、GPU、plugins 或每次变化的 Canvas 指纹。
- 不以“不可检测”作为验收条件，也不新增验证码求解、无限重试或其他绕过平台控制的功能。

### R5. 保持消费者安全边界

- 消费者账号降级仍在首个信号处停止，删除消费者认证快照，且不继续代理轮换。
- 代理基础设施错误仍遵守现有最多三次尝试预算；不回退到机器直连。
- `doctor` 仍只报告商家/消费者登录在线状态，不扩展为代理、价格、SKU 或源抓取就绪性诊断。

### R6. 验证和文档

- 新增或调整浏览器适配层测试，覆盖 Patchright 导入、启动配置、Context 配置、代理隔离、初始化失败清理和可执行文件检查。
- 定向验证 auth state、consumer login、doctor、XHR/route、goods publish 和 browser cleanup。
- 运行完整 `npm test`；`npm run lint` 仅为 `echo no-lint`，不得将其描述为真实 lint 门禁。
- 更新安装说明和 doctor 的浏览器安装提示，使其使用实际的 Patchright 安装命令。

## Acceptance Criteria

- [x] AC1: `package.json` 与 lockfile 使用锁定的官方 `patchright` Node.js 包，顶层运行时不再依赖官方 `playwright` 或 Rebrowser alias。
- [x] AC2: 所有生产 Chromium 导入都通过统一适配边界使用 Patchright，仓库扫描无遗留的生产 `from 'playwright'`。
- [x] AC3: doctor 能正确报告 Patchright 所用浏览器可执行文件，并给出正确安装提示。
- [x] AC4: 商家二维码/有头登录、消费者二维码/有头登录及认证保存接口保持兼容；认证内容不出现在日志或 JSON 输出中。
- [x] AC5: 商家 endpoint、XHR collector、form-filler route 和消费者源抓取所依赖的 Page/Context API 通过定向回归测试。
- [x] AC6: 现有消费者账号降级、代理隔离、重试预算和登录快照删除测试继续通过。
- [x] AC7: 浏览器初始化、Context 初始化、回调异常和正常结束均无已知浏览器/Context 资源泄漏。
- [x] AC8: `npm test` 全量通过；若出现与当前已知 Windows sandbox PBT 波动相同的失败，必须用相同 seed 隔离复现并记录，不能直接忽略。
- [x] AC9: README/安装文档与实际 Patchright 依赖、浏览器安装命令和支持边界一致。
- [x] AC10: `git diff` 仅包含本任务规划或迁移所需改动，不覆盖当前工作区的青果代理、消费者登录、doctor 等既有未提交工作。

## Out of Scope

- 用真实 PDD 页面证明“不可检测”或保证绕过平台风控。
- 增加验证码、滑块自动求解或扩大代理重试预算。
- 修改 envelope、命令语义、商品发布流程或商家/消费者流量隔离规则。
- 同时引入 Camoufox、nodriver、其他指纹浏览器或多运行时切换框架。
- 在本任务内恢复已经降级的消费者账号。
- 真实 Chrome channel、强制 headed 模式、持久化 Profile 以及现有认证 JSON 到 Profile 目录的迁移。

## Decisions

- D1: 用户于 2026-07-12 同意最小迁移方案：直接切换 Patchright，但保留当前 fresh Context + `storageState` 生命周期。
- D2: 不建立 Playwright/Patchright A/B 开关；迁移完成后 Patchright 是唯一生产 Chromium 运行时。
- D3: 持久化消费者 Profile 是独立后续能力，不在本任务中顺带实现。
