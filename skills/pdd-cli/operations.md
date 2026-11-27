# 登录失效、控制台与运行环境

遇到退出码 `3` / `5`、`meta.warnings` 含 `account_action_required` / `daemon_not_running`，或需配置 daemon、Web 控制台、代理与排障时读本文件。凭证红线见 SKILL.md「登录失效与运维」，全程适用。

## 错误码与恢复处理

| 看到 | 处理 |
|------|------|
| `E_AUTH_EXPIRED` | 请用户执行 `pdd login`（或 `pdd login --qr`） |
| `E_AUTH_HUMAN_REQUIRED`（短信、滑块等验证） | 执行 `pdd daemon link`，把 `data.url` 转给用户本人完成 |
| `meta.warnings` 含 `account_action_required`（命令本身可能已成功） | 对 `account` 指明的账号执行 `pdd daemon link` 并转给用户 |
| warning `daemon_not_running`，或 `daemon link` 返回 `E_DAEMON_NOT_RUNNING` | 先 `pdd daemon start`，再 `pdd daemon link` |
| `E_AUTH_RELOGIN_BLOCKED`（密码错误、账号锁定或多次超时，已熔断） | `pdd daemon link` 让用户重设密码或解除熔断；用户无法处理时改用 `pdd login --qr` |
| `E_PASSWORD_LOGIN_FORM_CHANGED` | 改用 `pdd login --qr`，并告知用户登录页已变化 |
| `E_AUTH_RELOGIN_FAILED`，或 `error.detail.relogin = 'throttled'` | 自动重登暂不可用，稍后重试或请用户 `pdd login` |
| `E_MASTER_KEY_MISSING` / `E_MASTER_KEY_MISMATCH` / `E_MASTER_KEY_INSECURE` / `E_SECRET_DECRYPT_FAILED` | 主密钥与数据库不配套，重新登录无效。把 `error.hint` 转告用户，由用户决定恢复密钥或清库；数据库与 `master.key` 保持原样，删除、改权限都交给用户本人 |
| `E_CHROMIUM_MISSING` | 执行 `npx patchright install chromium` |
| 命令挂起 / 疑似被风控拦截 | 执行 `pdd doctor` 自检后重新登录 |

## 人工控制台与密码重登

- `daemon link` 链接打开后兑换为 8 小时会话，聊天预览不会消耗链接。用户告知完成后再重试原命令，期间无需轮询控制台。
- 控制台支持用登录名和密码新增账号、删除店铺（需输入店铺名确认）、录入或清除密码、解除熔断、输入短信验证码、在转播弹窗中完成滑块验证或改用扫码。
- 同一账号两次自动重登至少间隔 30 分钟，遇到验证或熔断后暂停到用户处理为止；重复执行命令不会加快恢复。
- `account list` 与 `doctor` 显示 `has_password` 和重登状态（如 `可用`、`等待人工：短信验证`、`已熔断：密码错误`），本身不触发重登。

## daemon、反代与巡航

- 启停：daemon 需显式 `pdd daemon start`，不随机器启动；普通命令、`login` 和 `doctor` 从不拉起它。daemon 启动时加载代码、控制台页面每次读盘，更新代码后执行 `pdd daemon restart`。
- 监听：默认 `127.0.0.1:47821`（`consoleHost` / `consolePort`）。`consoleHost` 填 `0.0.0.0` 时须设置 `consolePublicUrl`，否则返回 421。
- 反代：外网或 HTTPS 反代设置 `consolePublicUrl`，并对 `/api/sessions/*/frames`（SSE）关闭缓冲（如 nginx `proxy_buffering off;`）。
- 巡航：默认关闭（`patrolEnabled`）；开启后按 `patrolIntervalMs`（默认 30 分钟 ±20%）逐账号核验，失效时自动重登。可在控制台巡航胶囊即时启停，被环境变量固定时拒绝修改。

## 环境、数据与代理

- 首次使用：`npx patchright install chromium` → `pdd login` → `pdd doctor`（Node.js >= 24）。系统 Chrome 优先，Patchright Chromium 为必须保留的回退运行时；自动化始终使用 `headless:true`。
- 路径基准：`data/`、`config/`、`log/` 等内置目录固定按 `pdd-cli` 仓库根目录解析，跨目录通过 `npm link` 调用 `pdd` 仍读写同一份配置与数据库；用户显式传入的文件参数（如 `goods cost import <file>`）按当前工作目录解析。
- 账号与加密登录态存在 SQLite（默认 `data/pdd.db`，`PDD_DB_PATH` 覆盖），主密钥 `master.key` 在同目录。两者是敏感文件，保持在仓库之外，备份时一起保存。
- Mock 模式：`PDD_TEST_ADAPTER=fixture` + `PDD_TEST_FIXTURE_DIR=<dir>`，再用临时 `PDD_DB_PATH` 隔离数据库，可在无浏览器、无真实账号时跑通命令。
- 日志：CLI 日志写入 `log/cli/YYYY-MM-DD.log`，daemon 日志写入 `log/daemon/YYYY-MM-DD.log`。
- 上货代理：`goods publish --url` 源商品抓取可选青果代理（`PDD_SOURCE_PROXY_PROVIDER=qingguo`、`PDD_QINGGUO_AUTH_KEY`、`PDD_QINGGUO_AREA`）；启用后失败不回退直连。真实 AuthKey 只放在本地环境变量中，远离仓库、日志与命令行参数。
- 其他环境变量见 `.env.example`。
