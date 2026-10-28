# 真机验证记录

## N27 强杀后进程残留（2026-10-28，本机 Windows 10，用户授权）

方式：把 `data/pdd.db` 与 `master.key` 复制到临时目录，用 `PDD_DB_PATH` 指向副本（避免真实库提前升级到 schema v2），端口 47998。`pdd daemon start` → `console link` → 脚本兑换会话 → 对唯一商家账号开扫码会话（只打开拼多多扫码页，未登录、未提交账密）→ `taskkill /F` 强杀 daemon 的 node 进程。结束后删除副本。

| 项 | 结果 |
| --- | --- |
| `daemon start` 以 `detached + windowsHide` 拉起 | 发起命令的 shell 退出后 daemon 继续运行、正常心跳并响应控制台请求 |
| 扫码会话启动的浏览器 | 只有 Chromium 主进程带 `--pdd-cli-daemon=` 标记，子进程（渲染、GPU 等）不带 |
| 强杀 node 后 8 秒 | 带标记的 Chromium 为 0；Chromium 进程总数 43 → 26（剩余均为用户自己的 Chrome）；父进程已不存在的 Chromium 为 0；headless / pipe 调试进程为 0 |
| 强杀后的租约 | 心跳停止 90 秒后 `daemon status` 显示 `running: false`，`daemon start` 正常接管 |

结论：Windows 上 Patchright 以管道连接 Chromium，node 退出后整棵浏览器进程树随之退出，无残留。启动时的遗留清理在本机没有可清理对象，其逻辑由单元测试覆盖。

验证中发现：遗留清理按命令行包含 `--pdd-cli-daemon=` 匹配，会把命令行里恰好带这个字符串的其他进程（如排查用的 shell、grep）也算进去。应只匹配浏览器可执行文件（见最终审查的修复）。

强杀后 90 秒内，`daemon status` 仍会显示上一实例为 running（租约未过期），`daemon start` 会返回"已在运行"。这是心跳租约的预期行为，文档中说明即可。

## N26 Linux / Hermes systemd

未授权，待验证。

## N27a 首次短信接管（2026-10-28，Windows 主机 + Android 手机，局域网明文 http）

| 步骤 | 结果 |
| --- | --- |
| `consoleHost` 设为局域网地址，`daemon start`，手机打开 `console link` 链接 | 兑换、账号列表正常；`daemon start` 返回 `console_plaintext_http` 警告 |
| 首次升级 | 真实库升级到 v2 前已备份到 `data/backup-pre-v2/`（不入库） |
| 主账号"开始重登" | 自动填写账密后，页面上的验证未被识别（`password_relogin_status` 为"等待人工：未识别的验证"），转入接管 |
| 第一次接管 | 整页 1902px 宽的画面缩到手机宽度，登录框文字无法辨认，10 分钟接管窗口到期，计 1 次接管超时 |
| 第二次接管（加缩放后，`c0c64a3`） | 用户在接管画面中完成验证，登录成功并保存；`password_relogin_status` 回到"可用"，`pending_actions` 清空，接管超时计数随成功清零 |

由此做的改动：
- `c0c64a3`：screencast `maxWidth` 1280 → 1920；前端加缩放。
- `4e45301`：改用 vendored `@panzoom/panzoom` 做双指缩放平移，单指转发到远端；pointer 响应带 `editable` / `numeric`，点中远端输入框时弹出手机输入法。这一版只在模拟手机（patchright 移动视口 + CDP 触摸事件）上验证过，真机上的手势与自动弹键盘待下次接管时确认（含微信等内置浏览器能否程序化弹键盘、验证码框是否在跨域 iframe）。

未完成、遇到再验证：
- 之后的账密重登是否免短信（设备信任）：账号刚登录，暂时无法触发。
- 校准 `PASSWORD_LOGIN_SELECTORS` / `PASSWORD_LOGIN_TEXTS`：这次未记录接管时的页面结构，下次出现"未识别的验证"时再采集。

## N25 触屏过滑块

本次接管未出现滑块，未验证；遇到时再记录手势轨迹是否通过与 SSE 画面延迟。
