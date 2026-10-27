# 设计：daemon 与人工接管控制台

需求见同目录 `prd.md`（N1–N27 与"决策"一节）。本文只写技术方案。代码事实来自 2026-10-27 对 HEAD `894bf94` 的查证。

## 1. 现状与约束

- 租约（`src/infra/leases.js`）：同主机且 pid 存活时永不过期，`heartbeat_at` 只写不读；只有 `scope='account'` 在用。N3 的"90 秒未心跳即过期"需要新规则。
- 库结构为 `user_version = 1`，`migrate()` 遇到更高版本即拒绝运行；新增表必须走 v2 迁移。
- 日志只有 `log/cli/YYYY-MM-DD.log` 按天轮转一种文件通道；`createLogger({ channel })` 可加分支。旧 daemon 通道是 `log/daemon/`（`aecc0ae` 删除）。
- 配置是扁平的严格 schema，不支持 `console.host` 这类嵌套键。
- 没有不开浏览器就能检查已存账号的函数；spec 规定 checkLogin 的 Cookie 必须由浏览器挑选（`auth-mall-context.md` 第 3 节）。
- 普通 needsAuth 命令本身已在 Node https 与 Chromium 之间交替使用同一份 Cookie（`single-lifecycle.js` 校验 → 业务 → 回写前再校验）。
- `reloginInCommand` 遇到挑战会关闭页面，`decideRelogin` 拒绝 `awaiting_human`；控制台需要单独的交互式流程。`attemptPasswordLogin` 不关页面，可直接复用。
- `markManualLoginSucceeded` 不清零 `consecutive_takeover_timeouts`。
- 仓库中没有 `node:http`、SSE、CDP 代码，也没有前端依赖。Patchright 提供 `context.newCDPSession(page)`。
- `bin/pdd.js` 只处理 SIGINT/SIGTERM，不强制退出；没有遗留 Chromium 清理。
- 现有测试和文档明确断言"没有 daemon"：`test/e2e/merchant-auth.e2e.test.js:17,46,53-58`、`test/infra/retired-auth-schedule.test.js`、`auth-mall-context.md` 第 8 节多处、README、SKILL.md、AGENTS.md:34。

## 2. 模块划分

| 模块 | 层 | 职责 |
| --- | --- | --- |
| `src/infra/db.js` | infra | v2 迁移：`console_tokens`、`console_sessions` |
| `src/infra/leases.js` | infra | `staleBy: 'heartbeat'` 规则（daemon 租约） |
| `src/infra/daemon-state.js`（新） | infra | daemon 租约读写、心跳、停止请求、最近巡航时间（`meta` 表） |
| `src/infra/logger.js` / `paths.js` | infra | `channel: 'daemon'` → `log/daemon/YYYY-MM-DD.log` |
| `src/infra/config.js` | infra | 扁平新键（第 9 节） |
| `src/adapter/browser.js` | adapter | 启动参数加归属标记；按标记清理遗留 Chromium |
| `src/adapter/takeover.js`（新） | adapter | CDP 画面与输入：screencast、鼠标重放、文字/按键 |
| `src/services/console-auth.js`（新） | services | 一次性 token、会话签发与校验（只存 sha256） |
| `src/services/console-login.js`（新） | services | 交互式重登与扫码兜底会话（租约内、设备延续、提交候选） |
| `src/services/patrol.js`（新） | services | 巡航：逐账号走普通命令同一条校验/重登路径 |
| `src/services/password-relogin.js` | services | 导出 `deviceState`；`markManualLoginSucceeded` 清零接管超时计数 |
| `src/daemon/`（新） | commands 同级的进程入口 | 守护循环、HTTP 服务、路由、SSE、静态文件 |
| `src/console/public/`、`src/console/vendor/`（新） | 前端 | Preact + htm 单页，vendored ESM（Claude 编写） |
| `src/commands/daemon.js`、`console.js` + `registry/` | commands | `daemon start/stop/status/run`、`console link` |
| `src/commands/runner/*` | commands | `daemon_not_running` 警告 |

