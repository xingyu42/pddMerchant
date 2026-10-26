# 密码重登核心与熔断

## Goal

在普通命令内实现账号密码隐式重登：会话失效时自动用已保存的密码重新登录；遇到任何挑战转交人工；真正失败时熔断，避免反复尝试触发主账号风控锁号。

父任务：`10-27-password-relogin-console`。本任务是子任务 ③，依赖 ② 的表结构；④ 依赖本任务。

## Requirements

### 输入面

- N1 CLI 不提供任何明文密码入参（argv / stdin / 环境变量），LLM 只传账号 slug。本任务不提供密码录入入口，录入在 ④ 的控制台完成；测试通过直接写库的辅助函数构造凭据。
- N2 密码不得出现在 stdout、stderr、日志、错误正文、envelope 或 `PDD_DEBUG_RAW` 输出中。

### 隐式重登

- N3 恢复链：工作 Cookie 被判定失效（沿用现有 `merchant-auth-probe.js` 的判定，网络不确定不算失效）→ 账号有密码凭据且未熔断 → headless 打开登录页“账号登录”并填入账密 → 核验成功后保存 auth-state → 继续执行原命令。
- N4 在 `withCommand()` 内触发；每条命令对每个账号最多尝试一次。
- N5 遇到任何挑战（短信、滑块、点选、风控确认页）时，不点击、不发送，立即放弃本次登录，返回 `E_AUTH_HUMAN_REQUIRED`（exit 3），`hint` 提示执行 `pdd console link`；同时写入 `pending_actions`（状态“等待人工”）。在该状态下，该账号暂停自动重登。
- N6 没有密码凭据时，行为与现状一致（提示 `pdd login`）。
- N7 `doctor` 只报告会话状态、是否有密码、熔断状态及原因，不触发重登。

### 熔断与限频

- N8 以下情况触发熔断：密码错误、账号被锁；接管超时连续 2 次的计数由 ④ 写入同一熔断状态。
- N9 熔断后该账号停止自动重登。解除方式：重登成功、控制台手动解除、重设密码。
- N10 同一账号两次自动重登之间至少间隔 30 分钟（可配置）；间隔内返回上次的结果类别，不重新尝试。
- N11 熔断状态及原因持久化到 ② 预留的熔断表。

### 并发与超时

- N12 重登在 SQLite 账号租约内进行；同一账号上并发的其他命令等待租约释放后复用结果，不重复登录。
- N13 重登使用独立的时间预算（新增 `TIMEOUTS.LOGIN_PASSWORD`），不占用命令原有超时；仍响应取消信号。
- N14 `--all-accounts` 模式下各账号依次重登。

### 输出契约

- N15 `account list` 增加 `has_password`（是/否）与 `password_relogin_status`（可用 / 等待人工 / 已熔断：原因），使用 data 契约 v2 中文标签。
- N16 普通命令在存在待人工处理事项时，在 `meta.warnings` 中附结构化条目 `{ code: 'account_action_required', account, reason }`。
- N17 新增错误码登记到 `src/infra/errors.js`；登录表单结构变化沿用或改造现有的 `passwordLoginFormChanged`。

### Agent 说明

- N18 更新 `skills/pdd-cli/SKILL.md`：遇到 `E_AUTH_HUMAN_REQUIRED` 或 `account_action_required` 时执行 `pdd console link` 并把链接转给用户；任何情况下都不在聊天中索要密码；熔断或接管失败时走扫码兜底。

### 真实账号实验

- N19 在熔断代码完成之后、接入普通命令之前，在主账号上做有界实验：最多 3 次 headless 密码登录，遇到第一次滑块立即停止，只做只读核验，不做业务写操作。记录挑战类型、出现频率、验证码是否需点击才发送、新会话是否需要再次验证。结果写入本任务 `research/`。执行前再次向用户确认时间窗口。

## Acceptance Criteria

- [ ] fixture 模式：会话失效 + 有密码 → 隐式重登成功 → 原命令成功，stdout 仍为一行 JSON。
- [ ] fixture 模式：每类挑战（短信、滑块、点选、风控确认）均返回 `E_AUTH_HUMAN_REQUIRED` 并写入 `pending_actions`，且没有点击发送。
- [ ] 熔断：密码错误、账号被锁均触发熔断；熔断后不再尝试；三种解除方式均可测。
- [ ] 限频：间隔内的第二次失效不触发登录。
- [ ] 并发：两个命令同时遇到同一账号失效，只发生一次登录，两者都复用结果。
- [ ] 泄露测试：密码不出现在任何输出、日志或错误中（含 `PDD_DEBUG_RAW=1`）。
- [ ] `doctor` 不触发重登。
- [ ] 真实账号实验报告已写入 `research/`。
- [ ] `npm test` 全量通过；data 契约测试覆盖 `account list` 的新字段。

## Notes

- 后端代码由 Codex 编写，Claude 审查。
- `design.md` 与 `implement.md` 在 ② 完成后编写。
- 历史参考：`de00eb7` 中删除前的 `src/adapter/password-login.js`（Playwright 表单自动化与挑战检测）可作为实现参考，不直接恢复。
