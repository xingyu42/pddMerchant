# Spec：商品发布深模块拆解与写安全进程内收敛

Status: ready-for-agent

来源：2026-11-24 架构深模块审查与 Design It Twice 评审（协同规格群实施拓扑：T0 前置表征测试可立即启动；P0-2 主体在 T2(P0-1b) 与 T0 完成后推进，可与 T3(P1-4)/T4(P1-3) 并行 → T5(P2-5)）。

## Problem Statement

商品发布核心编排模块扇出高达 25 个依赖模块，将消费端 `Source Product Fetch`、v4 临时源缓存管理、软封冷却、青果 `Source Fetch Proxy` 重试与浏览器错误归类、`Consumer Account Degradation` 账号态清理、外部类目解析、商家端 6 步强顺序表单操作、5 轮动态属性收敛循环、尺码表停用、满件折扣、保存校验与重复的提交判定全部混居在单一流程中，导致消费端任何抓包或代理改动都直接冲击商家端发布主干。

与此同时，既有测试保护网在历史提交（`cc0cb1c`）中被整体移除，当前全仓仅剩两条 v2 子进程契约用例与一条响应解释器单测，缺乏针对 1437 行商家表单适配器与 574 行编排器的行为表征护栏；商家表单填充适配器对外暴露 6 个强顺序依赖过程方法与 8 项校验入参，迫使调用方持有大量中间态；定价计划与属性校验时序交错，Fixture 模式则在入口处提前短路跳过全部纯规划与写安全校验；基础设施层滞留 3 个仅服务商品发布的单调用方单例模块，而全局软封冷却同时耦合消费端抓包与消费端登录。

## Solution

遵循“先护栏后拆解”策略，优先在 T0 阶段围绕现有 `publishGoodsFromLink` 建立表征测试安全网，再于 T2（P0-1b）之后直接由 P0-2 向 `composeCommandRuntime` 引入 **`GoodsPublishPort = { sourceFetcher, categoryResolver, draftEditor }`**（借助 P0-1 提供的 `EndpointPort`、`BrowserRuntimePort` 与 `AuthPort`）。沿消费端与商家端两条领域接缝将商品发布重构为高深度模块群：在消费侧抽离 **`SourceProductFetcher`** 深模块（消费与消费端登录共享的实例级软封冷却注入点，由 P0-2 负责在组合根建立）；在进程内沉淀纯计算核心（源归一化、预建草稿规划与建草稿后属性收敛、出站草稿载荷校验与草稿详情校验）；在商家侧收敛 **`CategoryResolverPort`** 与 **`MerchantDraftEditorPort`**（`openDraft` 返回 `{ draft, initialTemplate }`，`submitDraft` 在适配器内部经 `EndpointPort` 执行提交并保留风控校验与私有可中止写节流）。

同时修订 ADR-0001 与 `GLOSSARY.md` 中关于空壳/缺价代理重试的过时描述以对齐源码与规范真相，升级 Fixture 适配器通过无磁盘空缓存、内存冷却与内存 `DraftSession` 完整跑通纯规划与写安全校验，并清理失效的单调用方基础设施单例模块。

## User Stories

