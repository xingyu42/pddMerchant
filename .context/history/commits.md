# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-04-21 | `019dafad-7c54` | _(pending)_ | chore(context): 初始化 .context/ 上下文管理骨架 | 启用 .context/ 决策追踪（拒绝 CHANGELOG.md 方案） | - | 低 |
| 2026-04-22 | `2e0c90e4-2881` | _(pending)_ | feat(test): 引入 fixture mock adapter seam 与 V0 smoke/e2e 测试套件 | PDD_TEST_ADAPTER=fixture 作为 mock 总开关；OPSX 产物 gitignore | - | 低 |
| 2026-04-22 | `2e804dba-c225` | _(pending)_ | fix(v0): 修复 V0 导航超时、认证抖动与店铺上下文识别 | resolveMallContext 集中解析器（state→url→cookie→storage→dom）；isAuthValid 引入重试；waitUntil 默认 domcontentloaded | V0-Bug-A/B/C | 中 |
| 2026-04-23 | `4f45872c-49b3` | _(pending)_ | feat(v0.1): 落地 fill-v0-placeholders Sections 1-5 与 real-call 暴露的 shop 采集竞态修复 | runEndpoint 合约扩展 (nav.url fn / errorMapper / 429 retry)；mall state paths 扩到 12 条 + XHR probe；funnel 改订单履约漏斗；inventory D16 per-item 改回 global fallback（matched_by='mixed' 常态）；shop 采集双层 page 隔离；AUTH_STATE_PATH 支持 env 覆盖 | V0.1-SHOP-RACE / ORDERS-DOUBLE-GOTO / AUTH-TEST-ISOLATION | 中 |
| 2026-04-23 | `449fa733-1750` | _(pending)_ | refactor(promo): 移除 DDK (多多客) 占位命令 | 走 OpenSpec 三段式流程归档 breaking change；新建 promo capability spec 用 ADDED + 负向 Scenario 锁定子命令范围；exit code 由 1 (GENERAL) 变更为 2 (USAGE)；README 新增 V0.2 Migration Notes 节；scope 仅 DDK 触点，V0.1 leftover 留待单独 commit | - | 低 |
