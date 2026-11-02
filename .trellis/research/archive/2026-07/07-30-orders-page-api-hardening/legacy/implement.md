# Implementation Plan: 订单 page-api 可靠性收紧

## 1. Tests First

- [x] 扩展 `test/page-api-client.unit.test.js`：已拆包 result、完整成功信封、完整失败信封、错误脱敏。
- [x] 增加 Webpack 4 无全局缓存/无持久 module 测试、Webpack 5 标准 runtime 测试、延迟出现 runtime/client 后成功、等待耗尽测试。
- [x] 扩展 `test/endpoint-client-page-api.unit.test.js`：完整 synthetic Response 面、缺 spec 字段映射 `E_USAGE`、`40002` 不写 cooldown。
- [x] 扩展订单 endpoint 测试：list/stats/detail 合法形状，以及畸形成功响应明确失败而非返回 0。
- [x] 扩展 validator/resolver 测试：显式 `page-api` 缺 `apiUrl` / `buildPayload` 为 invalid，策略判断只来自 resolver。
- [x] 更新 `endpoint-attempt` 测试，删除仅有 `goto` 的旧 pageSession mock 契约。

## 2. Runtime And Envelope Implementation

- [x] 重写 `src/adapter/page-api-client.js` 的 runtime capture 为局部、可清理、无 chunk-id 的 Webpack 4/5 路径。
- [x] 加入 200ms × 15 次有界发现循环，区分 runtime/client 未找到原因。
- [x] 加入完整业务信封识别，避免 `result.result` 二次包装。
- [x] 保持页面异常只提取安全错误字段。

## 3. Endpoint Client And Specs

- [x] 在 `_attemptPageApi()` 加 `apiUrl/buildPayload` 守卫与准确 unavailable hint。
- [x] 补全 synthetic Response 的 `ok/url/headers`。
- [x] 合并 `40002` 与通用 business error 构造路径，保持不触发 cooldown。
- [x] 在订单 specs 中加入严格 result 断言，删除会掩盖缺字段的 0/空数组兜底。
- [x] 保持详情请求仅使用 `orderSn`。

## 4. Strategy And Page Session Consistency

- [x] validator 复用一次 strategy resolution，显式 page-api 缺字段时报 error。
- [x] 删除 `executeAttempt` 中只支持旧 mock 的 `pageSession.goto` 分支。
- [x] 保留 sibling page 在 transport/collector 创建前选定及导航成功后记 history 的修复。
- [x] 清除 `classify-rate-limit.js` 的纯换行改动，使其不出现在最终 diff。

## 5. Documentation

- [x] 更新 `.trellis/spec/adapter/endpoint-xhr-contracts.md`，记录 page-api 单一路线、双返回形状、严格校验和 40002 语义。
- [x] 核对 `docs/architecture-overview.md` 与实际策略一致。
- [x] 在任务 research 记录脱敏活线证据：Webpack 4、直接 result、`orderSn` 成功、三个端点字段存在。

## 6. Verification

- [x] `npx vitest run test/page-api-client.unit.test.js test/endpoint-client-page-api.unit.test.js test/orders-page-api.unit.test.js test/orders.detail-endpoint.unit.test.js`
- [x] `npx vitest run test/endpoint-strategy-resolver.unit.test.js test/endpoint-validator.unit.test.js test/endpoint-strategy-integration.test.js test/validate-existing-endpoints.test.js test/endpoint-attempt.unit.test.js test/adapter-new.unit.test.js test/run-endpoint.unit.test.js test/e2e/orders.e2e.test.js`
- [x] `npm test`
- [x] `npm run lint`（仅记录为 no-op，不作为质量证明）
- [x] `git diff --check`
- [x] 反向搜索旧订单 nav/trigger/XHR fallback、可枚举 page-api 缓存和 `autoLoadGraceMs`。
- [x] 检查 `git diff`，确认没有敏感探针文件、真实订单数据或无内容换行 churn。

## 7. Review Follow-up

- [x] 测试先覆盖无业务码 request client 拒绝、evaluate 异常、截止时间和主动中断。
- [x] `page-api` 消费 `ctx.signal/deadlineAt`，并稳定区分 `E_NETWORK`、`E_TIMEOUT` 与 `E_BUSINESS`。
- [x] fixture parity 降级改为 `fixtureIsServiceFacing` 显式 opt-in，并标记三个订单 endpoint。
- [x] 合并 `endpoint-attempt` 重复导航分支，半实现 `pageSession` 安全回退。
- [x] 修正文档中的不存在 normalizer 符号，并注释受限 Webpack factory 加载的缓存行为。
- [x] 重新运行目标测试、全量测试、`git diff --check` 和范围检查。

复核结果（2026-07-30）：目标测试 `147/147` 通过；全量测试在沙箱内 `1224 passed / 1 failed / 1 skipped`，唯一失败为 `auth-lock` 调用系统进程检查时 `Access denied`，同文件在正常 Windows 权限下复跑 `6/6` 通过；`npm run lint` 为项目既有 no-op。

## Risk And Rollback Points

- Runtime capture 是最高风险点：先通过隔离 Webpack 4/5 mock，再用已登录页面做脱敏只读复核。
- 严格 result 断言可能暴露过去被掩盖的平台响应漂移；这是预期失败模式，不能回退成静默 0。
- 完整信封识别必须在订单 normalizer 前完成；若测试出现双层 result，优先回滚该识别函数的局部实现，不恢复旧订单路线。
