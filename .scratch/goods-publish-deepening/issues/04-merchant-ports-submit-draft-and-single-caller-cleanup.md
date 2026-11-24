# 04: 商家端 `CategoryResolverPort`、`MerchantDraftEditorPort`（含 `submitDraft`）与单调用基建清理

**What to build:** 收敛实例级 `CategoryResolverPort` 与 `MerchantDraftEditorPort`（交付声明式 `DraftSession` 与三大高层操作：`openDraft` 创建草稿并返回 `{ draft, initialTemplate }`、`populateAndSaveDraft` 驱动 5 轮动态属性收敛/出站拦截/保存校验、`submitDraft` 在适配器内部经 P0-1 `EndpointPort` 发送 `--confirm` 提交并保留提交前后 `assertNoRiskControl` 与私有可中止写节流）。将原 1400 余行表单填充逻辑内聚拆分为私有子模块，向组合根挂入 `GoodsPublishPort = { sourceFetcher, categoryResolver, draftEditor }`，将 `publishGoodsFromLink` 编排器扇出由 25 降至高内聚核心（编排器仅向下透传 P0-1 不透明 `ctx.page` 令牌供运费模板查询，禁止直接调用 Playwright 页面操作）；同时删去业务层冗余的 `assertSubmitSucceeded`（将“草稿已保存但提交被拒”提示迁移至提交端点 `errorMapper` 并保持 `submit` 视图字段不变），统一附加脱敏的 `detail.stage` / `detail.source_cached`，并删除无效的单调用方阶段熔断器与会话健康度计分模块。参见 `../spec.md`。

**Blocked by:** 02, 03, runtime-adapter-seams#04

**Status:** resolved

- [x] `CategoryResolverPort`（实例级，无模块级熔断单例）与 `MerchantDraftEditorPort`（`openDraft`、`populateAndSaveDraft`、`submitDraft`）及其 Live 私有拆分适配器（含响应 `AbortSignal` 的私有写节流与异常必 `unroute`）就位
- [x] `submitDraft` 内部经 `EndpointPort` 执行提交并维持提交前后 `assertNoRiskControl` 与写节流；删去 `assertSubmitSucceeded` 并将“草稿已保存但提交被拒”提示迁至提交端点 `errorMapper`，`submit` 视图字段与告警保持兼容
- [x] `GoodsPublishPort = { sourceFetcher, categoryResolver, draftEditor }` 由 P0-2 挂入 `composeCommandRuntime`；`publishGoodsFromLink` 仅透传不透明 `ctx.page` 令牌且抛出错误均带脱敏 `detail.stage` 与 `detail.source_cached`
- [x] 删除无效的阶段熔断器、会话健康度计分与共享写速率控制器全局模块（及对应旧单例测试），全量测试与 `knip` 无孤立导出校验通过

## Comments

- **2026-11-25**（合并提交 `a943119f667dca73a42405b9d48872428f310f25`）：已合入 `ticket/goods-publish-deepening-04`（原提交 `0d89a5eca1b1d2d92c526bb0872f2ce80a47d393`，共变更 27 个文件）。收敛实例级 `CategoryResolverPort` 与 `MerchantDraftEditorPort`（含 `openDraft`、`populateAndSaveDraft`、`submitDraft`）及 `src/adapter/goods-publish/draft-editor/` 私有拆分模块（含可中止写节流与异常必 `unroute`）；在组合根挂入 `GoodsPublishPort`（`default-port.js`、`live-bundle.js`、`fixture-bundle.js`、`command-runtime.js`），精简 `publishGoodsFromLink` 并统一脱敏 `detail.stage` / `detail.source_cached`；移除 `assertSubmitSucceeded`（由提交端点 `errorMapper` 提示），删除 `src/infra/circuit-breaker.js`、`src/infra/rate-control.js` 与 `src/infra/session-health.js`；新增 `category-resolver`、`draft-editor-submodules`、`merchant-draft-editor`、`write-throttle` 与 `goods-publish-port` 测试，同步更新 `docs/architecture-overview.md`。合入后执行 `npm run check` 通过：`knip` 无多余导出/文件/依赖，Vitest 全量测试 `170 passed (170)`、`2687 passed | 1 skipped (2688)`（耗时 `78.87s`）。