依赖方向保持 `commands → services → adapter → infra`。`src/daemon/` 是进程入口，只调 services，地位等同 commands。

## 3. 存储

### 3.1 v2 迁移

```sql
CREATE TABLE console_tokens (
  token_hash TEXT PRIMARY KEY,          -- sha256(token) hex，原文不落库
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,  -- --account 时有值
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
);
CREATE TABLE console_sessions (
  session_hash TEXT PRIMARY KEY,        -- sha256(cookie 值)
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
```

- `migrate()`：拒绝阈值改为 `> 2`；`< 1` 执行 V1；`< 2` 执行 V2 增量，`user_version = 2`。旧版本程序遇到 v2 库按现有规则拒绝运行。
- 过期行由 daemon 每次心跳顺带删除。
- `meta` 键：`daemon_stop_requested_at`、`daemon_last_patrol_at`、`daemon_console_url`。

### 3.2 daemon 租约

- `scope='daemon'`、`key='main'`。`acquireLease('daemon', 'main', { staleBy: 'heartbeat', ttlMs: 90_000, timeoutMs: 0 })`：拿不到立即返回。
- `staleBy: 'heartbeat'` 时只看 `expires_at`，同主机 pid 存活也按过期处理。其余 scope 行为不变。
- 心跳每 30 秒 `renewLease(..., { ttlMs: 90_000 })`。心跳失败（`E_AUTH_LOCK_LOST`）说明已被接管，daemon 立即退出。
- 账号租约的 pid 复用阻塞仍不处理：普通命令没有心跳，无法按心跳判定。在 `sqlite-storage.md` 保留记录。

## 4. daemon 生命周期

### 4.1 命令

| 命令 | 行为 |
| --- | --- |
| `daemon start` | 租约有效 → 返回当前状态（exit 0）。否则 `spawn(process.execPath, [bin, 'daemon', 'run'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref()`，每 200ms 读租约，10 秒内出现心跳即返回 `{ pid, console_url, started: true }`；超时 `E_DAEMON_START_TIMEOUT`（exit 1） |
| `daemon stop` | 写 `daemon_stop_requested_at`；每 500ms 查租约，释放即返回。15 秒后仍持有且 `hostname` 等于本机、心跳未过期 → 按租约 pid 强杀，然后删除租约行。其他主机的租约只报告，不杀 |
| `daemon status` | `{ running, pid, started_at, heartbeat_at, last_patrol_at, console_url, patrol_enabled }`，时间按契约 v2 转本地时间 |
| `daemon run` | 前台运行（调试用，也是 start 拉起的入口） |

- 全部 `needsAuth: false`，输出遵循 data 契约 v2（`headline` 等），并加入契约测试。
- Windows 上若 `detached + windowsHide` 被宿主进程（Hermes）一并结束，改用旧实现的 `powershell Start-Process -WindowStyle Hidden`；以 N26/N27 真机验证结果为准。

### 4.2 run 主循环

1. `createLogger({ channel: 'daemon' })`。
2. 抢租约，失败则 exit 0（N3）。
3. 清理遗留 Chromium（第 4.3 节）。
4. 启动 HTTP 服务（第 5 节），写 `daemon_console_url`。
5. 定时器：心跳 30s（顺带检查停止请求、清理过期 token/会话）；巡航（第 8 节，默认关闭）。
6. 退出：停止请求、心跳丢失或信号 → 关闭所有接管会话与浏览器、`server.close()`、释放租约；5 秒硬超时后 `process.exit()`。
- 信号：SIGINT、SIGTERM、SIGBREAK（win32）、SIGHUP（非 win32）。不依赖优雅退出（N4）：所有状态写入都是短事务，租约靠 TTL 过期。

### 4.3 遗留 Chromium 清理

