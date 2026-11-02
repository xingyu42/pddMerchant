# 技术设计

## 根因

daemon 主循环和 Windows launcher 在真实宿主环境均能正常运行。缺口在触发时机：

- runner 只在已认证业务命令通过认证校验后异步调用 `ensureDaemonRunning()`。
- 商家 `login` / `init` 保存新认证快照后没有启动 daemon。
- daemon 缺失且认证已过期时，普通命令会在触发自动启动前返回认证错误。
- `daemon start` 先判断 `started`，会把 `{ started: false, confirmed: false }` 误报为已运行。

## 方案

在 `src/commands/init.js` 的商家登录成功路径中：

1. `performQrLogin()` / `performHeadedLogin()` 完成并关闭登录 browser。
2. `await ensureDaemonRunning()`。
3. 正常或已运行：继续成功 envelope。
4. `confirmed === false`：追加 `daemon_start_unconfirmed`。
5. 抛出异常：记录仅含错误码的 warning 日志，追加 `daemon_start_failed`。

登录认证已经保存成功，因此 daemon 启动失败不应把登录改报失败。用户可以根据 warning 执行 `pdd daemon start --json` 排障。

`src/commands/daemon.js` 调整判断顺序：先处理 `confirmed === false`，再处理 `started === false` 的已运行结果。

## 边界

- 不改 consumer login。
- 不改 runner 已有自动启动。
- 不修改 launcher、刷新间隔、daemon state schema 或系统启动项。
- 不让测试生成真实后台进程。

## 验证

- 登录成功、未确认、异常和登录失败单元测试。
- daemon start 未确认回归测试。
- daemon 生命周期、JSON purity 和全量测试。
