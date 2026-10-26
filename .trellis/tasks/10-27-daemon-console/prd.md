# daemon 与人工接管控制台

## Goal

提供一个常驻的 `pdd daemon`，托管 Web 控制台并定时巡航账号。所有需要人工的操作（录入密码、通过挑战、扫码登录、解除熔断）都集中在控制台完成，不经过 LLM 对话。

父任务：`10-27-password-relogin-console`。本任务是子任务 ④，依赖 ③。

## Requirements

### daemon 生命周期

- N1 新增 `pdd daemon start / stop / status / run`。
  - `start`：检查 daemon 租约，已在运行就返回状态；否则以 `detached` + `windowsHide` 方式拉起 `pdd daemon run` 并 `unref()`，最多等 10 秒看到心跳后返回 envelope（含 pid、控制台地址）。
  - `stop`：在数据库中写入停止请求，daemon 轮询到后自行退出；15 秒未退出则按租约中记录的 pid 强杀。
  - `status`：返回租约状态、最近一次巡航时间。
  - `run`：前台运行，供调试使用。
- N2 不做开机自启，不提供 Task Scheduler / systemd 配置模板，不写 pidfile（pid 存在租约行中）。
- N3 单实例：SQLite daemon 租约，30 秒心跳、90 秒未心跳视为过期；新实例发现有效租约即以退出码 0 退出。
- N4 按“随时会被强杀”设计：不依赖优雅退出；同时监听 `SIGINT / SIGTERM / SIGBREAK / SIGHUP`，尽力清理并设置硬超时；启动时清理上一轮遗留的 Chromium 进程。
- N5 日志固定写 `data/logs/daemon.jsonl`，按 10MB 轮转保留 3 份，沿用 `logger.js` 的脱敏规则（logger 新增文件输出目标）。
- N6 普通命令发现 daemon 租约过期时，只在 `meta.warnings` 附 `daemon_not_running`，不自动拉起。

### 巡航

- N7 默认每 30 分钟（±20% 抖动）对每个账号依次做纯 HTTP `checkLogin` 探测，不启动浏览器。
- N8 发现失效时发起密码重登，复用 ③ 的重登核心，遵守熔断、限频与租约规则；遇到挑战写入 `pending_actions`。
- N9 `patrol.enabled` 与间隔可通过配置修改（⑤ 的结论可能要求调整默认值）。

### 控制台服务

- N10 `node:http` 后端，对外提供 JSON API；前端使用 Preact + htm，以 vendored ESM 文件放在 `src/console/vendor/`，无构建步骤。
- N11 默认只监听 `127.0.0.1`；`console.host` 可改为局域网地址，此时启动时警告“http 明文传输”。CLI 不处理 TLS，HTTPS 由 nginx/Caddy 反代。
- N12 提供 `GET /healthz`，返回最近一次巡航时间与租约状态。

### 访问鉴权

- N13 `pdd console link [--account <slug>]` 每次生成一次性高熵 token（10 分钟有效），输出完整访问链接。
- N14 首次打开后绑定会话 Cookie，链接随即失效；会话有过期时间。
- N15 所有机密只写：页面能录入或清除密码，但永远不回显已保存的值；API 响应中不含任何密码、Cookie 或 Token。

### 控制台功能（首版）

- N16 账号列表：会话状态、是否有密码、熔断状态与原因、待人工事项。
- N17 录入和清除密码（写入 ② 的凭据表；清除时同时解除熔断）。
- N18 交互式重登：点击“开始重登” → daemon 按需拉起浏览器，自动填入账号和密码 → 出现挑战时进入浏览器接管视图 → 检测到登录成功后核验并保存，清除对应的 `pending_actions`。
- N19 浏览器接管：
  - 画面通过 CDP `Page.startScreencast` 获取，用 SSE 推送 JPEG 帧（局域网约 5 fps）。
  - 触点坐标与时间戳每 50ms 一批 POST 回传，服务端按原始间隔用 `Input.dispatchMouseEvent` 重放；文字输入走单独接口。
  - 不引入 `ws`。
  - 接管窗口最长 10 分钟；超时计入 ③ 的“接管超时连续 2 次”熔断计数。
  - 浏览器由 daemon 持有，结束后关闭。
- N20 扫码兜底：“改用扫码登录”按钮在页面上显示二维码，支持长按保存，再由商家版 App 从相册识别。
- N21 解除熔断。

### 文档

- N22 删除 AGENTS.md 中 “Do not introduce an auth daemon or automatic background launch” 规则。
- N23 新增 `docs/adr/0003`：记录 daemon 先删后加的理由（旧守护只做定时刷新且无效；新 daemon 承载控制台、巡航与重登）、自行后台化的取舍与已知边界（重启后需手动启动）。
- N24 更新 README 与相关 skill，说明 daemon 和控制台的用法、局域网暴露风险以及反代方式。

### 真机验证（逐项授权）

- N25 手机触屏轨迹映射为鼠标事件后，PDD 滑块是否认可；SSE 画面延迟够不够拖准。
- N26 Linux 上 Hermes 作为 systemd 服务运行时，后台 daemon 会不会随 Hermes 重启被一起杀掉（必要时文档给出 `systemd-run --user --scope` 方案）。
- N27 node 被强杀后，Chromium 子进程是否残留。

## Acceptance Criteria

- [ ] `start / stop / status / run` 在 Windows 与 Linux 上行为一致；重复 `start` 不会产生第二个实例。
- [ ] 强杀 daemon 后，租约在 90 秒内过期，再次 `start` 能正常接管。
- [ ] 巡航不启动浏览器；发现失效后的重登遵守熔断、限频与租约规则。
- [ ] 一次性 token：重放、过期、未绑定的会话均被拒绝。
- [ ] API 与页面中都读不到已保存的密码（自动化测试断言响应体）。
- [ ] fixture 模式下：挑战 → 接管 → 登录成功 → `pending_actions` 清除，整条流程可测。
- [ ] 日志轮转生效，日志中不含机密。
- [ ] N25～N27 的真机验证结果已记录。
- [ ] ADR 0003、AGENTS.md、README、skill 均已更新。
- [ ] `npm test` 全量通过。

## Notes

- 后端代码由 Codex 编写，Claude 审查；控制台前端由 Claude 编写。
- `design.md` 与 `implement.md` 在 ③ 完成后编写。
