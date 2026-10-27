# 账密重登与人工接管控制台

## Goal

商家会话通常几天就失效且无法续期。为登录增加账号密码自动重登线路，使会话过期后尽量无人值守恢复；密码与人工验证全程不经过 LLM 对话，由常驻 daemon 托管的 Web 控制台承接人工操作；认证数据统一迁到 SQLite。

本任务是父任务：持有需求总表、子任务映射、跨子任务验收与最终集成审查，不直接承载实现。

## 背景与约束

- 调用链：用户在 Telegram 通过 Hermes Agent（NousResearch/hermes-agent）调用 pdd-cli；CLI 只由 LLM 调用，用户很少直接操作 CLI。用户在 TG 里发的任何内容都会进入 LLM 上下文。
- Hermes 在消息平台上没有安全的密钥输入通道（官方文档：messaging sessions do not have a secure password reply channel）。
- Hermes 支持 `terminal(background=true)` + `process(poll/log/write)`；前台命令默认 180 秒超时。
- 密码登录曾实现后删除（`de00eb7` 引入、`a468d02` 删除），原因是滑块/短信挑战维护成本高；后台刷新 daemon 曾删除（`aecc0ae`），原因是定时刷新对会话寿命无效。
- LoginToken 消费路径（任务 `10-11-login-token-consumption`）实测无效：未过期会话也恢复不了。
- 用户研究仓库 `D:/Dev/pinduoduo`：官方工作台逆向只确认了 `checkLogin` 有效性检查与本地 Cookie 回写，未找到主凭据续期证据。
- 账号为主账号；部署环境需同时支持本机 Windows 与远程 Linux。
- 商家版 App 支持从相册识别登录二维码；短信验证码需在登录页点击后才发送。

## 威胁模型

- 只防**意外暴露**：密码不得进入 LLM 上下文、对话记录、模型服务商日志、CLI 输出或普通日志。
- 不防同一 OS 用户下进程的主动读取（Hermes 官方立场：软件层控制均可被模型绕过，边界只有 OS 隔离）。

## 需求总表

### R1 密码线路

- R1.1 CLI 不提供任何明文密码入参（argv / stdin / 环境变量）；LLM 只传账号 slug。
- R1.2 密码只能在 Web 控制台录入，只写、从不回显。
- R1.3 恢复链：工作 Cookie 失效 → 自动填账密重登 → 遇到挑战转人工接管；真正失败才熔断。
- R1.4 普通命令（`withCommand()`）内隐式重登。遇到任何挑战（短信、滑块、点选、风控确认页）时，不点击、不发送，返回 `E_AUTH_HUMAN_REQUIRED`（exit 3），写入 `pending_actions`（状态“等待人工”），该账号自动重登暂停直至接管完成。
- R1.5 熔断只针对真正失败：密码错误、账号被锁、接管超时连续 2 次。每条命令最多尝试一次；同一账号两次自动重登间隔至少 30 分钟。解除：重登成功、控制台手动解除或重设密码。
- R1.6 `doctor` 只报告会话状态、是否有密码、熔断状态，不触发重登。
- R1.7 重登在账号租约内进行，其他命令等待并复用结果；重登有独立超时预算；`--all-accounts` 按账号依次重登。

### R2 存储（破坏性更新）

- R2.1 使用内置 `node:sqlite`，`engines` 改为 `>=24`，由 `src/infra/db.js` 封装；WAL + `busy_timeout` + `BEGIN IMMEDIATE`，revision 乐观并发，取代 `auth-lock.js` 文件锁。
- R2.2 首期入库：商家与消费者账号、密码凭据、熔断状态、auth-state、账号租约、daemon 租约、`pending_actions`；缓存类数据留二期。
- R2.3 字段级 AES-256-GCM，AAD 绑定“表名 + 主键”；密钥自动生成于 `data/master.key`（POSIX 0600，Windows 用户级 ACL）；删除 scrypt 与 `PDD_MASTER_PASSWORD`。
- R2.4 不迁移旧数据：旧 JSON/auth-state 文件不读、不删；`doctor` 检测到旧文件时提示可手动删除；升级方式为重新登录各账号。
- R2.5 删除文件存储层及相关环境变量（`PDD_AUTH_STATE_PATH`、`PDD_CONSUMER_AUTH_STATE_PATH`、`PDD_ACCOUNTS_DIR`、`PDD_CONSUMER_ACCOUNTS_DIR`、`PDD_ACCOUNT_REGISTRY_PATH`、`PDD_CONSUMER_ACCOUNT_REGISTRY_PATH`、`PDD_ALLOW_INSECURE_AUTH_STATE`、`PDD_MASTER_PASSWORD`），只新增 `PDD_DB_PATH`；测试每个用例使用独立临时库。

### R3 daemon

- R3.1 `pdd daemon start/stop/status/run`；CLI 自行后台化（`detached` + `windowsHide`），不做开机自启，不提供 OS 服务配置。
- R3.2 停止通过数据库停止请求，15 秒未退出按租约 pid 强杀。
- R3.3 单实例：SQLite daemon 租约，30 秒心跳、90 秒过期；新实例发现有效租约即退出。提供 `GET /healthz`。
- R3.4 按“随时被强杀”设计：事务 + WAL、租约 TTL、启动时清理遗留 Chromium。
- R3.5 日志固定写 `data/logs/daemon.jsonl`，10MB 轮转保留 3 份，沿用现有脱敏。
- R3.6 巡航：纯 HTTP `checkLogin` 探测（不启动浏览器），间隔 30 分钟 ±20%，`patrol.enabled` 可关闭；发现过期发起重登，受 R1.5 约束。
- R3.7 普通命令发现 daemon 未运行时只在 `meta.warnings` 附 `daemon_not_running`，不自动拉起。