1. 作为重构推进者，我希望在改动商品发布任何源码之前先以 `publishGoodsFromLink` 为接缝补齐独立隔离的 T0 表征测试安全网（用例内停用或覆盖 `PDD_TEST_ADAPTER` 以免入口短路、显式注入隔离的内存/临时 `ctx.scrapeCooldown` 与 `ctx.sourceGoodsCache` 以严禁触碰仓库 `data/` 或 `tmp/`、使用假计时器或休眠替身消除 `rate-control` 真实等待并重置单例熔断器，且允许在 P0-2 完成前临时对直连 Live 适配器做 `vi.mock` 并待 `GoodsPublishPort` 就位后整批替换），完整覆盖代理基础设施重试、抓包空壳分类停转、消费者降级删态、5 轮动态收敛、严格出站载荷校验与成功后清缓存。
2. 作为商家与规范维护者，我希望商品发布继续严格限定青果 `Source Fetch Proxy` 仅用于消费端 `Source Product Fetch`，并按 ADR-0003 的 `Amended YYYY-MM-DD` 格式修订 ADR-0001 及更新 `GLOSSARY.md`（将与新口径冲突的旧词条 `Retryable Source Degradation` 退役并在 `_Avoid_` 中注明、启用准确描述仅重试基础设施故障的 `Retryable Source Proxy Fault`），使其与当前代码和领域规范一致。
3. 作为商家，我希望每次 `Proxy-Required Fetch` 尝试独占一份一次性的 `Source Proxy Lease` 与全新 `Proxy Attempt Context`，并在发生基础设施网络故障（`E_PROXY_UNAVAILABLE` / `E_PROXY_NETWORK`）时按 `[500, 1000]ms` 至多重试两次，以便安全跨过短效节点波动且永不静默回退本机直连。
4. 作为商家，我希望当源页面返回反爬空壳时立即停止代理轮换并记录软封冷却，而当页面首次出现价格或 SKU 缺失的 `Consumer Account Degradation` 信号时立即清除已失效的消费者登录态且跳过全局冷却写入，以便用精准的恢复动作替代误伤。
5. 作为商家，我希望商品发布继续先于冷却检查与代理配置校验读取 v4 临时源缓存，命中时直接跳过浏览器抓包与代理消耗，且仅在草稿验证保存或确认提交成功后才清理缓存，以便在表单或类目环节失败重试时复用既有源数据。
6. 作为商家，我希望定价计划（`buildPricingPlan` / `validatePricingPlan`）、SKU 颜色预览图及结构化源属性证据全部在调用 `openDraft` 之前完成预校验；随后 `openDraft` 创建草稿并获取绑定新草稿标识的 `initialTemplate` 交回编排器生成初始属性计划，以便既有前序校验失败不残留脏草稿，又严格遵循属性模板依赖草稿 ID 的真实时序。
7. 作为维护者，我希望 `SourceProductFetcher` 对外仅暴露单一 `prepare` 入口与 `SourceAcquisition` 生命周期句柄，以便消费端抓取、缓存与代理细节获得彻底的局部性（Locality）。
8. 作为维护者，我希望 5 轮同页动态属性收敛逻辑、出站草稿载荷校验与草稿详情校验全部保留在进程内纯模块中，以便在不启动 Patchright 浏览器的单元测试中直接覆盖这些高发故障路径。
9. 作为维护者，我希望原 1400 余行的商家表单自动化代码收缩在 `MerchantDraftEditorPort` 内部并按类目选品与模板读取、SKU/媒体填报、属性与预保存终态、拦截保存路由等职责内聚拆解，以便页面结构变化时只需局部调整对应内部适配器。
10. 作为维护者，我希望消除在业务层重复实现的 `assertSubmitSucceeded` 判定，将 `--confirm` 提交收回至 `MerchantDraftEditorPort.submitDraft` 内部经 `EndpointPort` 调用并复用响应解释器与端点 `errorMapper`（将“草稿已保存但提交被拒”提示迁移至 `errorMapper` 且保持 `submit` 视图字段不变），完整保留提交前后风控检查与私有可中止写节流。
11. 作为维护者，我希望任何阶段失败抛出的 `PddCliError` 均携带脱敏的 `detail.stage` 与 `detail.source_cached` 标志，同时严格剥离代理节点、AuthKey、图片 URL、URL 查询参数（如 `uin`）与原始 React 对象，以便快速排障且绝不泄露敏感信息。
12. 作为运维人员，我希望移除对单次进程无效的阶段熔断器与会话健康度计分模块，并将发布写操作节流器内聚为响应 `AbortSignal` 的适配器私有实例级节流器，以便按下 `Ctrl+C` 或超时时立即中断等待。
13. 作为维护者，我希望保留跨商品发布与消费端登录共用的软封冷却持久化存储，取消其全局单例并在命令运行时组合根由 P0-2 建立按实例创建的冷却注入点，同时让并行落地的 P1-3（T4）先通过可选注入参数平滑透传既有共享冷却配置，待 P0-2 落地时统一切换 `loginConsumer` 为组合根注入实例并撤除全局冷却单例导出。
14. 作为测试开发者，我希望 Fixture 模式下的商品发布摆脱入口提前短路，转而通过无磁盘空源缓存、内存冷却、合成源商品/模板与内存 `DraftSession` 完整跑通属性映射、动态收敛与出站载荷校验，以便离线集成测试具备更高保真度。
15. 作为测试开发者，我希望直接在顶层 `publishGoodsFromLink` 接口注入内存 `GoodsPublishPort`（`{ sourceFetcher, categoryResolver, draftEditor }`）与挂载在 `ctx.client` 的默认 `raw` `EndpointPort`，以便在几毫秒内覆盖代理重试、降级删态、动态收敛与载荷拦截中止等全部异常场景。
16. 作为 CLI 与 AI 调用方，我希望所有命令行参数、dry-run 默认建草稿语义、`--confirm` 提交、告警通道字段（如 `source_proxy_retry_recovered`、`source_cache_cleanup_failed`、`property_mapping_partial`、`draft_verification_unavailable`）与 v2 输出视图保持完全兼容。

