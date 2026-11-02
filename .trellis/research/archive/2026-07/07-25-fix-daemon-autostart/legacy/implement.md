# 实施计划

## 1. 登录后自动启动

- [x] 在商家登录成功后等待 `ensureDaemonRunning()`。
- [x] 正常/已运行不增加 warning。
- [x] 未确认追加 `daemon_start_unconfirmed`。
- [x] 异常追加 `daemon_start_failed`，且不推翻登录成功。
- [x] 登录失败不触发 daemon；consumer 路径不变。

## 2. 显式启动纠错

- [x] `daemon start` 优先处理 `confirmed: false`。
- [x] 保留 already-running 和成功启动 envelope 契约。

## 3. 验证

- [x] 登录 daemon 自动启动单元测试。
- [x] daemon lifecycle 回归测试。
- [x] JSON purity / error envelope 定向测试。
- [x] `npm test`、`npm run lint`、`git diff --check`。
