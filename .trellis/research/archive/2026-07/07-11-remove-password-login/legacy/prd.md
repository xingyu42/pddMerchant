# 移除密码登录功能

## Goal

完全移除密码登录功能，保留二维码和有头浏览器两种登录方式。

**原因**：
1. **维护成本高** — 需要处理验证码、滑块验证、短信验证等挑战
2. **用户体验差** — 遇到验证码时无法自动化完成
3. **必要性低** — 二维码登录和有头浏览器登录已满足需求

## Requirements

### 核心实现移除

1. **删除适配器** — 删除 `src/adapter/password-login.js`
2. **清理服务层** — 从 `src/services/auth.js` 移除 `performPasswordLogin` 导入和导出
3. **清理命令层** — 从 `src/commands/login.js` 移除 `runPasswordLogin` 函数及 `--password` 分支逻辑

### 命令注册清理

4. **移除选项** — 从 `src/commands/registry/core.js` 删除 `--password` 选项定义
5. **账号管理** — 检查 `src/commands/registry/account.js` 和 `src/commands/account.js`，如果 `account add` 使用密码登录需要调整

### Mock 支持清理

6. **清理 Mock 分发器** — 从 `src/adapter/mock-dispatcher.js` 移除 `mockPasswordLogin` 函数和导出
7. **清理 Fixture** — 从 `src/adapter/fixtures/auth.js` 移除密码登录相关 mock 数据

### Daemon 清理

8. **检查 Daemon** — 检查 `bin/pdd-daemon.js`，如果使用密码登录需要调整或移除

### 文档更新

9. **更新 Skill 文档** — 从 `skills/pdd-cli/SKILL.md` 移除所有密码登录说明
10. **更新帮助文本** — 更新 `test/fixtures/help/baseline.json` 移除 `--password` 相关内容

### 测试清理

11. **查找测试** — 查找所有密码登录相关测试文件并删除
12. **修复引用** — 更新任何引用密码登录的测试用例

## Acceptance Criteria

### 功能验证

- [x] `node bin/pdd.js login --password` 报错或提示选项不存在
- [x] `node bin/pdd.js login --help` 输出不包含 `--password` 选项
- [x] `node bin/pdd.js login --qr` 正常工作
- [x] `node bin/pdd.js login --headed` 正常工作
- [x] `node bin/pdd.js account add` 正常工作（如果受影响需验证调整后的流程）

### 代码质量

- [x] `npm test` 全部通过
- [x] 无死代码：`grep -r "performPasswordLogin\|loginWithPassword\|password-login" src/` 无残留引用
- [x] Layering guard 通过：`npx vitest run test/layering-guard.unit.test.js`
- [x] 无未使用的导入（ESLint 会报错，本项目无 linter 但需人工检查）

### 文档一致性

- [x] `skills/pdd-cli/SKILL.md` 不包含密码登录说明
- [x] Help baseline fixture 与实际命令选项一致

## Out of Scope

- 二维码登录（商家端、消费端）保持不变
- 有头浏览器登录（商家端、消费端）保持不变
- Auth state 文件格式不变

## Technical Constraints

1. **ESM 模块** — 删除导入时注意循环依赖和 side effects
2. **测试覆盖率** — 删除后测试覆盖率不应显著下降（除被删除功能本身）
3. **依赖分层** — 保持 `commands/ → services/ → adapter/ → infra/` 单向依赖

## Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| 用户依赖密码登录 | 高 | Commit message 说明替代方案，文档更新明确 |
| `account add` 功能受损 | 中 | 验证该命令是否使用密码登录，调整为二维码/有头模式 |
| 测试遗漏导致隐藏 bug | 中 | 全量运行测试套件，手工验证核心流程 |

## Notes

- 本任务为**轻量级删除任务**，PRD-only 即可，无需 design.md 和 implement.md
- 删除前先全量运行 `npm test` 确认基线
- 删除后再次运行 `npm test` 确认无破坏
