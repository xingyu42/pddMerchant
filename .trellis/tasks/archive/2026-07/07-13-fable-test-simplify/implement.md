# Implement Plan: Fable指导测试套件精简

## Checklist

0. [x] 干净基线：commit `c65f506`，129 文件 / 999 测试全部通过（前置条件已满足）
1. [x] Stage 0 — 静态初筛完成。129 文件/16564 行/949 it()。Top 5 大文件（合并候选优先级）：
   - `test/goods-publish.unit.test.js` 1302L/67it（远超第二名，最高优先级）
   - `test/endpoint-validator.unit.test.js` 461L/36it
   - `test/diagnose-scoring.unit.test.js` 456L/40it
   - `test/mall-switcher.unit.test.js` 410L/16it
   - `test/run-endpoint.unit.test.js` 403L/17it
   - exact-text beforeEach 去重未发现命中（正则过严，格式差异大，放弃这条线索）
   - 按命令域交叉未发现 unit/e2e/pbt 断言级重复（各层测试意图不同：unit 测内部函数、e2e 测 CLI 输出、pbt 测不变量），故本轮候选聚焦"单文件内部可合并的相似 it()"，而非跨层去重
2. [x] Stage A — Fable 语义复核完成，5 个候选按优先级排序，选定前 4 个执行（跳过第 5 个 endpoint-validator，风险中等/收益偏结构性）：
   - #1 `test/goods-publish.unit.test.js` `parseGoodsUrl` 组：7 it → 2 表驱动 it（22-68 行）
   - #2 `test/goods-publish.unit.test.js` `isPriceMasked` 组：6 it → 1 表驱动 it（146-176 行）
   - #3 `test/diagnose-scoring.unit.test.js` `scoreFunnelHealth` 退款率阈值组：4 it → 1 表驱动 it（376-407 行，注意 363 行的 low-refund detail 断言与 0.20 行的 issues 断言不并入/需保留）
   - #4 `test/goods-publish.unit.test.js` `mapPublishBusinessError` 组：7 it → 1-2 表驱动 it（228-263 行，camelCase errorCode 分支独立保留，不与 snake_case 去重）
   - 不合并：run-endpoint.unit.test.js（每个 it 覆盖独立错误路径）、mall-switcher.unit.test.js（各 test 断言差异大，只能提取 helper）
3. [ ] 从 safe-refactor 候选中挑 3-5 个价值最高的精简点（`test/pbt/`、`test/e2e/` 本轮只允许提取重复 setup/generator，不合并/删除用例）
4. [x] 逐项落地前后做变异检查（3 个代表性分支验证，见下方 Mutation Checks）
5. [x] 应用改动 → `npx vitest run <affected files>` 局部验证：2 files passed, 89 tests
6. [x] 全部改动完成后 `npm test` 全量回归：129 files passed, 981 tests（基线 999 - 18 合并减少的 it()）
7. [~] `npx vitest run --coverage` 不可用（`@vitest/coverage-v8` 未安装，项目当前无覆盖率工具链）。改用逐条变异检查作为覆盖率不降的证据，见下方
8. [x] `npx vitest run test/layering-guard.unit.test.js`：3 tests passed
9. [x] 精简点清单见下方 Results
10. [x] Follow-up 见下方

## Results（本轮落地的 4 个精简点）

| # | 文件 | 合并前 | 合并后 | 变更 |
|---|------|--------|--------|------|
| 1 | `test/goods-publish.unit.test.js` `parseGoodsUrl` | 7 it | 2 it（表驱动 + 异常表驱动） | -5 |
| 2 | `test/goods-publish.unit.test.js` `isPriceMasked` | 6 it | 1 it（表驱动） | -5 |
| 3 | `test/diagnose-scoring.unit.test.js` `scoreFunnelHealth` 退款率边界 | 4 it | 1 it（表驱动，保留 red 分支的 issues 断言） | -3 |
| 4 | `test/goods-publish.unit.test.js` `mapPublishBusinessError` | 7 it | 2 it（错误码表 + null 表） | -5 |

合计：24 it → 6 it，净减少 18 个 it()，981/999 测试保留（无删除断言覆盖，仅合并同构断言）。

## Mutation Checks（变异检查证据）

对 4 个精简点里覆盖面最不确定的 3 处做了显式变异验证（临时改坏 src 对应分支 → 确认合并后测试变红 → 改回确认变绿，`git diff --stat` 确认改动已完全撤销）：

1. `isPriceMasked` 零边界：`src/adapter/goods-publish/source-scraper.js:74` `Number(str) <= 0` → `< 0`，合并后的 `isPriceMasked` 表驱动 it 立即失败（`0`/`0.00` 两行断言不通过）。✅ 边界仍被覆盖。
2. `mapPublishBusinessError` camelCase 分支：`src/adapter/endpoints/goods-publish.js:4` 去掉 `?? raw?.errorCode` 回退，合并后的表驱动 it 立即失败（camelCase 输入行抛 TypeError）。✅ 项目已知的 camelCase/snake_case 双轨断言未被合并掉，仍是独立表行。
3. `scoreFunnelHealth` 退款率边界：`src/services/diagnose/funnel-health.js:22` `refundRate > 0.15` → `>= 0.15`，合并后的表驱动 it 立即失败（0.15 精确边界行）。✅ strict-> 边界语义未丢失。

3 次变异均被对应测试捕获，验证合并未降低有效覆盖率。`parseGoodsUrl` 未做显式变异检查（纯字符串解析、Fable 复核判定为零风险同构断言），风险最低，未额外验证。

## Follow-up（本轮未落地的机会，供后续任务参考）

- `test/endpoint-validator.unit.test.js`（461L/36it）：Fable 识别出约 8-10 个 warning-code 断言组可参数化为 `cases = [{spec, code, severity, field?}]`，风险中等（spec 对象冗长、收益偏结构性），本轮跳过。
- `test/mall-switcher.unit.test.js`（410L/16it）：优先级链 5 个 test 表面同构，但 fake page 配置和附加断言差异大，只能提取共享 helper，不可合并断言。
- `test/run-endpoint.unit.test.js`（403L/17it）：几乎每个 it 覆盖独立错误路径/时序行为，无可合并项。
- Stage 0 未发现 unit/e2e/pbt 跨层断言级重复（各层测试意图本就不同：unit 测内部函数、e2e 测 CLI 输出、pbt 测不变量），因此跨层去重此轮未发现候选，未来若要继续精简应聚焦"单文件内部大量 it() 覆盖同构断言"的模式（如本轮的 4 个点）。
- 项目当前无 `@vitest/coverage-v8`/`coverage-istanbul` 依赖，`npm test` 无法产出覆盖率报告；如后续要把覆盖率对比作为常规验收手段，需要先评估引入该 devDep。

## Validation Commands

```bash
npm test
npx vitest run --coverage
npx vitest run test/layering-guard.unit.test.js
npx vitest run <changed-file>
```

## Rollback Points

- 改动未提交前，每个精简点都可用 Edit 直接撤销
- 若某项改动导致覆盖率下降或变异检查失败（删除后 src 出 bug 测试仍绿），立即撤销该项并跳过

## Follow-up (filled after Stage 0/A/B)

- (待 Stage 0/A 结果汇总后补充未落地的机会，供后续任务使用)
