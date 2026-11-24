# 05: 商品发布 Fixture 深化（消除入口短路）与 T0 临时 Mock 退场

**What to build:** 移除商品发布服务入口处的 fixture 模式短路分支（消除该模块残余的 `runtime.mode === 'fixture'` 短路捷径），转而在组合根 Fixture 模式下装配无磁盘空源缓存、内存冷却、合成源观测/属性模板与内存 `DraftSession`，使离线 `PDD_TEST_ADAPTER=fixture` 完整穿过证据校验、建草稿前定价/预览图校验、建草稿后属性匹配、5 轮动态收敛、出站载荷校验与 `submitDraft` 提交链路。按“Replace, Don't Layer”清理 `#01` 中的临时适配器 `vi.mock`，替换为直接在 `publishGoodsFromLink` 接口注入内存 `GoodsPublishPort` 与挂载 `ctx.client` 的默认 `raw` `EndpointPort` 集成测试，并补齐 Live 适配器定向假页面单测与 CLI Fixture E2E 回归（同步更新测试数据工厂支持结构化合成样本）。参见 `../spec.md`。

**Blocked by:** 04, runtime-adapter-seams#06

**Status:** ready-for-agent

- [ ] 商品发布不再在入口提前短路，Fixture 模式通过无磁盘空源缓存、内存冷却、合成源/模板与内存 `DraftSession` 完整穿过全部规划与写安全校验并零接触真实缓存目录
- [ ] `#01` 中针对直接 Live 适配器的临时 `vi.mock` 全部移除，由跨越 `publishGoodsFromLink` + 内存 `GoodsPublishPort` + 默认 `raw` 的 `EndpointPort` 测试无缝接管全部场景
- [ ] Live 表单适配器保留覆盖受信任点击、`disableSizeChart` 读回、`submitDraft` 风控与 `route.abort`/`unroute` 清理的假页面定向回归
- [ ] `goods publish` / `goods templates` 的 Fixture E2E 与 `data-contract-v2`（含所有 CLI 参数、v2 视图字段与告警字段）及 `npm run check` 全绿
