# Design: Fable指导测试套件精简

## Architecture（Fable 审阅后修正版）

**前置条件**：工作区已提交为干净基线（commit `c65f506`），129 个文件 / 999 个测试全部通过。后续所有精简改动都在此基线上做增量 diff。

三阶段流水线，分析与执行严格分离（代码主权原则）：

```
Stage 0: 脚本初筛（非 agent，纯静态统计）
  写一次性脚本扫描 test/**/*.test.js：
    - 统计每个文件的 describe/it 数、行数
    - 用简单 shingle/正则找重复 setup 模式（如相同的 beforeEach mock 构造块）
    - 按"命令域"（goods / orders / auth / promo / infra 通用）交叉列出同一命令域下
      unit ↔ e2e ↔ pbt 之间的重复断言点（这是最常见但纯目录分组发现不了的冗余）
  产出候选清单，供 Stage A 语义复核，不直接作为执行依据。

Stage A: Fable 语义复核（只读，产出建议，不改代码）
  Agent 调用（model: "fable"）按候选清单分组复核，而非机械按目录分组：
    - 判定标准：删除该用例后，能否构造一个使 src/ 出 bug 但全套测试仍绿的变异？
      能则标记 needs-review（不可删），否则才是 safe-refactor 候选
    - test/pbt/ 与 test/e2e/ 本轮只允许"提取重复 generator / 减少重复 setup"，
      不允许合并或删除用例（PBT 合并 generator 可能收窄采样空间，e2e 是
      envelope/exit-code 契约的唯一端到端守护，两者风险与普通 unit test 不同）

Stage B: Claude 执行 + 验证
  从建议中挑选 3-5 个 safe-refactor 优先、跨文件共性问题落地（收窄自原 5-10 个）：
    1. 应用改动前，对每个拟删除的 it() 做一次变异检查：临时改动对应 src 分支，
       确认测试变红，再改回来确认变绿，验证该用例不是唯一覆盖
    2. 应用改动（合并 it()、提取 helper、删除确认冗余的用例）
    3. 每完成一个文件改动后立即 `npx vitest run <file>` 局部验证
    4. 全部改动完成后跑 `npm test` 全量回归 + `npx vitest run --coverage`
       对比改动前后的 line/branch 覆盖率（不得下降）
    5. 确认 test/layering-guard.unit.test.js 等门禁测试仍通过
```

## Data Flow

- 输入：`test/**/*.test.js`（129 文件，只读给 Fable）
- Fable 输出：结构化文本建议（file:line + 描述 + 风险等级），不产出代码 diff
- Claude 输出：实际测试代码的 Edit，通过 git diff 追踪

## Boundaries

- Fable 只读 `test/`，不允许建议修改 `src/`
- Claude 是唯一的代码修改者；Fable 建议若涉及删除用例，Claude 需先确认该断言路径确实被其他现存用例覆盖（grep 交叉核对）后才执行

## Risk / Rollback

- 每个精简点是独立的 git 可回退单元（基线已干净）；如某项改动导致 `npm test` 失败且短时间无法定位，直接丢弃该项改动（不 `git commit --amend`，改动尚未提交时直接用 Edit 撤销）
- 不在此任务中改动 e2e 子进程隔离逻辑（临时路径设置），只精简用例结构，避免引入 auth/doctor 测试污染风险
- test/pbt/ 与 test/e2e/ 本轮排除在"合并/删除用例"范围外（见 Stage A），只做重复 setup/generator 提取

## Trade-offs

- 优先级子集（3-5 个）意味着本轮不会让总行数降到最优，但降低了单轮验证failure 的定位成本，且每项都能做到位变异检查
- "行数净减少"不再作为验收指标（提取 helper 短期可能增行，且诱导删断言凑数）；改用覆盖率对比 + 逐条删除项记录理由
