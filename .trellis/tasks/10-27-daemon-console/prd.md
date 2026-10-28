# daemon 与人工接管控制台

## Goal

提供一个常驻的 `pdd daemon`，托管 Web 控制台，并可选地定时巡航账号。所有需要人工的操作（录入密码、通过挑战、扫码登录、解除熔断）都集中在控制台完成，不经过 LLM 对话。

父任务：`10-27-password-relogin-console`。本任务是子任务 ④，依赖 ③（已合并，`4b28bce`）。

## 背景

- ③ 已提供密码凭据、重登状态机与待办，以及为本任务预留的 `setAccountPassword` / `clearAccountPassword` / `clearReloginBlock` / `recordTakeoverTimeout` / `getReloginSummary`。
- ③ 的真实实验：提交账密本身就会触发短信；空白上下文必要求短信；设备信任需要人工在同一设备状态下先完成一次短信验证。本任务的接管视图承担这一步。
- 普通 needsAuth 命令已在 Node https 与 Chromium 之间交替使用同一份 Cookie；⑤ 的首要假设 H1 怀疑这种交替会导致会话被踢。
- 技术现状与差异见 `design.md` 第 1 节。

## 决策（2026-10-27）

- D1 巡航：实现，但 `patrolEnabled` 默认 `false`；开启后走普通命令同一条浏览器校验路径，不做纯 HTTP 探测（用户确认）。⑤ 出结论后再评估默认值。
- D2 日志沿用仓库约定：`log/daemon/YYYY-MM-DD.log` 按天轮转（替代 PRD 初稿的 `data/logs/daemon.jsonl` + 10MB 轮转；`data/` 只放库与密钥）。
- D3 配置使用扁平键：`consoleHost`、`consolePort`、`consolePublicUrl`、`patrolEnabled`、`patrolIntervalMs`（现有配置不支持嵌套键）。
- D4 `daemon_not_running` 只在当前账号有 open 待办时附加，避免没有待办时每条命令都带噪声。
- D5 控制台交互式重登由用户主动发起，不受限频与 `awaiting_human` 拦截，但熔断仍需先解除；人工登录成功清零"接管超时"连续计数。
- D6 账号租约的 pid 复用阻塞继续保留为已知问题（普通命令没有心跳，无法按心跳判定）；心跳过期规则只用于 daemon 租约。

## Requirements

### daemon 生命周期

- N1 新增 `pdd daemon start / stop / status / run`。
  - `start`：租约有效就返回状态；否则以 `detached` + `windowsHide` 拉起 `pdd daemon run` 并 `unref()`，最多等 10 秒看到心跳后返回 envelope（含 pid、控制台地址）。
  - `stop`：在数据库中写入停止请求，daemon 轮询到后自行退出；15 秒未退出则按租约中记录的 pid 强杀（仅限本机且心跳未过期的租约）。
  - `status`：返回租约状态、最近一次巡航时间、控制台地址、巡航是否开启。
  - `run`：前台运行，供调试使用。
- N2 不做开机自启，不提供 Task Scheduler / systemd 配置模板，不写 pidfile（pid 存在租约行中）。
- N3 单实例：SQLite daemon 租约，30 秒心跳、90 秒未心跳视为过期（同主机 pid 存活也按心跳判定）；新实例发现有效租约即以退出码 0 退出。
- N4 按"随时会被强杀"设计：不依赖优雅退出；监听 `SIGINT / SIGTERM / SIGBREAK / SIGHUP`，尽力清理并设 5 秒硬超时；启动时清理上一轮遗留的 daemon 所属 Chromium 进程（按启动参数标记识别，不碰其他浏览器）。
- N5 日志写 `log/daemon/YYYY-MM-DD.log`，按天轮转，沿用 `logger.js` 的脱敏规则（D2）。
- N6 普通命令发现 daemon 未运行且当前账号有 open 待办时，在 `meta.warnings` 附 `daemon_not_running`，不自动拉起（D4）。

### 巡航

- N7 `patrolEnabled` 开启时，默认每 30 分钟（±20% 抖动）依次检查每个未停用的商家账号，走普通命令同一条校验路径（无头浏览器挑选 Cookie，不访问业务接口）（D1）。
- N8 发现失效时发起密码重登，复用 ③ 的重登核心，遵守熔断、限频与租约规则；账号租约被占用就跳过该账号。
- N9 `patrolEnabled`（默认 `false`）与 `patrolIntervalMs`（默认 30 分钟，不小于 5 分钟）可通过配置修改。

### 控制台服务

- N10 `node:http` 后端，对外提供 JSON API；前端使用 Preact + htm，以 vendored ESM 文件放在 `src/console/vendor/`，无构建步骤。
- N11 默认只监听 `127.0.0.1:47821`；`consoleHost` 可改为局域网地址，此时启动时警告"http 明文传输"。CLI 不处理 TLS，HTTPS 由 nginx/Caddy 反代，`consolePublicUrl` 指定反代后的外部地址。
- N12 提供 `GET /healthz`，返回最近一次巡航时间与租约状态。

### 访问鉴权