## Implementation Decisions

### 领域深模块划分、时序修正与接口收敛

- **引入 `GoodsPublishPort` 聚合端口**：由 P0-2 在命令运行时组合根直接引入并装配 `GoodsPublishPort = { sourceFetcher, categoryResolver, draftEditor }`，消除 P0-1 中的未消费预留导出。
- **消费端深模块 `SourceProductFetcher`（并修正 ADR-0001 与术语表口径）**：
  - 对外提供 `prepare(goodsUrl)`，返回 `SourceAcquisition` 生命周期句柄（包含纯数字 `goodsId`、`cacheHit` 标志、`fetch({ signal, consumerAccount })` 与 `clearCache(warnings)`）。
  - 执行严格前置顺序：`prepare` 先归一化 `goodsId` 并读取 v4 临时缓存；缓存命中短路冷却检查、代理配置校验与消费端抓取。缓存未命中时立即执行持久冷却检查与 `Proxy-Required Fetch` 配置校验，保证无效代理配置或活跃冷却在运费模板接口请求及代理租约提取之前快速失败。
  - `fetch` 按模式执行直连或受控代理抓取：每轮从 P0-1 `BrowserRuntimePort` 派生继承当前 `Runtime Browser Profile` 的全新只读 `Proxy Attempt Context`，仅在 `E_PROXY_UNAVAILABLE` 与 `E_PROXY_NETWORK` 时按 `[500, 1000]ms` 可中止退避最多重试两次并产出 `source_proxy_retry_recovered`；Chromium `ERR_TUNNEL_CONNECTION_FAILED` 映射 `E_PROXY_AUTH` 并单次中止；严格先识别反爬空壳页（记注入冷却、保留消费者登录态、禁止轮换代理），再识别价格/SKU 缺失确认 `Consumer Account Degradation`（立即通过本地可替代的消费端登录态存储删除失效登录态并跳过全局冷却）；完整通过校验后原子写入 v4 缓存。
  - 按 ADR-0003 的 `Amended YYYY-MM-DD` 节形式修订 ADR-0001，并将术语表旧词条 `Retryable Source Degradation` 退役（记入 `_Avoid_`）且启用准确反映“仅代理基础设施故障可重试”的新词条（如 `Retryable Source Proxy Fault`），统一文档、术语与现源码契约。
  - `clearCache` 仅在已验证草稿保存（默认模式）或确认提交成功（`--confirm`）之后执行；清理文件系统失败仅追加 `source_cache_cleanup_failed` 告警且维持成功结果。
- **进程内纯写安全与规划核心（分清建草稿前/后边界，零浏览器、零环境变量、零 I/O 依赖）**：
  - `source-normalizer` 模块统一承接消费端观测数据归一化、空壳与降级前置分类、元转分精确换算（含 `linePrice` 到 `sourceReferencePriceCents` 与不加价规则）、以及 v4 缓存白名单投影与旧版拒绝。
  - `draft-planner` 严格区分两阶段职责：**建草稿前规划**完成商品预览图计划、SKU 定价与参考价校验、满件折扣运行配置校验（`0.50–0.99`）与结构化源属性证据准备，阻断非法输入在先；**建草稿后规划**接收 `openDraft` 返回的绑定草稿标识 `initialTemplate`，生成初始属性计划（含 `refPid`、精确全名、既有唯一别名与冗余值折叠）并驱动 5 轮 `reconcileDynamicTemplate` 动态属性有界合并与增量筛选。
  - `draft-guard` 模块统一承接发包前 `prepareEditPayload`（注入 `cost_template_id` 并校验标题、画廊、运费模板、`two_pieces_discount`、逐 SKU 价格/库存/组合、全部收敛属性 ID 与 `vid`、精确 `thumb_url`）及保存后 `verifyDraftDetail`（严格区分网络/业务/空结果导致的 `draft_verification_unavailable` 与确认缺字段造成的 `E_BUSINESS`）。
