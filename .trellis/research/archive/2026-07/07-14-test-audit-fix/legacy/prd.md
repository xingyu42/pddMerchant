# 修复测试审查报告问题

## Goal

根据 `test-audit-report.md` 的审查结果，系统性修复测试集中的 Critical 缺口、冗余测试、以及覆盖不足问题，提升测试质量和维护效率。

## 2026-07-18 收口说明

- 8 个子任务已按当前代码状态完成或收口；最后一项 `readBusinessError` 经精确搜索确认已由定向 unit test 与 PBT 互补覆盖，不再新建重复专项文件。
- 最终完整测试已在沙箱外通过：141 个文件通过、1 个跳过，1159 个测试通过、1 个跳过。沙箱内唯一失败为 Windows `tasklist: Access denied` 环境限制，复核后不是产品回归。
- 下文“8 个文件 / 约 25 个重复用例”“运行时间减少 5-8%”等数字是 2026-07-14 审查时的估算。仓库随后已经演进，且没有保留可比基线；归档时不把这些历史估算冒充成已测量结果，当前收口以实际调用点、现有契约覆盖和完整测试为准。

## Background

测试审查发现以下核心问题：
1. **Critical 缺口**：IP 软封禁、全数折扣率、mall-reader 等关键业务路径缺少测试
2. **高度冗余**：envelope 格式验证在 30 个文件中重复，readBusinessError 在 8 个文件中重复
3. **覆盖不均**：BUSINESS 退出码测试不足（仅 4 次），3 个 mock 守卫模块测试覆盖率 < 5 次
4. **维护负担**：64 个 it() 用例可合并为 ~15 个表驱动测试

## Requirements

### 父任务职责
- 定义整体验收标准（跨子任务）
- 协调子任务执行顺序（P0 → P1 → P2）
- 确保每个子任务独立可验证
- 最终集成验证：运行完整测试套件 `npm test`

### 子任务范围

#### P0 - Critical（生产正确性）
1. **新增全数折扣率测试** (`07-14-p0-discount-rate`)
   - 新建 `test/goods-publish-discount-rate.unit.test.js`
   - 覆盖 `PDD_FULL_COUNT_DISCOUNT_RATE` 边界值、百分比形式、无效值回退
   
2. **补充 IP 软封禁集成测试** (`07-14-p0-softblock`)
   - 在 `test/goods-publish.unit.test.js` 中补充集成场景
   - 验证连续软封禁触发冷却、`E_RATE_LIMIT` 错误抛出
   
3. **补充 mall-reader 单元测试** (`07-14-p0-mall-reader`)
   - 新建 `test/adapter/mall-reader.unit.test.js`
   - 覆盖 6 层上下文探测的 fallback 逻辑

#### P1 - High（维护效率 & 覆盖完整性）
4. **删除 envelope 冗余断言** (`07-14-p1-envelope-cleanup`)
   - 20 个文件批量重构：E2E 测试仅保留 `envelope.ok` 验证
   - Command 层测试删除 envelope 格式验证（已有 `runner-contract` 覆盖）
   
5. **合并表驱动测试** (`07-14-p1-table-driven`)
   - `test/goods-publish.unit.test.js`：64 用例 → ~15 个表驱动块
   - `test/mall-id.unit.test.js`：22 用例 → ~6 个表驱动块
   
6. **补充 BUSINESS 退出码测试** (`07-14-p1-business-exitcode`)
   - 各 endpoint 测试新增 6-8 个场景
   - 覆盖：发布业务错误、库存不足、类目不匹配

#### P2 - Medium（技术债务）
7. **抽取 readBusinessError 专项测试** (`07-14-p2-business-error`)
   - 新建 `test/adapter/read-business-error.unit.test.js`
   - 统一测试 camelCase/snake_case 兼容性
   - 删除 8 个文件中的 ~25 个重复用例
   
8. **补充 rate-limit 5分钟冷却测试** (`07-14-p2-rate-limit`)
   - 在 `test/circuit-breaker.unit.test.js` 中补充 E2E 场景
   - 验证 3 连 429 触发全局 5 分钟冷却

## Acceptance Criteria

