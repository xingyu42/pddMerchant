# 04: 商家端 `CategoryResolverPort`、`MerchantDraftEditorPort`（含 `submitDraft`）与单调用基建清理

**What to build:** 收敛实例级 `CategoryResolverPort` 与 `MerchantDraftEditorPort`（交付声明式 `DraftSession` 与三大高层操作：`openDraft` 创建草稿并返回 `{ draft, initialTemplate }`、`populateAndSaveDraft` 驱动 5 轮动态属性收敛/出站拦截/保存校验、`submitDraft` 在适配器内部经 P0-1 `EndpointPort` 发送 `--confirm` 提交并保留提交前后 `assertNoRiskControl` 与私有可中止写节流）。将原 1400 余行表单填充逻辑内聚拆分为私有子模块，向组合根挂入 `GoodsPublishPort = { sourceFetcher, categoryResolver, draftEditor }`，将 `publishGoodsFromLink` 编排器扇出由 25 降至高内聚核心（编排器仅向下透传 P0-1 不透明 `ctx.page` 令牌供运费模板查询，禁止直接调用 Playwright 页面操作）；同时删去业务层冗余的 `assertSubmitSucceeded`（将“草稿已保存但提交被拒”提示迁移至提交端点 `errorMapper` 并保持 `submit` 视图字段不变），统一附加脱敏的 `detail.stage` / `detail.source_cached`，并删除无效的单调用方阶段熔断器与会话健康度计分模块。参见 `../spec.md`。

**Blocked by:** 02, 03, runtime-adapter-seams#04

**Status:** ready-for-agent

- [ ] `CategoryResolverPort`（实例级，无模块级熔断单例）与 `MerchantDraftEditorPort`（`openDraft`、`populateAndSaveDraft`、`submitDraft`）及其 Live 私有拆分适配器（含响应 `AbortSignal` 的私有写节流与异常必 `unroute`）就位
- [ ] `submitDraft` 内部经 `EndpointPort` 执行提交并维持提交前后 `assertNoRiskControl` 与写节流；删去 `assertSubmitSucceeded` 并将“草稿已保存但提交被拒”提示迁至提交端点 `errorMapper`，`submit` 视图字段与告警保持兼容
- [ ] `GoodsPublishPort = { sourceFetcher, categoryResolver, draftEditor }` 由 P0-2 挂入 `composeCommandRuntime`；`publishGoodsFromLink` 仅透传不透明 `ctx.page` 令牌且抛出错误均带脱敏 `detail.stage` 与 `detail.source_cached`
- [ ] 删除无效的阶段熔断器、会话健康度计分与共享写速率控制器全局模块（及对应旧单例测试），全量测试与 `knip` 无孤立导出校验通过