- daemon 启动的浏览器带启动参数 `--pdd-cli-daemon=<lease-token-prefix>`（`launchBrowser({ ownerTag })`）。
- 启动时枚举命令行含 `--pdd-cli-daemon=` 的进程并结束：Linux 读 `/proc/*/cmdline`；Windows 用 `powershell -NoProfile Get-CimInstance Win32_Process`（`execFileSync`，`windowsHide`）。只匹配该标记，不碰用户自己的浏览器。
- 普通命令的浏览器不带标记，不受影响。

## 5. 控制台服务

### 5.1 HTTP

- `node:http`，监听 `consoleHost:consolePort`（默认 `127.0.0.1:47821`）。非回环地址启动时日志警告并在 `daemon start` 的 `meta.warnings` 附 `console_plaintext_http`。
- 外部访问地址：`consolePublicUrl` 有值时用它（反代场景），否则 `http://<host>:<port>`。
- 防 DNS rebinding：`Host` 头必须等于监听地址或 `consolePublicUrl` 的 host，否则 421。
- 状态变更接口只接受 `POST` + `Content-Type: application/json` + 头 `X-PDD-Console: 1`；会话 Cookie `SameSite=Strict`，共同防 CSRF。
- 响应统一 `Cache-Control: no-store`；JSON 体经白名单视图生成，不含密码、Cookie、token、登录名。请求体上限 64 KiB。
- 静态文件只从 `src/console/public` 与 `src/console/vendor` 读取，规范化路径后校验前缀。

### 5.2 访问鉴权（N13–N15）

- `pdd console link [--account <slug>]`（复用全局 `--account`）：
  - daemon 未运行 → `E_DAEMON_NOT_RUNNING`（exit 1），hint `执行 pdd daemon start`；
  - 否则生成 32 字节随机 token（base64url），写 `console_tokens`（10 分钟），输出 `data.url = <base>/c/<token>`、`expires_at`。
- `GET /c/<token>`：同一事务内校验未过期、未消费 → 标记 `consumed_at`、签发会话（32 字节随机值，8 小时），`Set-Cookie: pdd_console=<v>; HttpOnly; SameSite=Strict; Path=/`（`consolePublicUrl` 为 https 时加 `Secure`），302 到 `/`（带 `--account` 时到该账号页）。重放、过期 → 410 页面，提示重新获取链接。
- 其余所有接口要求有效会话，否则 401。会话不续期。
- `--account` 只决定落地页；会话可以操作所有账号（同一 OS 用户的单人工具，威胁模型只防意外暴露）。

### 5.3 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 无需会话：`{ ok, lease: 'valid', heartbeat_at, last_patrol_at }`（N12） |
| GET | `/api/accounts` | 每个商家账号：slug、显示名、会话状态（最近一次校验结论标签）、`has_password`、`password_relogin_status`、open 待办 |
| POST | `/api/accounts/:slug/password` | `{ login_name, password }` → `setAccountPassword`；响应只回 `{ ok, has_password: true }` |
| POST | `/api/accounts/:slug/password/clear` | `clearAccountPassword` |
| POST | `/api/accounts/:slug/unblock` | `clearReloginBlock` |
| POST | `/api/accounts/:slug/relogin` | 开始交互式重登，返回 `{ session_id }`（第 6 节） |
| POST | `/api/accounts/:slug/qr` | 开始扫码登录，返回 `{ session_id }` |
| GET | `/api/sessions/:id` | `{ state, message, remaining_seconds, expires_at, qr_image }`。state：`filling` / `takeover` / `qr` / `verifying` / `succeeded` / `failed` / `timed_out` / `cancelled`；`message` 为中文说明或 null；`qr_image` 为 data URL，仅扫码态 |
| POST | `/api/sessions/:id/qr/refresh` | 扫码态下重新截取二维码 |
| GET | `/api/sessions/:id/frames` | SSE：`event: frame`，`data: { jpeg: <base64>, width, height }` |
| POST | `/api/sessions/:id/pointer` | `{ events: [{ t, type: 'down'|'move'|'up', x, y }] }`，x/y 为 0–1 归一化坐标 |
| POST | `/api/sessions/:id/text` | `{ text }` 或 `{ key: 'Enter'|'Backspace'|'Tab' }` |
| POST | `/api/sessions/:id/cancel` | 结束会话 |