### R4 控制台

- R4.1 `node:http` 后端 + JSON API；前端 Preact + htm，以 vendored ESM 放入仓库，无构建步骤。
- R4.2 默认监听 `127.0.0.1`；`console.host` 可开到局域网（http 明文，启动时警告）；HTTPS 由 nginx/Caddy 反代，CLI 不处理 TLS。
- R4.3 访问鉴权：`pdd console link [--account <slug>]` 每次生成一次性 token，10 分钟有效，首次打开后绑定会话 Cookie；所有机密只写。
- R4.4 首版功能：账号状态（会话、是否有密码、熔断及原因）、录入/清除密码、交互式重登（接管视图）、扫码兜底、解除熔断。
- R4.5 浏览器接管：CDP `Page.startScreencast` 经 SSE 推 JPEG 帧；触点坐标与时间戳 50ms 一批 POST 回传，服务端按原始间隔用 `Input.dispatchMouseEvent` 重放；文字输入单独接口；不引入 `ws`。接管窗口最长 10 分钟，浏览器由 daemon 持有并在结束后关闭。
- R4.6 扫码兜底：控制台“改用扫码登录”，二维码可长按保存后由商家版 App 相册识别。

### R5 通知与 Agent 协作

- R5.1 拉取式通知：`meta.warnings` 附 `account_action_required` / `daemon_not_running` 结构化条目；LLM 据此执行 `pdd console link` 转发链接。可选在 Hermes 侧配置 cronjob 主动推送，pdd-cli 不耦合 Hermes。
- R5.2 `account list` 增加 `has_password`、`password_relogin_status`，遵循 data 契约 v2 中文标签。
- R5.3 更新 `skills/pdd-cli/SKILL.md`：遇到 `E_AUTH_HUMAN_REQUIRED` / `account_action_required` 执行 `pdd console link`；任何情况下都不在聊天中索要密码；接管失败或熔断时走扫码兜底。

### R6 文档与发布

- R6.1 删除 AGENTS.md 中 “Do not introduce an auth daemon or automatic background launch” 规则。
- R6.2 新增 `docs/adr/0003`：记录 daemon 先删后加的理由（旧守护只做定时刷新且无效；新 daemon 承载控制台、巡航与重登）。
- R6.3 版本升至 `0.2.0`，`CHANGELOG.md` 写 BREAKING 一节（存储改 SQLite 不迁移、删除的环境变量、新增 daemon/控制台/密码重登、`engines >=24`）。

## 子任务映射

| 顺序 | 子任务 | 覆盖需求 | 依赖 | 状态 |
|---|---|---|---|---|
| ① | `10-27-remove-login-token-consumption` | 清理前置 | 无 | 已完成并归档 |
| ② | `10-27-sqlite-auth-storage` | R2、R6.3 部分 | ① | 进行中：P1–P5 已提交（P1 `f2b8085`、P2 `cca1927`、P3 `a45b800`、P4 `c0668d2`，P5 见 git log），待最终审查与合并 |
| ③ | `10-27-password-relogin-core` | R1、R5.2、R5.3 | ② | 规划中 |
| ④ | `10-27-daemon-console` | R3、R4、R5.1、R6.1、R6.2 | ③ | 规划中 |
| ⑤ | `10-27-session-lifetime-research` | 根因调研 | 无（可并行） | 规划中 |

③④ 的 `design.md` / `implement.md` 依赖 ② 落定的表结构，在 ② 完成后再细化。

## 分工

- 后端代码由 Codex 编写（经 codex 插件委派），Claude 负责审查（规范符合度、契约、安全、测试）与集成验收；规划文档由 Claude 编写。
- 这是用户对全局规则“代码主权：Codex 只负责分析”的显式例外，仅适用于本任务树。
- 控制台前端（Preact + htm）由 Claude 编写（用户 2026-10-27 确认）。

## 跨子任务验收

- [ ] 端到端（fixture 模式）：普通命令遇到会话失效 → 隐式密码重登成功 → 命令成功，全程 stdout 一行 JSON、无密码与 Cookie 泄露。
- [ ] 端到端（fixture 模式）：遇到挑战 → `E_AUTH_HUMAN_REQUIRED` + `pending_actions` → 控制台接管完成 → 后续命令恢复。
- [ ] 熔断触发与解除路径全部可测。
- [ ] `npm test` 全量通过；`test/contract/data-contract-v2.test.js` 覆盖所有新增/变更命令。
- [ ] 真实账号验证（需逐项授权）：③ 的挑战观察实验（≤3 次登录，遇滑块即停）；④ 的触屏轨迹过滑块、SSE 延迟、Linux 下 Hermes systemd cgroup 影响、强杀后 Chromium 残留。
- [ ] 文档：ADR 0003、CHANGELOG BREAKING、AGENTS.md 规则删除、`skills/pdd-cli/SKILL.md` 更新均已完成。

## Out of Scope

- 自动破解滑块或其他验证码。
- 开机自启、OS 服务注册（Task Scheduler / systemd 模板）。
- CLI 内置 TLS、隧道管理。
- 旧数据迁移。
- 缓存类数据（发布源缓存、抓取冷却、限流状态）入库。
- 主动“保活”刷新凭据（等待 ⑤ 的结论）。
