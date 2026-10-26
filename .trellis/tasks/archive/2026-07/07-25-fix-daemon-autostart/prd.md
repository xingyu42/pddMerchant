# 修复 daemon 未运行与自动启动

## Goal

定位并修复 pdd daemon 未运行、自动启动失败或启动后退出的问题，确保周期认证刷新能够实际运行。

## Requirements

- 商家 `login` / `init` 成功保存认证快照后，应确认 daemon 已运行或完成一次启动尝试。
- daemon 已运行时不得重复启动。
- daemon 启动未确认或抛出异常时，已成功的登录保持成功，但 envelope 必须包含稳定、非敏感 warning。
- 登录失败时不得启动 daemon。
- 消费者登录不启动商家 auth daemon。
- 显式 `daemon start` 收到 `confirmed: false` 时必须返回启动失败，不能误报 `already_running: true`。
- 保持 daemon 刷新周期、Windows launcher、状态文件格式和认证逻辑不变。
- 测试不得启动真实持久 daemon；运行态验证必须负责清理或明确保留状态。

## Acceptance Criteria

- [x] 商家二维码或有头登录成功后调用 `ensureDaemonRunning()` 一次。
- [x] 已运行 daemon 返回登录成功且不产生失败 warning。
- [x] daemon 未确认时登录仍成功，并包含 `daemon_start_unconfirmed`。
- [x] daemon 启动异常时登录仍成功，并包含 `daemon_start_failed`，日志不含认证数据。
- [x] 登录失败、消费者登录路径不触发商家 daemon 自动启动。
- [x] `daemon start` 对任意 `confirmed: false` 返回 `E_DAEMON_START_FAILED`。
- [x] daemon、login、JSON purity 定向测试和全量 `npm test` 通过。

## Notes

- 2026-07-25 真实宿主验证：`daemon start` 后 PID 持续存活并完成首轮多账号刷新，Windows launcher 本身可用。
- 当前自动启动仅位于已认证业务命令 runner；机器重启或 daemon 被杀后，登录成功路径不会启动 daemon。
- 当前认证状态为 `shop-a=auth_expired`、`shop-b=auth_missing`；运行 daemon 不能替代重新登录。