- 同一账号同时只允许一个会话；新开会话前先结束旧会话。全 daemon 同时最多 2 个浏览器会话，超出返回 429。
- `password` 只在 `setAccountPassword` 调用前存在于请求处理函数的局部变量里；不记录请求体，日志中间件只记方法、路由模板、状态码、耗时。

## 6. 交互式重登与接管（N18–N21）

### 6.1 流程 `startConsoleRelogin(accountId, { mode: 'password' | 'qr' })`

在 `provisionMerchantLogin` 同一模式下运行：`withMerchantAuthUpdate(accountId, (tx) => …, { recoveryMallId: account.identity, deadlineAt: now + 12 分钟 })`，会话全程持有账号租约（其他命令按原 15 秒等待后 `E_LOCK_TIMEOUT`）。

1. 前置：状态为 `blocked` 时拒绝（`E_AUTH_RELOGIN_BLOCKED`），页面引导先重设密码或解除熔断。`mode: 'password'` 且没有密码时拒绝。
2. `launchBrowser({ ownerTag })` 后用 `createSnapshotContext(browser, deviceState(tx))` 建设备延续上下文（③ 的规则：去掉全部 `PASS_ID`；corrupt 时空上下文）。
3. password 模式：`attemptPasswordLogin(page, loadPasswordCredential(...), { signal, deadlineAt: now + 70s })`。
   - success → 第 5 步。
   - challenge → 进入接管（6.2）。提交本身已触发短信，页面提示"验证码已发送到绑定手机"。
   - wrong_password / account_locked → `recordReloginOutcome` 写熔断，会话 `failed`。
   - form_changed / network_error → 进入接管（人工直接在页面上操作），不写熔断。
4. qr 模式：在同一上下文打开扫码页，`captureQrElement` 取 PNG，转 data URL 下发；页面提供"刷新二维码"（重新截取），总时长沿用 `TIMEOUTS.LOGIN_QR`（3 分钟），超时可重新开始。
5. 轮询 `hasPassId(context.cookies([MERCHANT_CHECK_URL]))`；出现后关闭页面，`verifyMerchantContext(context, { expectedMallId: tx.recoveryMallId })`，必须 `verified`，然后走 `saveMerchantLogin` 提交（含 `markManualLoginSucceeded`）。password 模式另记 `recordReloginOutcome(tx, { outcome: 'success' })`，清零计数并关闭 `human_takeover`。
6. 接管窗口 10 分钟到期仍未成功 → `recordTakeoverTimeout(accountId)`（连续 2 次熔断），会话 `timed_out`。
7. 无论结果都关闭浏览器；身份不一致 → `E_ACCOUNT_IDENTITY_MISMATCH`，不提交。

- 这条流程由用户在控制台主动发起，不经过 `decideRelogin`（不受限频和 `awaiting_human` 拦截）；熔断检查保留。
- `markManualLoginSucceeded` 改为同时清零 `consecutive_takeover_timeouts`：任何一次人工登录成功都打断"连续"。

### 6.2 接管通道（`src/adapter/takeover.js`）

