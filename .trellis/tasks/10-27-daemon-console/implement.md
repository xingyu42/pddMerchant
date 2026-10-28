# 实施计划：daemon 与人工接管控制台

设计见 `design.md`。后端由 Codex 编写、Claude 审查；前端（P5）与文档（P7）由 Claude 编写。每个阶段独立提交（需验证通过）。

## 分支

`feat/daemon-console`，基于 main（`894bf94` 之后）。

## P1 基础设施

- [x] `db.js` v2 迁移（`console_tokens`、`console_sessions`），拒绝阈值改为 `> 2`；测试 v1 → v2 升级与高版本拒绝。
- [x] `leases.js` 增加 `staleBy: 'heartbeat'`；`timeoutMs: 0` 尝试一次，失败立即抛 `E_LOCK_TIMEOUT`；测试。
- [x] `src/infra/daemon-state.js`：租约读写、心跳、停止请求、`meta` 键读写。
- [x] `logger.js` / `paths.js`：`channel: 'daemon'` → `log/daemon/`；`SECRET_KEYS` 增加 `consoleToken`、`consoleSession`；`REDACT_KEYS` 增加 `qrImage`、`frameJpeg`（审查后由小写键改为 camelCase）。
- [x] `config.js` + `config/config.example.json`：五个扁平键（design 第 9 节）。
- [x] `errors.js`：四个新错误工厂。

验证：`npx vitest run test/infra/`。

P1 执行结果（2026-10-27）：基础设施 13 个测试文件通过，157 项通过、1 项平台跳过；`npm test` 全量 47 个文件通过，793 项通过、1 项平台跳过；`git diff --check` 通过。未提交。

P1 衔接说明：
- `acquireDaemonLease()` 将 `E_LOCK_TIMEOUT` 转为 `null`；其他错误保持抛出。底层租约仍使用异常契约。
- `setDaemonMeta` / `getDaemonMeta` 仅接受 `daemon_last_patrol_at`、`daemon_console_url`，值为字符串；停止请求由专用函数管理（ISO 时间字符串或 `null`）。
- `purgeExpiredConsoleRows(now)` 接受可转换为 Date 的时间，返回 `{ tokens, sessions }` 删除行数，两个表在同一同步事务中清理。
- daemon 错误 detail 只保留正整数 `pid`、1–65535 的整数 `port`，及固定 reason：`foreign_host`、`lease_active`、`kill_failed`、`address_in_use`。
- 脱敏键检索未发现现有固定业务字段冲突；内部 `token` 为租约凭据，`session` 为流程变量。发现动态键风险：批量 `data.accounts` 以 slug 为键，slug 若为五个新增脱敏键之一，该账号整项会被脱敏。已报告；P1 按设计保留脱敏名单，输出结构与 slug 规则保持原样，后续需单独处理。

## P2 daemon 生命周期

- [x] `src/daemon/run.js` 主循环（抢租约、心跳、停止请求、信号、硬超时退出）。
- [x] `browser.js`：`launchBrowser({ ownerTag })` 启动参数标记；`cleanupOrphanBrowsers()`（Linux `/proc`、Windows `Get-CimInstance`、macOS `ps`）。
- [x] `src/commands/daemon.js` + `registry/daemon.js`：`start / stop / status / run`，契约 v2 视图。
- [x] runner：`daemon_not_running` 警告（仅当前账号有 open 待办时，single/batch 每 envelope 一条）。
- [x] 更新断言"没有 daemon"的测试（`merchant-auth.e2e.test.js`、`retired-auth-schedule.test.js`）。
- [x] e2e：重复 start 单实例、status、stop、强杀后短 TTL 过期再 start。

验证：daemon 相关 e2e + `npm test`。

P2 执行结果（2026-10-27）：`npm test` 全量 53 个文件通过，871 项通过、1 项平台跳过。fixture e2e 使用临时库与 `PDD_TEST_DAEMON_LEASE_TTL_MS=3000` / `PDD_TEST_DAEMON_HEARTBEAT_MS=100`；两个覆盖仅在 `isMockEnabled()` 为真时生效。组件接口已预留 `async start()/stop()`，HTTP 服务保留到 P3，`daemon_console_url` 未设置。实现和完整文件清单见 `p2-report.md`；未提交，未修改 `CLAUDE.md`。

## P3 控制台服务与鉴权

- [x] `src/daemon/server.js`：`node:http`、Host 校验、CSRF 头、请求体上限、`no-store`、静态文件前缀校验、`/healthz`。
- [x] `src/services/console-auth.js` + `src/commands/console.js`：`console link`、token 兑换、会话 Cookie。
- [x] 账号 API：列表、录入/清除密码、解除熔断（白名单视图）。
- [x] 测试：token 重放/过期/未绑定、401、421、CSRF、路径穿越；所有响应体与日志不含密码。

