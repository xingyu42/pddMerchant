# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-04-21 | `019dafad-7c54` | _(pending)_ | chore(context): 初始化 .context/ 上下文管理骨架 | 启用 .context/ 决策追踪（拒绝 CHANGELOG.md 方案） | - | 低 |
| 2026-04-22 | `2e0c90e4-2881` | _(pending)_ | feat(test): 引入 fixture mock adapter seam 与 V0 smoke/e2e 测试套件 | PDD_TEST_ADAPTER=fixture 作为 mock 总开关；OPSX 产物 gitignore | - | 低 |
| 2026-04-22 | `2e804dba-c225` | _(pending)_ | fix(v0): 修复 V0 导航超时、认证抖动与店铺上下文识别 | resolveMallContext 集中解析器（state→url→cookie→storage→dom）；isAuthValid 引入重试；waitUntil 默认 domcontentloaded | V0-Bug-A/B/C | 中 |