- `openTakeover(page) -> { frames: AsyncIterable, dispatchPointer(events), insertText(text), pressKey(key), close() }`。
- 画面：`cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, everyNthFrame: 1 })`，收到 `Page.screencastFrame` 后立即 `screencastFrameAck`；SSE 侧节流到约 5 fps，只保留最新一帧（慢连接丢帧不积压）。
- 指针：按 `t` 的原始间隔重放 `Input.dispatchMouseEvent`（`down` → `mousePressed`，`move` → `mouseMoved`（按下时 `buttons: 1`），`up` → `mouseReleased`），坐标 = 归一化值 × 帧元数据中的 `deviceWidth/deviceHeight`。同一会话的批次串行执行。
- 文字：`Input.insertText`；按键：`Input.dispatchKeyEvent`（keyDown/keyUp）。
- 不引入 `ws`；单条 SSE 连接 + 普通 POST。

### 6.3 fixture

- `isMockEnabled()` 时 `startConsoleRelogin` 不启动浏览器：结果由 `PDD_TEST_PASSWORD_LOGIN` 决定；进入接管后 `frames` 输出固定的 1×1 JPEG。
- 接管结束由测试专用接口 `POST /api/sessions/:id/fixture-complete { outcome: 'success' | 'timeout' }` 驱动，该路由只在 fixture 模式注册。
- 成功时提交带 `PDD_FIXTURE_RELOGIN=1` 标记的登录态（与 ③ 的 fixture 提交一致）。

## 7. 普通命令的 `daemon_not_running`（N6）

- `appendActionWarnings` 在追加 `account_action_required` 时，若 daemon 租约无效，再追加一条 `{ code: 'daemon_not_running' }`（每个 envelope 最多一条）。
- 只在当前账号有 open 待办时提示：没有待人工事项时 daemon 没有作用，避免每条命令都带噪声。
- `needsAuth: false` 命令不附加。

## 8. 巡航（N7–N9，默认关闭）

- `patrolEnabled`（默认 `false`）、`patrolIntervalMs`（默认 `1_800_000`），间隔 ±20% 抖动。
- 每轮依次处理未停用的商家账号：复用普通命令同一条校验路径——`withMerchantAuthUpdate` → `withBrowser({ storageState: tx.state, ownerTag })` → `verifyStoredMerchant`；`rejected` 时 `reloginInCommand`（遵守熔断、限频、租约）；校验结论按现有规则 `recordMerchantCheck`。拿不到账号租约就跳过该账号（`timeoutMs: 0`），不阻塞用户命令。
- 不访问业务接口，不打开首页。每轮结束写 `daemon_last_patrol_at`。
- 选择浏览器路径的理由：与普通命令的请求形态完全同构，不新增"只有 Node 直连"的节奏（⑤ 的 H1），也无需修改"Cookie 由浏览器挑选"的 spec。
- ⑤ 有结论后再评估默认值与请求方式。

## 9. 配置

| 键 | env | 默认 | 说明 |
| --- | --- | --- | --- |
| `consoleHost` | `PDD_CONSOLE_HOST` | `127.0.0.1` | 监听地址 |
| `consolePort` | `PDD_CONSOLE_PORT` | `47821` | 1–65535 |
| `consolePublicUrl` | `PDD_CONSOLE_PUBLIC_URL` | `""` | 反代后的外部地址，空表示按监听地址生成 |
| `patrolEnabled` | `PDD_PATROL_ENABLED` | `false` | |
| `patrolIntervalMs` | `PDD_PATROL_INTERVAL_MS` | `1800000` | ≥ 300000 |

默认值只写在 `config/config.example.json`，`config set` 可修改。

## 10. 错误码

| code | exit | 场景 |
| --- | --- | --- |
| `E_DAEMON_NOT_RUNNING` | 1 | `console link` 时 daemon 未运行 |
| `E_DAEMON_START_TIMEOUT` | 1 | `daemon start` 10 秒内未见心跳 |
| `E_DAEMON_STOP_TIMEOUT` | 1 | 强杀后租约仍未释放，或租约属于其他主机 |
| `E_CONSOLE_PORT_IN_USE` | 1 | 监听失败（EADDRINUSE），daemon 释放租约后退出 |

控制台 API 错误用 HTTP 状态 + `{ error: { code, message } }`，code 复用以上与现有错误码，message 为中文。