### 父任务级别
- [x] 所有 8 个子任务完成并通过各自验收
- [x] 完整测试套件通过：沙箱外 `npm test` 为 141 files / 1159 tests passed，另有 1 file / 1 test skipped
- [ ] 测试运行时间减少 5-8%（历史估算，缺少同环境基线，归档时明确不声称已验证）
- [ ] 新增测试文件符合项目规范：
  - 使用 `vitest` + `assert/strict`
  - 通过 `layering-guard` 依赖检查
  - Mock 模式下可独立运行（`PDD_TEST_ADAPTER=fixture`）

### 质量门禁
- [ ] 所有新增/修改的测试文件通过 lint（虽然项目无 linter，但需保持代码风格一致）
- [ ] 退出码测试覆盖度检查：所有 8 个退出码 >= 5 次引用
- [ ] Mock 守卫模块覆盖度检查：所有 `isMockEnabled()` 模块 >= 5 次测试引用

### 集成验证
- [ ] 子任务顺序执行后，中间状态始终保持测试可运行
- [ ] P0 完成后运行测试验证核心覆盖
- [ ] P1 完成后验证冗余清理效果（运行时间、代码行数）
- [ ] P2 完成后验证技术债务清理完成

## Constraints

### 执行顺序
- **必须按优先级顺序**：P0 → P1 → P2
- 同一优先级内的子任务可并行（如 P0-1、P0-2、P0-3）
- P1 删除操作（envelope 冗余）依赖 P0 新增完成（避免覆盖下降）

### 不可变规则
- **禁止修改**：高价值测试文件（`test-audit-report.md` 附录 B 列出的 5 个文件）
- **禁止删除**：`test/layering-guard.unit.test.js`、`test/runner-contract.unit.test.js`
- **禁止破坏**：现有 PBT 测试的不变式验证逻辑

### 兼容性要求
- 所有修改保持 ESM 兼容（`import`/`export`）
- 新增测试必须支持 mock 模式（`PDD_TEST_ADAPTER=fixture`）
- 测试数据在 `test/fixtures/` 中复用现有结构

## Dependencies

### 外部依赖
- 无新增外部依赖
- 依赖现有测试框架：`vitest` + `assert/strict`

### 内部依赖
- P1 依赖 P0 完成（避免覆盖下降）
- P2 可独立执行（技术债务清理）

### 跨子任务协调
- `07-14-p1-envelope-cleanup` 需知道哪些文件被 P0 新增（避免误删新测试）
- `07-14-p1-table-driven` 需等 `07-14-p0-softblock` 完成（避免重构冲突）

## Success Metrics

### 定量指标
- **测试覆盖提升**：
  - 新增测试文件数量：+3 个（discount-rate、mall-reader、read-business-error）
  - 新增测试用例数：~30-40 个
- **冗余清理**：
  - 删除重复断言：~125 个（envelope ~100 + readBusinessError ~25）
  - 代码行数减少：~40%（表驱动合并）
- **运行效率**：
  - 测试运行时间减少：5-8%
  - 测试文件总数：±0（新增 3 个，理论可删 0 个）

### 定性指标
- Mock 守卫模块覆盖均衡：所有模块 >= 5 次引用
- 退出码测试均衡：所有 8 个退出码 >= 5 次引用
- 测试失败信噪比提升（envelope 冗余删除后，失败定位更精准）

## Rollback Plan

### 按子任务回滚
- 每个子任务独立 commit，可单独回滚
- 回滚顺序：P2 → P1 → P0（逆序）

### 关键检查点
- P0 完成后运行 `npm test`，失败则回滚 P0
- P1 完成后运行 `npm test`，失败则回滚 P1（保留 P0）
- P2 完成后运行 `npm test`，失败则回滚 P2（保留 P0+P1）

## Notes

### 多子任务协调策略
- **父任务不直接实施代码修改**：所有代码修改由子任务完成
- **父任务负责**：
  - 定义跨子任务验收标准
  - 协调执行顺序和依赖关系
  - 最终集成验证 `npm test`
  
### 子任务独立性
- 每个子任务必须有独立的 `prd.md`
- 每个子任务的验收标准必须可独立验证
- 子任务间依赖关系写在各自的 `prd.md` 中，不在父任务 `implement.md` 中暗示

### 工作量估算
- P0：9 小时（3+2+4）
- P1：14 小时（6+5+3）
- P2：4 小时（2+2）
- **总计**：27 小时（约 3.5 个工作日）
