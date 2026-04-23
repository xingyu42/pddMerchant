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
| 2026-04-23 | `8b6d83b2-1fba` | _(pending)_ | feat(doctor): --probe=xhr 主动 reload 激活 XHR 探测窗口 (V0.2 #3) | 新增 doctor --probe mode flag；resolveMallContext 加 activeProbeReload 在 storage 与 xhr 层之间插入主动 reload；reload 失败不阻断；doctor 返回 mall_source 字段透出命中层 | - | 低 |
| 2026-04-23 | `17f106f0-9e3b` | _(pending)_ | feat(run-endpoint): 进程级 rate-limit 冷却状态机 (V0.2 #7) | threshold=3 / 5min cooldown；runEndpoint 外层 try/catch 拦截 E_RATE_LIMIT 计数；HTTP 429 exhaustion + 业务码 54001 统一入账；env PDD_COOLDOWN_THRESHOLD/MS 覆盖；_cooldownRemainingMs 过期自动清 state | - | 低 |
| 2026-04-23 | `1b1cdca3-21cd` | _(pending)_ | feat(diagnose): inventory goods.list 全量分页收集器 (V0.2 #5) | 新建 services/diagnose/goods-collector.js (cap=500/pageSize=50/maxPages=10) 照抄 orders-collector 范式；collectGoodsInput 切换全量分页；新字段 goodsScanTruncated/RateLimited；inventory-health 不改 — 既有 hint 逻辑自动覆盖；test/goods-collector.unit.test.js 10 新测试暂未入 package.json (避免 V0.1 PBT drift) | - | 低 |
| 2026-04-23 | `181391cd-f772` | _(pending)_ | test: 归档 V0.1 PBT 套件 + real-call 产物 + V0.2 #5/#7 测试 wiring | V0.1 §6 PBT 4 套件 (含零依赖 mulberry32 harness) 一次性入库；§7.2 real-call runner + 回归快照入库；package.json test 脚本扩 168→178；含 V0.2 迭代期微调 (DDK 注释 / #7 cooldown 2 条 PBT) 统一入库 | - | 低 |