## 11. 日志

- `channel: 'daemon'` → `log/daemon/YYYY-MM-DD.log`，复用 `DailyRotatingFileDestination` 与全部脱敏规则；`daemon run`（前台）同时写 stderr。
- 与 PRD N5 的差异：沿用仓库现有的按天轮转与 `log/` 目录（`data/` 只放库和密钥），不实现按大小轮转。
- 新增脱敏键：`token`、`session`、`pdd_console`、`qr_image`、`jpeg`（固定 `[REDACTED]` 的放入 `SECRET_KEYS`：`token`、`pdd_console`）。

## 12. 前端（Claude 编写）

- `src/console/vendor/`：`preact.module.js`、`hooks.module.js`、`htm.module.js`（固定版本，附 LICENSE 与来源 URL、sha256），`index.html` 用 import map 指向本地文件。
- 页面：账号列表 → 账号详情（录入/清除密码、解除熔断、开始重登、改用扫码）→ 会话视图（画面 `<img>` 由 SSE 帧刷新；`pointer` 事件按 50ms 打包；文字框 + 回车/退格按钮；倒计时；扫码态显示二维码，可长按保存）。
- 移动端优先；密码输入框 `autocomplete="off"`，提交后清空，从不回填。
- `knip.json` 忽略 `src/console/vendor/**`；`.trellis/spec/frontend/index.md` 由"N/A"改为指向控制台约定。

## 13. 测试

- 单元：
  - v2 迁移与降级拒绝；
  - `staleBy: 'heartbeat'`（同主机活 pid 也过期、其他 scope 不变）；
  - token/会话：重放、过期、未绑定、哈希存储；
  - Host 校验、CSRF 头、请求体上限、静态路径穿越；
  - 指针坐标映射与重放顺序（fake CDP）；
  - `markManualLoginSucceeded` 清零计数；
  - 巡航跳过被占用账号、默认关闭；
  - 遗留进程枚举只匹配标记。
- e2e（fixture，临时 `PDD_DB_PATH`，随机端口）：
  - `daemon start` 两次只一个实例；`status`；`stop`；
  - 杀掉 daemon 进程后 90 秒内租约过期（测试中用短 TTL 覆盖）并可再次 start；
  - `console link` → 打开链接 → 会话 → `/api/accounts`；重放 410；
  - 录入密码后 API 响应、日志文件、stdout 中均无密码；
  - 挑战 → 接管 → fixture-complete success → `pending_actions` 关闭 → 普通命令成功；
  - 接管超时两次 → 熔断；
  - 普通命令在有 open 待办且 daemon 未运行时带 `daemon_not_running`。
- 契约：`daemon start/stop/status`、`console link` 加入 `data-contract-v2.test.js`。
- 更新断言"没有 daemon"的旧测试。

## 14. 文档与 spec（Claude）

- AGENTS.md 删除第 34 行的禁止规则；`docs/adr/0003-resident-daemon-console.md`（0002 的格式）。
- README、`skills/pdd-cli/SKILL.md`（daemon/console 用法、`daemon_not_running` 处理、局域网风险、反代示例）、CHANGELOG Unreleased。
- spec：`auth-mall-context.md`（第 8 节"不得重引入后台"改写，新增控制台登录场景）、`sqlite-storage.md`（v2、daemon 租约规则）、`logging-redaction.md`、`env-paths.md`、`envelope-errors-output.md`、`runner-lifecycle.md`、`fixture-mode.md`、`frontend/index.md`、`commands/command-contracts.md`。
- 父任务 PRD：R1.4 与背景中"短信需点击后才发送"改正；R6.3 版本号过时（当前 0.5.0）。

## 15. 回滚

各阶段独立提交。daemon 与控制台都是新增入口，回滚只需撤销对应提交；v2 迁移不可降级，回滚到 v1 程序需要删库重新登录（与 0.5.0 升级说明一致，写入 CHANGELOG）。