- **商家端外部 Port 与 `DraftSession`**：
  - `CategoryResolverPort` 提供实例级 `resolve(catIds, { signal })`（消除模块级熔断计数器单例）。
  - `MerchantDraftEditorPort` 提供三个高层操作：`openDraft({ categorySearchText, signal })`（建草稿并在同草稿上提取与返回 `{ draft, initialTemplate }`）、`populateAndSaveDraft({ draft, plan, initialPropertyPlan, signal })`（内部经声明式 `DraftSession` 接缝驱动 5 轮动态属性收敛、`prepareEditPayload` 出站拦截门禁与 `verifyDraftDetail`）以及 `submitDraft(draft, { signal })`。
  - Live 适配器内部将原巨型表单自动化逻辑按职责拆分为私有的类目建草稿与初始模板提取、SKU/媒体填报、属性与预保存终态（保证属性填在图片/SKU/价格之后、受信任点击触发依赖链、官方两步停用尺码表及 DOM 读回、满件折扣输入读回）、保存拦截路由（异常必 `unroute`，失配必 `route.abort`）等子模块，并在内部集中执行阶段间风控检查。
  - `submitDraft` 在适配器内部经 P0-1 `EndpointPort` 发起确认提交，完整保留提交前后 `assertNoRiskControl` 检查与私有可中止写节流；删除业务层冗余 `assertSubmitSucceeded`，将“草稿已保存但提交被拒”的提示语迁移至提交端点规格的错误映射 `errorMapper` 中，并确保 `submit` 视图字段保持原样。
- **精简顶层编排器 `publishGoodsFromLink`**：
  - 编排器外部扇出从 25 收敛至仅依赖错误基元、纯规划模块、`GoodsPublishPort`、`EndpointPort`（仅通过 `ctx.client` 支持模板查询或辅助端点）与发布视图模块，编排器仅向下游端点与适配器透传 P0-1 的不透明 `ctx.page` 令牌（供运费模板等查询端点使用），禁止在编排器内直接调用 Playwright 页面操作；`--confirm` 提交直接委托给 `draftEditor.submitDraft(...)`。
  - 全部抛出的 `PddCliError` 统一附加脱敏的 `detail.stage` 与 `detail.source_cached` 元信息，延续既有的敏感信息脱敏纪律。

### Fixture 模式深化、软封冷却注入点与单调用基础设施清理

- Fixture 模式下彻底退出服务入口短路，改为通过 `composeCommandRuntime` 装配无磁盘空源缓存（确保 Fixture 零接触真实缓存目录）、内存冷却存储、合成源观测、合成类目与内存 `DraftSession`，使测试离线跑通全部证据检验、建草稿前定价/预览图校验、建草稿后属性匹配、5 轮动态收敛、出站载荷校验与 `submitDraft` 提交链路。
- 清理 3 个单调用方基础设施模块：删除仅服务于单个命令生命周期且达不到触发阈值的阶段熔断器与会话健康度模块；将写速率控制器从基础设施层移除，改为 Live 商家编辑适配器私有的实例级可中止写节流器（响应 `AbortSignal`，Fixture 与测试路径零等待）；保留跨两域共用的软封冷却存储为持久化基础设施，由 P0-2 在组合根建立实例级注入点并切换 `SourceProductFetcher` 与 P1-3 `loginConsumer`（与 P1-3 并行期间，P1-3 先经可选注入参数沿用共享冷却配置兜底，待 P0-2 落地时统一撤除全局冷却单例导出与兜底分支）。
- 将分散的 `PDD_SOURCE_PROXY_*`、`PDD_SCRAPE_SIMULATE`、`PDD_IMAGE_TRANSFORM` 读取与 `isMockEnabled()` 判断彻底移入组合根装配层。

## Testing Decisions

1. **T0 前置表征测试（安全护栏，改动源码前优先完成）**
   针对既有 `publishGoodsFromLink`（`src/services/goods-publish.js`）率先编写独立隔离的表征测试，严格遵守以下四条隔离规范：
   - ① 在用例内显式关闭或覆盖 `PDD_TEST_ADAPTER`（否则 `goods-publish.js:385` 会在全局 `test/setup.js` 夹具模式下直接短路）；
   - ② 在 P0-2 端口改造完成前允许临时对直连 Live 适配器（`form-filler`、`source-scraper`、`category-resolver`、`dynamic-property-template`、`qingguo-proxy` 与 `createConsumerContext`）使用 `vi.mock`，待 P0-2 主体落地后按“Replace, Don't Layer”整体替换为内存 `GoodsPublishPort`；
   - ③ 必须向 `ctx` 注入内存/临时 `ctx.scrapeCooldown` 与 `ctx.sourceGoodsCache`（`goods-publish.js:357,362`），严格禁止写入仓库 `data/` 或 `tmp/` 真实目录；
   - ④ 使用假计时器或休眠桩消除 `rate-control` 各写阶段 `2–8s × 6` 的真实等待，并在每个用例前重置单例熔断器状态。
   精准锁定五条核心契约：`goods-publish.js:247–264` 代理重试、`source-scraper` 反爬空壳识别与立即停转、`L188–200` 消费者降级删除消费端登录态且不写冷却、`L468–505` 5 轮动态收敛迭代、`L522–538` 严格出站载荷校验拦截，以及 `L556` 验证保存或确认提交成功后才清理 v4 缓存。
