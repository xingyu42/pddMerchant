# Fix promo review findings

## Goal

修复最新提交代码审查指出的 promo endpoint 回归：业务失败误判成功，以及真实模式/fixture 模式 promo 报表字段不一致。

## Requirements

- `PROMO_ENTITY_REPORT` 与 `PROMO_HOURLY_REPORT` 不得把 `success: false` 且带 `result` 的响应视为成功，仍需让 endpoint-client 走统一业务错误映射。
- `PROMO_ENTITY_REPORT.normalize()` 输出必须与现有 fixture 和下游消费者保持一致，继续暴露顶层 `spend` 与 `cost` 裸数字，同时保留 `totals.spend` / `totals.cost`。
- 更新 promo endpoint 单测覆盖上述回归。
- 不改变命令注册、输出 envelope 顶层形状或删除/恢复已废弃的 promo search/scene 命令。

## Acceptance Criteria

- [x] 单测证明 `success: false` 即使包含 `result` 也返回 `isSuccess === false`。(promo-endpoint.unit.test.js:163-165, 189-190)
- [x] 单测证明 entity report normalize 输出顶层 `spend` 与 `cost`。(promo-endpoint.unit.test.js:113-116)
- [x] `test/promo-endpoint.unit.test.js` 通过。(24 tests)
- [x] 相关 promo smoke/e2e 测试通过。(promo.smoke + promo.e2e + endpoint-client-merge 全通过)

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
