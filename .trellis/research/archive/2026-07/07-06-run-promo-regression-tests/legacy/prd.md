# Run promo regression tests

## Goal

对刚完成的 promo review-fix 执行回归测试，确认 endpoint normalizer、业务失败判断、promo CLI smoke/e2e 与相关适配层契约没有回退。

## Requirements

- 运行 promo endpoint 定向单测，覆盖 `PROMO_ENTITY_REPORT` / `PROMO_HOURLY_REPORT` 的 normalize 与 isSuccess 回归断言。
- 运行 promo smoke/e2e，确认 fixture adapter 下 CLI envelope 与命令行为仍可用。
- 运行必要的相关适配层回归测试，覆盖本次修复关联的 endpoint-client merge 行为。
- 不修改源码；如测试失败，记录失败命令、错误摘要与建议下一步。

## Acceptance Criteria

- [x] `npx vitest run test/promo-endpoint.unit.test.js` 通过。(24 tests)
- [x] `npx vitest run test/promo.smoke.test.js test/e2e/promo.e2e.test.js` 通过。
- [x] `npx vitest run test/endpoint-client-merge.unit.test.js` 通过。
- [x] 汇总测试结果与当前工作区状态。(4 files / 36 tests passed; 工作区 clean)

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
