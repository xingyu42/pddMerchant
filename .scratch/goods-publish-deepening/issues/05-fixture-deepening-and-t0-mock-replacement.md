# 05: 商品发布 Fixture 深化（消除入口短路）与 T0 临时 Mock 退场

**What to build:** 移除商品发布服务入口处的 fixture 模式短路分支（消除该模块残余的 `runtime.mode === 'fixture'` 短路捷径），转而在组合根 Fixture 模式下装配无磁盘空源缓存、内存冷却、合成源观测/属性模板与内存 `DraftSession`，使离线 `PDD_TEST_ADAPTER=fixture` 完整穿过证据校验、建草稿前定价/预览图校验、建草稿后属性匹配、5 轮动态收敛、出站载荷校验与 `submitDraft` 提交链路。按“Replace, Don't Layer”清理 `#01` 中的临时适配器 `vi.mock`，替换为直接在 `publishGoodsFromLink` 接口注入内存 `GoodsPublishPort` 与挂载 `ctx.client` 的默认 `raw` `EndpointPort` 集成测试，并补齐 Live 适配器定向假页面单测与 CLI Fixture E2E 回归（同步更新测试数据工厂支持结构化合成样本）。参见 `../spec.md`。

**Blocked by:** 04, runtime-adapter-seams#06

**Status:** resolved

- [x] 商品发布不再在入口提前短路，Fixture 模式通过无磁盘空源缓存、内存冷却、合成源/模板与内存 `DraftSession` 完整穿过全部规划与写安全校验并零接触真实缓存目录
- [x] `#01` 中针对直接 Live 适配器的临时 `vi.mock` 全部移除，由跨越 `publishGoodsFromLink` + 内存 `GoodsPublishPort` + 默认 `raw` 的 `EndpointPort` 测试无缝接管全部场景
- [x] Live 表单适配器保留覆盖受信任点击、`disableSizeChart` 读回、`submitDraft` 风控与 `route.abort`/`unroute` 清理的假页面定向回归
- [x] `goods publish` / `goods templates` 的 Fixture E2E 与 `data-contract-v2`（含所有 CLI 参数、v2 视图字段与告警字段）及 `npm run check` 全绿

## Comments

- **2026-11-25**（合并提交 `6617cbfde60c96e71961e2aaf458787dabe3f50d`）：已合入 `ticket/goods-publish-deepening-05`（原提交 `40852e3cc4d30d57ad4a12f2e92e270a3f37f0e6`，共变更 18 个文件）。移除 `src/services/goods-publish.js` 入口处的 fixture 短路分支与 `default-port.js`/`form-filler.js` 残留兼容文件，在 `src/runtime/bundles/fixture-bundle.js` 与 `src/adapter/fixtures/goods-publish.js` 装配无磁盘空源缓存、内存冷却、合成源/模板及内存 `DraftSession` 使离线 Fixture 完整穿过规划、校验与提交链路；在 `test/services/goods-publish.test.js` 彻底清除 `#01` 临时 `vi.mock` 改用内存 `GoodsPublishPort` 与挂载 `ctx.client` 的 `EndpointPort`；新增 `test/e2e/goods-publish.e2e.test.js`，扩展 `draft-editor-submodules.test.js`、`merchant-draft-editor.test.js`、`data-contract-v2.test.js` 与 `test/fixtures/test-data.js`，并同步 `docs/architecture-overview.md`。合入后执行 `npm run check` 通过：`knip` 无多余导出/文件/依赖，Vitest 全量测试 `171 passed (171)`、`2696 passed | 1 skipped (2697)`（耗时 `82.52s`）。
