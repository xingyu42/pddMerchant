# 新增全数折扣率测试

## Goal

为 `PDD_FULL_COUNT_DISCOUNT_RATE` 环境变量新增完整的单元测试覆盖，验证配置解析、边界值处理、百分比形式支持、无效值回退等核心逻辑，填补 `test-audit-report.md` 识别的 P0 Critical 测试缺口。

## Background

### 当前状态
- **功能现状**：`PDD_FULL_COUNT_DISCOUNT_RATE` 环境变量已在 `CLAUDE.md` 中声明，用于配置商品发布 `@e86` 字段的全数折扣率（默认 0.95 = 9.5折）
- **测试现状**：**完全缺失** — `test-audit-report.md` 第 245-262 行明确指出：❌ 0个测试
- **优先级**：P0 Critical — 影响商品定价正确性

### 关联任务
- **`07-10-discount-config-abstract`**：该任务原计划实现 `@e86` 字段填充功能，但**当前状态为 `planning`**
- **发现**：经搜索，`@e86` 字段相关代码**尚未实现**（`grep` 未找到 `e86|discount.*rate|折扣率` 匹配项）
- **判定**：`PDD_FULL_COUNT_DISCOUNT_RATE` 环境变量声明在 `CLAUDE.md`，但**配置读取和使用逻辑尚未落地**

### 任务调整策略
**原计划**：为现有的 `getDiscountRate()` 配置函数编写测试
**当前实际**：配置读取函数尚未实现

**决策**：
1. **本任务先实现配置读取逻辑**（轻量级实现，符合测试驱动开发原则）
2. **再编写测试验证该逻辑**（本任务核心职责）
3. **不触及表单填充**（避免与 `07-10-discount-config-abstract` 冲突）

**边界**：
- ✅ 本任务范围：实现 `src/infra/config.js` 中的 `readFullCountDiscountRate()` 函数 + 测试
- ❌ 超出范围：`@e86` 字段选择器定位、`fillGoodsForm` 集成（留给 `07-10-discount-config-abstract`）

## Requirements

### 功能实现（前置）

#### 1. 配置读取函数实现
**文件**：`src/infra/config.js`（如不存在则新建）

**函数签名**：
```javascript
export function readFullCountDiscountRate()
```

**行为规范**：
- 读取 `process.env.PDD_FULL_COUNT_DISCOUNT_RATE`
- 支持两种输入格式：
  - 小数形式：`0.95`（直接使用）
  - 百分比形式：`95`（转换为 `0.95`）
- 边界值校验：合法范围 `0.5` - `0.99`（5折 - 9.9折）
- 无效值回退：
  - 空值、非数字、超出范围 → 回退到默认值 `0.95`
- 返回值：标准化的小数形式（`0.5` - `0.99` 之间的数字）

**实现要点**：
```javascript
// 百分比形式检测：50 <= value <= 99 → 除以 100
// 小数形式：0.5 <= value <= 0.99 → 直接使用
// 其他 → 默认 0.95
```

### 测试覆盖（核心任务）

#### 2. 单元测试文件
**文件**：`test/goods-publish-discount-rate.unit.test.js`（新建）

**测试场景**（8-10 用例）：

**场景 A：默认值**
- 环境变量未设置 → 返回 `0.95`
- 环境变量为空字符串 → 返回 `0.95`

**场景 B：小数形式**
- `PDD_FULL_COUNT_DISCOUNT_RATE=0.95` → 返回 `0.95`
- `PDD_FULL_COUNT_DISCOUNT_RATE=0.5` → 返回 `0.5`（最小边界）
- `PDD_FULL_COUNT_DISCOUNT_RATE=0.99` → 返回 `0.99`（最大边界）

**场景 C：百分比形式**
- `PDD_FULL_COUNT_DISCOUNT_RATE=95` → 返回 `0.95`（自动转换）
- `PDD_FULL_COUNT_DISCOUNT_RATE=50` → 返回 `0.5`（最小边界）
- `PDD_FULL_COUNT_DISCOUNT_RATE=99` → 返回 `0.99`（最大边界）

**场景 D：无效值回退**
- `PDD_FULL_COUNT_DISCOUNT_RATE=1.5` → 返回 `0.95`（超出上界）
- `PDD_FULL_COUNT_DISCOUNT_RATE=0.3` → 返回 `0.95`（超出下界）
- `PDD_FULL_COUNT_DISCOUNT_RATE=abc` → 返回 `0.95`（非数字）
- `PDD_FULL_COUNT_DISCOUNT_RATE=100` → 返回 `0.95`（百分比超界）