2. **主业务接缝：`publishGoodsFromLink` + 内存 `GoodsPublishPort` + 默认 `raw` 的 `EndpointPort`（`ctx.client`）**
   在无浏览器、无模块劫持条件下跨越顶层接口验证全量编排与异常分支：v4 缓存命中短路、代理配置非法先于运费模板中止、代理基础设施错误 `[500, 1000]ms` 重试与 `source_proxy_retry_recovered` 告警、407/`ERR_TUNNEL_CONNECTION_FAILED` 单次中止、空壳墙记录冷却并保登录态 vs 缺价/缺 SKU 触发 `Consumer Account Degradation` 立即删消费端登录态、预定价失败阻断于 `openDraft` 之前、`openDraft` 返回 `initialTemplate` 驱动建草稿后属性规划、5 轮动态属性收敛与超时上限、出站载荷失配中止且保留缓存、详情不可用降级告警与可用缺字段严检报错，以及 `draftOnly` 零提交、`submitDraft` 提交前后风控与提示保持和成功后清缓存。
3. **纯计算核心接缝：`source-normalizer` / `draft-planner` / `draft-guard` 表驱动单元测试**
   聚焦验证元转分精确解析、参考价严格大于单买价、MobX/React 结构边界、属性唯一匹配与已知别名折叠、动态模板冲突拒绝、出站载荷各项校验码与 URL 脱敏细节。
4. **CLI 端到端接缝与 Live 适配器定向回归**
   通过 `PDD_TEST_ADAPTER=fixture` 子进程验证 `goods publish` 与 `goods templates` 的单行 JSON envelope、`meta.warnings` 透传、v2 字段集契约；针对 Live 适配器自身内部接缝保留轻量假页面单元测试，覆盖 `openDraft` 含模板返回、拆分表头、受信任点击、`quick_decoration` 详情输入、`disableSizeChart` 双步读回、`submitDraft` 提交前后风控及写节流中止、以及 `route.abort` / `unroute` 清理。
5. **淘汰冗余测试（Replace, Don't Layer）与新增测试基线（New Baseline）**
   - 删除针对已移除阶段熔断器、会话健康度模块及全局冷却单例子例的测试。
   - **新增基线说明**：原历史商品发布单测、青果代理单测、表单填充与动态属性单测及旧 E2E 测例已在过往提交 `cc0cb1c` 中移除；目前仅可复用的现存基线为 `test/contract/data-contract-v2.test.js`（L271–278 的 2 条子进程契约用例）与 `test/adapter/response-interpreter.test.js`（L17 解释器单测），全套单元与 E2E 覆盖均由本规格 T0 表征测试起新建并落盘（完成后运行 `npm run check`）。

## Out of Scope

- P0-1 双组合根与基础外部端口建设（见 `.scratch/runtime-adapter-seams/`）。
- 引入多代理供应商框架（ADR-0001 明确仅集成青果短效代理）。
- 改变既有的定价策略、满件折扣率区间、尺码表停用策略或属性精确匹配写安全规则。
- 开发单命令多链接批量上货引擎或重构既有的图片变换算法细节。

## Further Notes

- 建议实施节奏：立刻独立先行完成 **T0 前置表征测试（Story 1）**；在 P0-1（T1/T2）落地之后推进商品发布主体拆解，此时可与 P1-4（T3）、P1-3（T4）安全并行实施（采用无阻塞协同规则：P1-3 先接受可选注入冷却并以旧共享配置兜底，待 P0-2 建立组合根软封冷却实例注入点后统一切换并删除全局冷却单例）。
- 因 Fixture 模式升级为穿过完整规划与模板加载链路，测试数据工厂需同步补充结构化源商品、属性模板与草稿详情的合成样本。
- 全部离线回归通过后，后续可由运维执行一次不带 `--confirm` 的受控真机草稿保存抽检，确认线上表单选择器稳定。
