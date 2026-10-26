# Implementation Plan: daemon 软失效识别

## 1. Tests First

- [x] 扩展 `test/auth-refresher-lifecycle.unit.test.js` 的 heartbeat mock，覆盖 snake_case/camelCase 43001、其他业务拒绝、成功体和非 JSON 兼容。
- [x] 断言明确业务失败不执行 `saveAuthState()`；43001 不调用宽松 `isAuthValid()`。
- [x] 扩展 daemon 日志测试，区分明确过期和可重试失败。

## 2. Implementation

- [x] 在 `src/adapter/auth-refresher.js` 安全抽取最小业务字段并集中分类。
- [x] 对 43001 复用既有二维码/`auth_expired` 返回路径；其他业务拒绝返回 `heartbeat_rejected`。
- [x] 在 `bin/pdd-daemon.js` 按 reason 输出准确日志，不记录 raw 响应。
- [x] 保留现有调度抖动、headless 默认值和商家/消费者边界。

## 3. Documentation

- [x] 更新 README/相关 adapter 契约，明确 daemon 的能力和限制。
- [x] 记录 HTTP 200 业务认证失败不得由首页 200 覆盖的契约。

## 4. Verification

- [x] 运行认证刷新和 daemon 目标测试。
- [x] 运行 `npm test`。
- [x] 运行 `npm run lint` 并注明其为 no-op。
- [x] 运行 `git diff --check` 和范围/敏感信息检查。

复核结果（2026-07-31）：目标测试 `26/26` 通过；正常 Windows 权限下全量 `146` 个测试文件通过、`1` 个按配置跳过，`1230` 项通过、`1` 项跳过。沙箱内唯一 `auth-lock` `Access denied` 已用同 seed 和正常权限复核通过；`npm run lint` 为项目既有 no-op。
