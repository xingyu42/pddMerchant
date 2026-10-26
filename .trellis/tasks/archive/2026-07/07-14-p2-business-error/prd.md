# 收口 readBusinessError 测试审查项

## Goal

以当前代码和可执行测试为准，核验 `readBusinessError` 是否仍存在专项测试缺口；只处理真实冗余或真实缺口，不为了满足旧审查报告而搬运、复制测试。

用户价值：用最小改动关闭过时的测试审查项，避免增加没有新覆盖价值的维护负担，并为父任务 `07-14-test-audit-fix` 的最终归档提供可信验收证据。

## Background

- `readBusinessError` 当前是 `src/adapter/endpoint-client.js` 中的纯函数，负责读取 `error_code` / `errorCode` 和 `error_msg` / `errorMsg`，忽略成功哨兵码 `0` 与 `1000000`，并统一返回字符串形式的错误码和消息。
- `test/run-endpoint.unit.test.js` 已有定向示例测试，覆盖空输入、缺失错误码、两种命名格式、两个成功哨兵码，以及 snake_case 与 camelCase 同时存在时的优先级。
- `test/pbt/run-endpoint.pbt.test.js` 已有性质测试，覆盖两种命名格式、空值、哨兵码、字符串转换、随机字段组合和非对象输入。
- 2026-07-18 的当前核验命令 `npx vitest run test/run-endpoint.unit.test.js test/pbt/run-endpoint.pbt.test.js` 已通过：2 个文件、26 个测试，无失败。
- 旧父任务声称该逻辑在 8 个文件中存在约 25 个重复用例，但当前精确搜索只发现上述两处直接行为覆盖；该数量不再能作为新增专项文件的依据。
- 2026-07-18 的完整 `npm test` 在沙箱内仅因 `test/pbt/auth-lock.pbt.test.js` 调用 `tasklist` 被拒绝而失败；沙箱外原命令复核通过：141 个文件通过、1 个跳过，1159 个测试通过、1 个跳过。

## Requirements

1. 以当前源码、测试和精确搜索结果为事实基线，不沿用旧审查报告中的历史数量。
2. 保留现有两层互补覆盖：
   - 定向单测提供易读的关键示例和优先级断言。
   - PBT 提供组合输入和不变量覆盖。
3. 只有发现当前行为存在未覆盖分支时，才允许新增最小测试；不得仅为文件命名或目录整齐复制现有断言。
4. 只有发现语义等价且没有额外故障定位价值的重复测试时，才允许删除或合并；不得削弱现有行为契约。
5. 本任务不得修改 `readBusinessError` 业务实现、endpoint 传输逻辑、错误 envelope 或退出码映射。
6. 本任务不得混入当前工作区的 Knip、依赖、临时脚本或 CLI skill 文档改动。
7. 完成定向验证后运行完整 `npm test`；若完整测试仅出现已知 Windows 沙箱 `tasklist` 权限噪声，必须单独说明，不能把它算作本任务通过。

## Acceptance Criteria

- [x] 精确搜索结果确认不存在旧报告所称的 8 文件 / 约 25 个当前重复用例：当前只有 2 个测试文件直接调用 `readBusinessError`。
- [x] 现有定向单测与 PBT 的职责边界清楚，未新增仅复制现有断言的专项测试文件。
- [x] 未发现真实缺口，本任务以零业务代码改动完成。
- [x] 定向验证通过：`npx vitest run test/run-endpoint.unit.test.js test/pbt/run-endpoint.pbt.test.js`（2 files / 26 tests）。
- [x] 完整测试通过：沙箱外 `npm test` 为 141 files / 1159 tests passed，另有 1 file / 1 test skipped；沙箱内 `tasklist: Access denied` 失败已保留并复核为环境限制。
- [x] `git diff` 仍只包含任务开始前已有的 6 个未提交 WIP 文件，本任务未修改这些文件。
- [x] 子任务验收完成，可归档 `07-14-p2-business-error`，并进入父任务 `07-14-test-audit-fix` 的最终集成收口。

## Out of Scope

- 修改 `readBusinessError` 的运行时语义。
- 重构 `runEndpoint`、endpoint error mapper、退出码或 envelope。
- 全仓测试目录重排、测试框架迁移或覆盖率工具接入。
- 处理 `07-10-tech-debt-cleanup` 任务树。
- 提交、还原或整理当前工作区中与本任务无关的未提交改动。

## Rollback

预期方案不产生业务代码改动。若核验中确需调整测试，回滚范围必须限制在本任务实际修改的测试文件，不触碰用户已有 WIP。
