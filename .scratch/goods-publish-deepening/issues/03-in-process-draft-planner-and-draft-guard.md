# 03: 进程内纯写安全核心（`draft-planner` 两阶段规划 + `draft-guard` 校验）

**What to build:** 在进程内沉淀零浏览器、零环境变量、零 I/O 依赖的商品发布纯写安全计算核心：`draft-planner` 与 `draft-guard`。`draft-planner` 严格区分两阶段职责——建草稿前完成预览图计划、`buildPricingPlan`/`validatePricingPlan`（含 `0.50–0.99` 满件折扣）与结构化源属性证据准备，阻断非法输入在创建商家草稿之前；建草稿后基于绑定草稿标识的 `initialTemplate` 生成初始属性计划（精确全名、`refPid`、既有唯一别名与冗余折叠）并驱动 5 轮 `reconcileDynamicTemplate` 动态属性收敛。`draft-guard` 统一承接发包前 `prepareEditPayload` 拦截校验（逐 SKU、属性、画廊、`cost_template_id`、`thumb_url` 等）与保存后 `verifyDraftDetail` 校验（严格区分 `draft_verification_unavailable` 降级与确认缺字段 `E_BUSINESS`）。参见 `../spec.md`。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] `draft-planner` 明确隔离“建草稿前定价/预览图/源证据规划”与“基于 `initialTemplate` 的建草稿后初始属性规划及 5 轮动态收敛”，保持零浏览器与零 I/O 依赖
- [ ] `draft-guard` 完整封装 `prepareEditPayload` 出站严检与 `verifyDraftDetail` 保存校验（准确区分网络/空结果降级告警与确认缺字段 `E_BUSINESS` 拦截）
- [ ] 为 `draft-planner` 与 `draft-guard` 配齐表驱动单元测试，完整覆盖元转分、参考价规则、别名折叠、动态冲突拒绝、出站错误码与 URL/敏感对象剥离
- [ ] 现有商品发布流程（及 T0 表征测试）与 `npm run check` 全部通过
