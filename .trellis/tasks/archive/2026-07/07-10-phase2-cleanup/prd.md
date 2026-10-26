# Phase 2 废弃模块清理

## Goal

清理 Phase 2 API 路径废弃模块的遗留测试文件和引用，保持代码库健康度。

## Requirements

### 功能需求

1. **删除废弃测试文件**
   - 移除已标记为删除的 Phase 2 测试 fixture 文件：
     - `test/fixtures/endpoints/goods.publish.create_draft.json`
     - `test/fixtures/endpoints/goods.publish.edit_draft.json`
     - `test/fixtures/endpoints/goods.publish.save_decoration.json`
     - `test/fixtures/endpoints/goods.publish.template.json`

2. **检查测试引用**
   - 搜索代码库中对这些 fixture 文件的引用
   - 移除或更新相关测试代码（如有）

3. **确认源文件已删除**
   - 验证以下源文件已从 git 中删除：
     - `src/services/goods-publish/payload-builder.js`
     - `src/services/goods-publish/property-matcher.js`
     - `src/services/goods-publish/sku-mapper.js`

4. **更新注释**
   - 更新 `src/services/goods-publish.js:18-20` 的注释，明确说明 Phase 2 模块已清理

### 非功能需求

- **安全性**: 确认删除前文件确实不再被引用（避免破坏现有功能）
- **可追溯性**: 在 commit message 中清晰说明清理原因
- **测试通过**: 清理后执行 `npm test` 确保无失败用例

### 技术约束

- **仅清理废弃代码**: 不修改任何业务逻辑
- **Git 操作**: 使用 `git rm` 删除文件（而非直接删除）
- **架构合规**: 清理后架构分层守卫测试仍应通过

## Acceptance Criteria

### 文件清理完整性
- [ ] 4 个 Phase 2 fixture 文件已从 git 中删除
- [ ] 代码库中无对这些文件的引用（搜索结果为空）
- [ ] 3 个 Phase 2 源文件确认已删除（git status 显示 deleted）

### 测试通过
- [ ] `npm test` 执行无失败用例
- [ ] `test/layering-guard.unit.test.js` 架构守卫测试通过
- [ ] 所有现有测试覆盖率不下降

### 代码质量
- [ ] 更新 `src/services/goods-publish.js` 注释，移除"Do NOT remove"警告
- [ ] commit message 遵循 Conventional Commits 规范（🔧 chore）

### 文档同步
- [ ] 更新 `docs/architecture-overview.md`，移除 Phase 2 废弃模块相关描述
- [ ] 更新 handoff 文档，记录清理完成状态

## Notes

### 参考资料

**已删除文件列表**（来自 git status）:
```
deleted:    src/services/goods-publish/payload-builder.js
deleted:    src/services/goods-publish/property-matcher.js
deleted:    src/services/goods-publish/sku-mapper.js
deleted:    test/fixtures/endpoints/goods.publish.create_draft.json
deleted:    test/fixtures/endpoints/goods.publish.edit_draft.json
deleted:    test/fixtures/endpoints/goods.publish.save_decoration.json
deleted:    test/fixtures/endpoints/goods.publish.template.json
```

**相关注释**（`src/services/goods-publish.js:18-20`）:
```javascript
// NOTE: Sub-modules in ./goods-publish/ (payload-builder, property-matcher, sku-mapper)
// are Phase 2 (API-based publish path). Currently unused — the active path uses UI automation.
// Do NOT remove: they have test coverage and will be integrated when PDD exposes a stable API.
```

### 实现步骤

1. **搜索引用**（第一步，必须先完成）
   ```bash
   # 搜索 fixture 文件引用
   grep -rn "goods.publish.create_draft\|goods.publish.edit_draft\|goods.publish.save_decoration\|goods.publish.template" test/ src/
   
   # 搜索源文件引用
   grep -rn "payload-builder\|property-matcher\|sku-mapper" test/ src/ --include="*.js"
   ```

2. **删除 fixture 文件**
   ```bash
   git rm test/fixtures/endpoints/goods.publish.create_draft.json
   git rm test/fixtures/endpoints/goods.publish.edit_draft.json
   git rm test/fixtures/endpoints/goods.publish.save_decoration.json
   git rm test/fixtures/endpoints/goods.publish.template.json
   ```

3. **确认源文件删除**
   ```bash
   git status | grep "deleted.*goods-publish"
   ```

4. **更新注释**
   ```javascript
   // src/services/goods-publish.js:18-20
   // 修改后：
   // NOTE: Phase 2 API-based publish path (payload-builder, property-matcher, sku-mapper)
   // has been deprecated in favor of UI automation. Modules and fixtures removed in 2026-07-10.
   ```

5. **执行测试**
   ```bash
   npm test
   ```

6. **提交清理**
   ```bash
   git add -A
   git commit -m "🔧 chore(goods-publish): remove Phase 2 deprecated fixtures

- Deleted 4 Phase 2 API fixture files (create_draft, edit_draft, save_decoration, template)
- Updated goods-publish.js comment to reflect module removal
- Phase 2 modules (payload-builder, property-matcher, sku-mapper) already removed
- All tests pass; active UI automation path unaffected"
   ```

### 风险评估

| 风险项 | 概率 | 缓解措施 |
|--------|------|----------|
| fixture 文件仍被引用 | Low | 先搜索引用，有引用则移除引用代码 |
| 测试失败 | Low | 清理前运行 `npm test` 确保基线通过 |
| 误删活跃代码 | Very Low | 仅删除已标记 deleted 的文件 |

### Mock 模式适配

本任务不涉及 Mock 模式，清理操作不影响 Mock 适配器。

### 父任务依赖

本子任务是 **P2 优先级**，纯清理任务，与其他子任务无依赖，可独立并行开发。完成后提升代码库健康度，减少维护负担。

### 重要提示

**执行清理前必须先搜索引用**，确保删除的文件不会破坏现有功能。如果搜索到引用，需先移除或更新引用代码，再删除文件。
