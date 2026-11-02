# ② 实施清单

约束：先写测试；函数 < 50 行，嵌套 ≤ 3；ESM + async/await；不加依赖；不提交代码；只用 fixture，不连真实账号。

1. [x] adapter：新增 `src/adapter/endpoints/experience.js`，含 3 个 spec（第 2 节）；在 `test/adapter/` 增加 payload 和 isSuccess 的契约测试。
   验证：`npx vitest run test/adapter/experience-contract.test.js`
2. [x] view：新增 `src/services/views/experience.js`，以及 labels 中的维度、单位、达标标签（第 3、4 节）。先写 `test/services/experience-view.test.js`。
   验证：`npx vitest run test/services/experience-view.test.js`
3. [x] service：新增 `src/services/experience.js`（第 5 节）。先写 `test/services/experience.test.js`。
   验证：`npx vitest run test/services/experience.test.js`
4. [x] command：新增 `src/commands/diagnose/experience.js`，并在 `registry/diagnose.js` 注册。human 模式的渲染器先看 `_render.js`：能复用就复用，不能复用就输出简单表格。
5. [x] fixture 和契约：增加 `createExperienceFixtures()`、V2_CASES 用例和 e2e。
   验证：`npx vitest run test/contract/data-contract-v2.test.js test/e2e/experience.e2e.test.js`
6. [x] 文档：README 命令表、`skills/pdd-cli/SKILL.md`；在 `.trellis/spec/services/domain-service-contracts.md` 增加一节 experience 契约（字段、映射表引用、不输出的字段）。
7. [x] 最终检查：`npm test`、`git diff --check`、`git status --short`。
