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

## N27a 首次短信接管、N25 触屏过滑块

已授权，需用户本人在场操作，待安排。