- N13 `pdd console link [--account <slug>]` 每次生成一次性高熵 token（10 分钟有效），输出完整访问链接；daemon 未运行时返回 `E_DAEMON_NOT_RUNNING` 并提示 `pdd daemon start`。
- N14 浏览器打开后通过脚本 POST 兑换并绑定会话 Cookie（HttpOnly、SameSite=Strict），兑换后链接失效；GET 预览保持 token 未消费，避免 Telegram 等聊天应用预取损耗链接。会话 8 小时过期，token 与会话只存哈希。
- N15 所有机密只写：页面能录入或清除密码，但永远不回显已保存的值；API 响应与日志中不含任何密码、登录名、Cookie 或 token。
- N15a 校验 `Host` 头（防 DNS rebinding）；状态变更接口要求 JSON + 自定义请求头（防 CSRF）。

### 控制台功能（首版）

- N16 账号列表：会话状态、是否有密码、熔断状态与原因、待人工事项。
- N17 录入和清除密码（写入凭据表；重设密码同时解除熔断）。
- N18 交互式重登：点击"开始重登" → daemon 拉起浏览器，从设备延续的上下文（已保存状态去掉 `PASS_ID`）自动填入账号和密码 → 出现挑战时进入接管视图 → 检测到登录成功后核验并保存，清除对应的 `pending_actions`（D5）。
- N19 浏览器接管：
  - 画面通过 CDP `Page.startScreencast` 获取，用 SSE 推送 JPEG 帧（局域网约 5 fps，慢连接只保留最新帧）。
  - 触点坐标与时间戳每 50ms 一批 POST 回传，服务端按原始间隔用 `Input.dispatchMouseEvent` 重放；文字与按键走单独接口。
  - 不引入 `ws`。
  - 接管窗口最长 10 分钟；超时计入 ③ 的"接管超时连续 2 次"熔断计数。
  - 浏览器由 daemon 持有，结束后关闭；同一账号同时只有一个会话，全局最多 2 个。
- N20 扫码兜底："改用扫码登录"在页面上显示二维码，支持长按保存与刷新，再由商家版 App 从相册识别。
- N21 解除熔断。

### 文档

- N22 删除 AGENTS.md 中 "Do not introduce an auth daemon or automatic background launch" 规则，并同步改写断言"没有 daemon"的测试、spec、README 与 skill。
- N23 新增 `docs/adr/0003`：记录 daemon 先删后加的理由（旧守护只做定时刷新且无效；新 daemon 承载控制台、接管与可选巡航）、自行后台化的取舍与已知边界（重启后需手动启动）。
- N24 更新 README 与相关 skill，说明 daemon 和控制台的用法、局域网暴露风险以及反代方式。

### 真机验证（逐项授权）

- N25 手机触屏轨迹映射为鼠标事件后，PDD 滑块是否认可；SSE 画面延迟够不够拖准。
- N26 Linux 上 Hermes 作为 systemd 服务运行时，后台 daemon 会不会随 Hermes 重启被一起杀掉（必要时文档给出 `systemd-run --user --scope` 方案）。
- N27 node 被强杀后 Chromium 子进程是否残留、启动清理是否生效；Windows 下 `detached + windowsHide` 拉起的进程能否存活。
- N27a 在接管视图中完成首次短信验证后，观察同一设备状态下的后续账密重登是否免短信；据接管时看到的页面校准 `PASSWORD_LOGIN_SELECTORS` / `PASSWORD_LOGIN_TEXTS`（③ 的移交项）。

## Acceptance Criteria

- [ ] `start / stop / status / run` 在 Windows 与 Linux 上行为一致；重复 `start` 不会产生第二个实例。（Windows 真机与自动化测试已覆盖；Linux 未在真机运行，随 N26 一起验证）
- [x] 强杀 daemon 后，租约在 90 秒内过期，再次 `start` 能正常接管。
- [x] 巡航默认不运行；开启后走浏览器校验路径，失效后的重登遵守熔断、限频与租约规则。
- [x] 一次性 token：重放、过期、未绑定的会话均被拒绝；Host 不符与缺少 CSRF 头的请求被拒绝。
- [x] API、页面与日志中都读不到已保存的密码或登录名（自动化测试断言响应体与日志文件）。
- [x] fixture 模式下：挑战 → 接管 → 登录成功 → `pending_actions` 清除 → 普通命令成功，整条流程可测；接管超时两次 → 熔断。
- [x] 有 open 待办且 daemon 未运行时，普通命令带 `daemon_not_running`。
- [x] 日志按天轮转，且不含机密。
- [x] N25～N27a 的真机验证结果已记录（N27、N27a 通过；N25、N26 与免短信观察待遇到时补，见 `research/real-device-verification.md`）。
- [x] ADR 0003、AGENTS.md、README、skill、相关 spec 均已更新。
- [x] `npm test` 全量通过，契约测试覆盖 `daemon start/stop/status` 与 `console link`。

## Out of Scope

- 开机自启与 OS 服务注册。
- 内置 TLS、隧道管理。
- 纯 HTTP 巡航探测（等 ⑤ 的结论）。
- 自动破解滑块或其他验证码。
- 多用户与细粒度权限：会话可以操作所有账号（同一 OS 用户的单人工具）。
- 账号租约的心跳续期与 pid 复用处理（D6）。

## Notes

- 后端代码由 Codex 编写，Claude 审查；控制台前端与文档由 Claude 编写。
