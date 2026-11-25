# 01: 商品发布 T0 前置表征测试安全网

**What to build:** 在改动任何商品发布业务或适配器源码之前，围绕既有的 `publishGoodsFromLink` 主入口编写独立隔离的表征测试套件，精确锁定当前真实行为，为后续拆解 1400 余行表单填充与高扇出编排器建立安全回归护栏。测试严格遵守四项隔离规则：在用例内显式关闭或覆盖 `PDD_TEST_ADAPTER` 以跳过入口夹具短路；允许临时对直连 Live 适配器（表单填充、源抓包、类目解析、动态属性模板、青果代理与消费端上下文创建）使用 `vi.mock`（待后续 P0-2 端口完成后整体替换）；向执行上下文注入隔离的内存或临时目录 `scrapeCooldown` 与 `sourceGoodsCache`，严禁写入仓库敏感数据目录；使用假计时器或休眠桩消除写速率控制真实等待，并在每条用例前重置单例熔断器状态。参见 `../spec.md`。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 用例内覆盖/停用 `PDD_TEST_ADAPTER` 跳过入口短路，并在每条用例前后隔离恢复环境，严格零触碰仓库真实数据目录与临时缓存目录
- [x] 注入内存或临时目录 `ctx.scrapeCooldown` 与 `ctx.sourceGoodsCache`，使用假计时器消除写节流等待并逐用例重置单例熔断器
- [x] 临时 `vi.mock` 覆盖范围清晰可替换，真实穿过 `publishGoodsFromLink` 验证五条写安全主边界：代理故障 `[500, 1000]ms` 重试与恢复告警、抓包空壳分类停转、首次消费者降级删态且跳过冷却写入、5 轮同页动态属性收敛、出站载荷校验拦截与成功后清缓存
- [x] 表征测试稳定可重复执行且 `npm run check` 通过

## Comments

- 2026-11-25: 已合入 `feat/runtime-adapter-seams`（合并提交 `60e77ba`、`dc55b51`）。新增 `test/services/goods-publish.test.js`（1519 行，27 个表征测试用例），覆盖代理 `[500, 1000]ms` 重试与恢复告警、抓包空壳冷却、首次消费者降级删态、5 轮动态属性收敛、出站载荷严格校验、保存/提交后清理缓存，以及针对仓库 `data/` 与 `tmp/goods-publish-source-cache/` 目录前后的快照隔离断言。合入后执行 `npm run check` 全量通过：`npm run lint`（`knip`）退出码 0；`npm test`（`vitest run`）141 个测试文件全部通过（`141 passed (141)`），2374 个用例通过、1 个 Windows 环境用例跳过（`2374 passed | 1 skipped (2375)`），其中 `test/services/goods-publish.test.js` 27/27 通过。
