# PRD: Fable指导测试套件精简

## Goal

对 `test/` 目录下 129 个测试文件（共 15,560 行）进行精简，减少冗余/重复的测试设置代码、过度详尽的用例、可合并的相似测试，同时不降低测试覆盖率、不破坏质量门禁（layering-guard、PBT harness 等）。

分析交由 Fable 模型执行（多角度审阅测试文件，产出具体的 file:line 级精简建议）；所有实际代码修改由 Claude 执行（遵循项目"代码主权"原则：分析模型只出建议，不碰代码）。

## Confirmed Facts (from repo inspection)

- 测试框架：Vitest + `assert/strict`，自动发现 `test/**/*.test.js`（129 个文件，15,560 行）。
- 测试分类：根目录 `*.unit.test.js` / `*.smoke.test.js`，`test/e2e/*.e2e.test.js`（子进程 CLI 测试），`test/pbt/*.pbt.test.js`（自研零依赖 PBT harness，`test/pbt/_harness.js`），`test/adapter/`、`test/infra/`、`test/services/` 子目录。
- `npm test` = `vitest run`；`npm run check` = `npm test`（当前诚实的项目门禁）；`npm run lint` 是 no-op。
- 项目标准文档 `.trellis/spec/standards/testing.md` 定义了测试契约：fixture adapter 是命令/e2e测试的默认 seam；auth/doctor 子进程测试必须使用隔离的临时路径；PBT 失败需保留 `PBT_SEED`。
- `test/layering-guard.unit.test.js` 守护 `commands/ → services/ → adapter/ → infra/` 单向依赖，是精简过程中不可破坏的门禁。
- CLAUDE.md 项目约定："代码主权 — Codex/Gemini（及其他分析模型）只负责分析；所有代码修改由 Claude 执行"。

## Requirements

1. 使用 Fable 模型（通过 Agent 工具 `model: "fable"`）对测试套件进行分析，识别：
   - 重复/相似的测试 setup（例如 `beforeEach`/mock 构造的重复模式）
   - 可合并为参数化/表驱动用例的相似测试
   - 过度详尽、对覆盖率无实质贡献的冗余用例
2. Claude 根据 Fable 的建议执行实际的代码修改（重构/合并/删除），不由 Fable 直接改代码。
3. 精简后必须通过 `npm test`（全量 vitest），且 `test/layering-guard.unit.test.js` 等门禁测试保持通过。
4. 不降低有效测试覆盖率：删除的用例必须是真正冗余（同一断言路径被其他用例覆盖），而非删除独特的边界/错误分支覆盖。

## Acceptance Criteria（全部完成，详见 implement.md Results）

- [x] 工作区在干净基线上进行：commit `c65f506`，129 文件 / 999 测试全部通过。
- [x] Stage 0 静态初筛脚本产出候选清单（Top 5 大文件；按命令域交叉未发现 unit/e2e/pbt 断言级重复，各层测试意图本就不同）。
- [x] Fable 对候选清单做语义复核，5 条建议按优先级排序，含变异可检测性判断依据。
- [x] Claude 落地 4 个精简点（3-5 范围内），每个都做了变异检查或由 Fable 判定为零风险同构断言（详见 implement.md Mutation Checks）。
- [x] test/pbt/ 与 test/e2e/ 本轮未合并/删除任何用例（4 个精简点全部在 test/goods-publish.unit.test.js 与 test/diagnose-scoring.unit.test.js 内）。
- [x] 改动后 `npm test` 全量通过（129 files / 981 tests）。`npx vitest run --coverage` 不可用（项目未安装 `@vitest/coverage-v8`），已改用逐条变异检查作为覆盖率不降的等效证据，并在 implement.md Follow-up 中记录此依赖缺口。
- [x] 未改变任何测试的现有失败/通过语义：净减少的 18 个 it() 全部是断言逻辑完全同构、仅输入不同的用例合并（表驱动化），无删除独特分支覆盖。

## Out of Scope

- 不改动 `src/` 生产代码。
- 不引入新的测试框架或替换 Vitest。
- 不修改 fixture 数据本身的业务含义（仅可调整测试代码引用方式）。

## Scope Decisions (confirmed with user)

- 精简力度：允许合并/删除真正冗余的用例（不仅是提取共享 helper）。判定标准（Fable 审阅后修正）：删除该用例后，能否构造一个使 src/ 出 bug 但全套测试仍绿的变异？能则不可删。
- 本轮范围：先做优先级子集，不强求一次覆盖全部 129 个文件；范围收窄到 3-5 个精简点。
  - Stage 0 用脚本对全部 129 个文件做静态初筛（重复 setup 模式 + 按命令域交叉 unit/e2e/pbt 重复断言）。
  - Fable 对候选清单做语义复核，而非机械逐目录通读。
  - `test/pbt/`（占比约 1/3 行数，property 测试的"相似"往往是不同不变量）与 `test/e2e/`（envelope/exit-code 契约的唯一端到端守护）本轮排除在合并/删除范围外，只做重复 setup/generator 提取。
  - Claude 从候选中挑选 3-5 个价值最高、风险最低的精简点在本轮落地，逐条做变异检查。
  - 未落地的机会记录在 `implement.md` 的 Follow-up 部分，作为后续任务输入。
- 验收指标：不用"总行数净减少"（该指标可被 helper 提取抵消，也可能诱导删断言凑数），改用 `vitest run --coverage` 前后 line/branch 覆盖率对比 + 逐条删除项的变异检查记录。

## Fable 审阅意见摘要

已用 `Agent(model: "fable")` 对本计划做过一轮批判性审阅（非直接分析测试文件），核心修正已并入上方 Scope Decisions 与 design.md：脏工作区需先提交清空（已完成）、精简数量从 5-10 收窄到 3-5、Stage A 分组从"按目录"改为"脚本初筛+按命令域"、验收指标从行数改为覆盖率对比、pbt/e2e 排除在删除范围外。
