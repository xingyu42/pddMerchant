# 补充 rate-limit 5分钟冷却测试

## Goal

补充 `CircuitBreaker` 全局5分钟冷却的端到端测试场景，覆盖 CLAUDE.md 中 "3 consecutive 429s trigger 5-minute global cooldown" 的关键路径。

## Context

**测试审查报告缺口**（P2 Medium）:
- **当前覆盖**: 
  - ✅ `test/circuit-breaker.unit.test.js` 已测试全局熔断触发（auth/captcha错误）
  - ✅ `test/infra/rate-control.test.js` 已测试令牌桶逻辑
  - ✅ `test/adapter/classify-rate-limit.test.js` 已测试429分类
- **缺失**: 未测试连续3次429触发全局5分钟冷却的完整场景

**CLAUDE.md 规范**:
```
Rate limiting: 3 consecutive 429s trigger 5-minute global cooldown; 
retry delays [1000, 2000, 4000] ms
```

**现有实现**:
- `src/infra/circuit-breaker.js:4-8` — `BREAKER_DEFAULTS.cooldownMs = 5 * 60 * 1000`
- `src/infra/circuit-breaker.js:70-75` — `_shouldTripGlobal()` 检测 `E_RATE_LIMIT` 触发全局熔断

## Requirements

### R1: 新增测试用例
在 `test/circuit-breaker.unit.test.js` 新增场景：

1. **连续3次 `E_RATE_LIMIT` 触发全局冷却**
   - 模拟3次带 `code: 'E_RATE_LIMIT'` 的错误
   - 验证 `status().globalTripped === true`
   - 验证 `status().globalCooldownRemaining` 约等于 `5 * 60 * 1000` ms

2. **全局冷却期间所有阶段被拦截**
   - 触发全局熔断后
   - 验证任意不同 `phase` 调用 `check()` 均抛出 `E_RATE_LIMIT`
   - 验证错误消息包含 "全局冷却"

3. **全局冷却期满后恢复**
   - 使用快进时钟模拟5分钟后
   - 验证 `_isGlobalTripped()` 返回 `false`
   - 验证后续 `check()` 不再抛出错误

### R2: 区分与现有测试
- **不与现有 auth/captcha 全局熔断测试重复**
- 现有测试（L37-48）关注 `E_AUTH_EXPIRED` / 验证码关键字触发；新测试关注 **连续429** 触发

### R3: 测试风格一致
- 沿用现有的 `breaker.recordFailure()` + `breaker.check()` 风格
- 使用 `assert.throws()` 验证异常
- 使用 `assert.equal()` 验证状态

## Acceptance Criteria

- [ ] 新增3个测试用例（连续429触发、全局拦截、冷却恢复）
- [ ] 测试通过 `npx vitest run test/circuit-breaker.unit.test.js`
- [ ] 全量测试无回归 `npm test`
- [ ] 测试用例命名清晰，反映CLAUDE.md规范

## Non-Goals

- ❌ 不修改 `src/infra/circuit-breaker.js` 生产代码（功能已实现）
- ❌ 不测试 `retry delays [1000, 2000, 4000] ms`（属于重试策略，不属于熔断器职责）
- ❌ 不测试令牌桶限流（已有 `test/infra/rate-control.test.js`）

## Notes

- 轻量级测试任务，PRD-only 即可
- 无需 `design.md` / `implement.md`