**测试风格**：
- 使用 `vitest` + `assert/strict`
- 每个测试用例隔离环境变量（`beforeEach` 清理 + `afterEach` 恢复）
- 用例命名清晰：`it('returns 0.95 when env var is 95 (percentage form)', () => { ... })`

## Acceptance Criteria

### 功能实现
- [ ] 实现 `src/infra/config.js` 中的 `readFullCountDiscountRate()` 函数
- [ ] 函数符合行为规范（支持小数/百分比、边界校验、无效值回退）
- [ ] 导出函数供其他模块使用（`export function readFullCountDiscountRate()`）

### 测试覆盖
- [ ] 新建 `test/goods-publish-discount-rate.unit.test.js`
- [ ] 测试场景覆盖：默认值（2用例）+ 小数形式（3用例）+ 百分比形式（3用例）+ 无效值回退（4用例）
- [ ] 所有测试通过：`npx vitest run test/goods-publish-discount-rate.unit.test.js`
- [ ] 测试代码符合项目规范：使用 `vitest` + `assert/strict`

### 质量检查
- [ ] 新增代码通过 `layering-guard` 检查（`src/infra/config.js` 属于 `infra/` 层）
- [ ] 测试在 mock 模式下可独立运行（不依赖真实浏览器）
- [ ] 代码风格符合项目规范：函数 < 50 行、嵌套 ≤ 3 层

### 文档同步
- [ ] **不修改 `CLAUDE.md`**（环境变量已存在）
- [ ] 在 `readFullCountDiscountRate()` 函数上方添加 JSDoc 注释：
  - 说明默认值 `0.95`
  - 说明支持的格式（小数 / 百分比）
  - 说明合法范围 `0.5` - `0.99`

## Constraints

### 实现约束
- **轻量级实现**：不引入新依赖，使用 Node.js 原生 API（`Number()`、`parseFloat()`）
- **架构合规**：配置逻辑在 `src/infra/config.js`，不跨层依赖
- **无副作用**：纯函数，仅读取环境变量，不修改全局状态

### 不触及范围
- **不实现表单填充**：`fillGoodsForm` 中调用 `readFullCountDiscountRate()` 的逻辑留给 `07-10-discount-config-abstract`
- **不定位 `@e86` 选择器**：Playwright 选择器和 DOM 操作不在本任务范围
- **不修改现有测试**：仅新增测试文件，不触及其他测试

### 依赖关系
- **前置依赖**：无（本任务独立完成）
- **后置依赖**：`07-10-discount-config-abstract` 将调用 `readFullCountDiscountRate()` 实现表单填充

## Success Metrics

### 定量指标
- 新增测试用例数：**10-12 个**（覆盖 4 类场景）
- 测试通过率：**100%**
- 新增代码行数：~30 行（配置读取函数）+ ~120 行（测试代码）

### 定性指标
- 填补 `test-audit-report.md` P0 Critical 缺口
- 为 `07-10-discount-config-abstract` 任务提供可测试的配置基础
- 测试覆盖所有边界条件和异常路径

## Rollback Plan

### 回滚操作
如果测试发现问题，回滚步骤：
1. `git revert <commit-hash>`（回滚配置实现和测试）
2. 删除 `src/infra/config.js`（如果是新建文件）
3. 删除 `test/goods-publish-discount-rate.unit.test.js`

### 影响范围
- **极低风险**：新增代码未被其他模块调用，回滚无破坏性影响

## Notes

### 与 `07-10-discount-config-abstract` 的协调
- **本任务**：提供配置读取基础设施 + 测试
- **`07-10-discount-config-abstract`**：负责表单填充集成
- **衔接点**：`readFullCountDiscountRate()` 函数作为公共接口

### 测试驱动开发（TDD）顺序
1. 先实现 `readFullCountDiscountRate()` 函数（保持简洁）
2. 编写测试验证所有场景
3. 测试失败时修复实现
4. 所有测试通过后提交

### 工作量估算
- 配置函数实现：**1小时**
- 测试编写：**2小时**
- 测试调试和修复：**0.5小时**
- **总计**：**3.5小时**

### 轻量级实现参考
本任务属于"**轻量级任务**"，PRD-only 即可，无需 `design.md` / `implement.md`。