验证：`npx vitest run test/daemon/ test/services/console-auth.test.js` + `npm test`。

P3 执行结果（2026-10-28）：最终定向 6 个文件、54 项通过；`npm test` 全量 57 个文件、904 项通过、1 项平台跳过；`git diff --check` 通过。账号列表响应为 `{ items: [...] }`，与并行 P5 前端约定对齐；默认组件启用 HTTP 服务，start 等待地址就绪，停止按租约归属清理地址。详见 `p3-report.md`。未提交，`CLAUDE.md` 保持原样；P4 与 P5 页面仍由后续阶段承接。

## P4 交互式重登、接管、扫码

- [x] `password-relogin.js`：导出 `deviceState`；`markManualLoginSucceeded` 清零接管超时计数。
- [x] `src/adapter/takeover.js`：screencast、指针重放、文字/按键（fake CDP 单测）。
- [x] `src/services/console-login.js`：password / qr 两种模式（design 第 6.1 节），10 分钟窗口、超时计数、熔断前置检查。
- [x] 会话 API 与 SSE；同账号单会话、全局最多 2 个。
- [x] fixture：无浏览器路径 + `fixture-complete` 测试路由。
- [x] e2e：挑战 → 接管 → 成功 → 待办关闭 → 普通命令成功；超时两次 → 熔断。
- [x] 预览安全兑换：GET `/c/:token` 保留 token，外部脚本 POST `/api/redeem` 消费；重放 410。

验证：相关测试 + `npm test`。

P4 执行结果（2026-10-28）：定向 11 个文件、164 项通过；追加触点计时起点重置回归后，接管/SSE 2 个文件、9 项通过。最终 `npm test -- --maxWorkers=2` 全量 62 个文件、944 项通过、1 项平台跳过，`git diff --check` 通过。完整文件清单与接口说明见 `p4-report.md`。前端会话 API 已按现有 `app.js` 对齐；未改 `app.js`、`styles.css`、`index.html` 或 `CLAUDE.md`，未提交。真机验证继续保留在下方列表。

## P5 前端（Claude）

- [x] vendor Preact / hooks / htm（固定版本、LICENSE、来源、sha256）；`knip.json` 忽略。
- [x] 账号列表、账号详情、会话视图（画面、触点 50ms 打包、文字与按键、倒计时、二维码）。
- [x] 在 fixture daemon 上手动走通，截图记录。

## P6 巡航（默认关闭）

- [x] `src/services/patrol.js`：浏览器同构路径、跳过被占用账号、抖动、写 `daemon_last_patrol_at`。
- [x] 测试：默认不运行；开启后按账号依次处理；失效时触发重登并遵守限频。

P6 实现说明：默认组件加入巡航，严格 `patrolEnabled === true` 才运行；首轮先等待，轮次串行。校验通过保留原快照，密码重登成功由既有核心提交；详见 design 第 8 节及 `p6-report.md`。仅 fixture 的 `PDD_TEST_PATROL_INTERVAL_MS` 支持短间隔测试，live 忽略。未提交，未改 `CLAUDE.md` 或 `src/console/`。

P6 验证结果（2026-10-28）：最终定向 6 个文件、120 项通过；`npm test -- --maxWorkers=2` 全量 64 个文件、969 项通过、1 项平台跳过；`git diff --check` 通过。未执行真实账号或浏览器验证。

## P7 文档与 spec（Claude）

- [x] design 第 14 节列出的全部文档与 spec。
- [x] 父任务 PRD 子任务表 ④ 状态；改正 R1.4 与背景中的短信描述。

## 真机验证（逐项获得授权后执行）

- [ ] N25 手机触屏轨迹过滑块、SSE 画面延迟。
- [ ] N26 Linux 下 Hermes 以 systemd 运行时 daemon 是否随之被杀。
- [ ] N27 强杀 node 后 Chromium 是否残留、启动清理是否生效；Windows `detached + windowsHide` 是否存活。
- [ ] 结合 ③ 的移交：在接管视图里完成首次短信验证，观察之后的账密重登是否免短信；校准登录页选择器。

## 最终审查与合并

- [ ] 逐条核对 PRD 验收标准。
- [ ] `trellis-check` 全量检查。
- [ ] 安全审查：控制台鉴权、CSRF/Host、密码只写、日志脱敏、子进程与信号、遗留进程清理只匹配标记。
- [ ] `git diff main...feat/daemon-console` 检查范围。
- [ ] 本地 `--no-ff` 合并到 main，归档任务。

## 风险与回滚点

- v2 迁移不可降级：P1 提交后旧程序拒绝打开新库。
- `src/commands/runner/*` 的警告改动影响所有命令：P2 后跑全量测试。
- Windows 后台化方式取决于 N27；若 `detached` 不可靠，回退到 PowerShell `Start-Process`。
