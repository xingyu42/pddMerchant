# Spec：碎模块、大参数内部接缝与跨领域错位清理

Status: ready-for-agent

来源：2026-11-24 架构深模块审查与 Design It Twice 评审（协同规格群实施拓扑：T5 —— 在 P0-1、P1-4、P1-3 与 P0-2 全部落地后收尾）。

## Problem Statement

在 P0-1 至 P1-4 完成核心接缝收敛与重点子系统加深后，代码库仍残留若干通不过删除测试、内部接口偏宽或目录归属错位的次级结构摩擦：被商品利润、商品分层、售后诊断与库存分析四个领域共同复用的订单分页采集函数（`collectOrdersForStaleAnalysis`），仍寄居在诊断子目录并沿用窄化历史命名，同时商品诊断采集模块中存在镜像其分页上限、休眠与限流截断逻辑的重复分页采集实现（`collectAllGoods`，硬编码非可中止 200ms 休眠并在注释中互相指向）。

此外，推广领域存在一个仅 9 行且有 4 个跨模块消费方依赖的路由透传文件；端点单次尝试辅助接收 10 字段大参数对象并与 `page-api` 路径存在重复的超时预算裁剪与导航错误包装逻辑；商品利润领域的私有计算子文件存在 4 处单元测试直接穿透导入（区别于诊断总入口向报表模块及约 40 处单测合法提供纯计算 `summarize*` 公开函数面）；项目架构导航技能第 56 行残留已删除的 `mall-switcher` 模块引用（区别于店铺读写适配器内部真实使用的页面 DOM 选择器与提示文案）。

## Solution

在严格遵循“仅在真实存在至少两套适配器的外部接缝引入 Port”与“保持 SQLite 为本地可替代（Local-substitutable）内部接缝”原则的前提下，给出全部闭合定稿：

1. 将跨领域订单分页采集归位至订单领域主模块（重命名为 `collectOrdersWindow`），抽取并共享同一套支持取消信号的可中止有界分页原语供 `collectOrdersWindow` 与镜像模块 `collectAllGoods` 共同复用（清除过时镜像注释）。
2. 保留既有的**中性推广领域模块（`promo`）**并吸收合并独立的 `promo-roi` 逻辑（统一提供 `getPromoReport`、`analyzePromoRoi` 与 `getPromoRoiView`），同步更新对应命令、商品分层与单测导入，使诊断、商品利润、商品分层继续依赖中性推广领域并消除过薄透传与冗余模块文件。
3. 明确**保留独立店铺领域服务**（不并入视图以免破坏视图纯度，不并入命令处理器以免越层依赖适配器）。
4. 收窄端点尝试辅助的 10 字段大参数接口并抽取共享的带剩余预算裁剪页面导航助手，消除与 `page-api` 之间的超时和 `E_NETWORK` 错误包装重复。
5. 保留诊断总入口对纯计算 `summarize*` 函数的公开纯函数导出面（供诊断报表模块与既有纯函数断言稳定消费），同时锁定商品利润唯一公开接口 **`getGoodsProfitView`**，将商品利润 4 处穿透内部子模块的单元测试迁回 `getGoodsProfitView` 并将单消费者利润子文件全面收为私有实现；严格将 `mall-switcher` 清理限定于架构导航技能过期模块引用（保留店铺读写源码中的 DOM 选择器与 UI 文案），同步刷新架构总览并将账号与守护进程存储宽表重构明确划入 `Out of Scope`。

## User Stories

1. 作为商品利润、商品分层与售后/库存诊断的维护者，我希望跨领域复用的订单分页窗口采集能力归位于订单领域模块（`collectOrdersWindow`），并与商品镜像分页采集（`collectAllGoods`）共享同一支持取消信号的有界分页原语，以便消除重复分页循环并在订单域直觉定位该能力。
2. 作为推广、诊断与利润领域的维护者，我希望保留中性推广领域模块 `promo` 并吸收合并 `promo-roi`（共同导出 `getPromoReport`、`analyzePromoRoi` 与 `getPromoRoiView`），同步更新推广 ROI 命令、商品分层与相关单测导入路径，以便诊断、商品利润与商品分层继续依赖中性推广领域且彻底消除过薄透传与冗余模块。
3. 作为端点传输层的维护者，我希望收窄端点尝试辅助的 10 字段配置参数对象，并统一 `page-api` 与 `fetch`/`legacy` 两条路径的剩余预算计算、导航超时裁剪与 `E_NETWORK` 错误映射，以便消除两处重复的超时与网络错误边界逻辑。
4. 作为端点传输层的维护者，我希望 `fetch`/`legacy` 与 `page-api` 共享同一份导航超时裁剪实现，以便修改导航保护阈值时只需改动一处。
5. 作为诊断与商品利润领域的维护者，我希望保留诊断总入口稳定暴露的 `summarize*` 纯函数接口（服务诊断报表模块与既有纯函数断言），同时锁定商品利润领域仅通过单一公开入口 `getGoodsProfitView` 面向外部调用方与测试，将利润私有计算子模块收为内部实现。
6. 作为单元测试维护者，我希望将商品利润域 4 处直接穿透私有子模块的单测迁移至其公开入口 `getGoodsProfitView`，同时继续保留经诊断纯函数公开面的有效断言覆盖，以便商品利润测试描述稳定的领域行为而非内部文件切分。
7. 作为店铺领域与架构分层维护者，我希望明确保留既有的独立店铺领域服务作为命令与店铺读取适配器之间的薄隔离层，避免并将其合并至视图层或命令层而破坏 `commands -> services -> adapter` 依赖流。
8. 作为商品利润与售后诊断的维护者，我希望在统一有界分页原语并重命名迁移订单与商品采集函数后，分页大小上限、页数预算、中止检查以及截断/限流告警标记保持完全一致，以便既有报表精确度与降级行为零回归。
9. 作为项目维护者与 AI 协作代理，我希望将 `mall-switcher` 清理严格限定在架构导航技能中已过时的模块引用（完整保留店铺读取与切换适配器内的 DOM 选择器与中文提示文案），并在同次变更中同步更新受合并/归位模块影响的技能文档路径，以便通过文档路径契约守卫并零误导检索。
10. 作为后续参与者的开发者，我希望在 P0-1 至 P1-4 落地后同步刷新架构总览文档中的模块图谱、无全局单例测试方式与完整 ADR 列表，以便新成员上手时文档与代码现状完全一致。
11. 作为架构规范的守护者，我希望严守既有规格约定——依赖方向继续通过代码审查与静态导入检查维护而不新建额外的分层守卫单测文件，以便保持测试集职责聚焦。
12. 作为项目质量守卫的使用者，我希望全部收口清理通过 `npm run check`（覆盖 `knip` 未使用文件/未列出导入/未使用导出检测、`test/contract/doc-paths.test.js`、`data-contract-v2` 与全量 Vitest 及 E2E 校验）。

## Implementation Decisions

### 跨领域模块归位与有界分页原语对齐

- 将原先寄居在诊断子目录的多页订单采集函数（原 `collectOrdersForStaleAnalysis`）提升归位至订单领域主模块并重命名为 `collectOrdersWindow`，统一供商品利润、商品分层、售后诊断与库存分析四个领域导入。
- 识别并收敛商品诊断采集（`collectAllGoods`）与 `collectOrdersWindow` 之间镜像重复的分页循环实现，抽取出单次可中止的有界分页遍历原语（以可取消休眠替代硬编码等待，统一空页、不满页、上报总数、`truncated` 与 `ratelimited` 降级契约，同步清除过时镜像注释），在零改变外部返回结构的前提下消除双份维护。

### 推广中性收口、店铺分层定稿与端点内部收敛

- **中性推广领域模块**：保留既有的**中性推广领域模块（`promo`）**并吸收合并 `promo-roi` 模块逻辑，统一对外导出 `getPromoReport`、`analyzePromoRoi` 与 `getPromoRoiView`，同步更新推广 ROI 命令处理器与商品分层（`analyzePromoRoi`）的导入源，确保诊断采集、商品利润推广归因与商品分层继续导入中性推广领域而不反向耦合 ROI 专属命名，同步消除孤立透传文件与冗余模块。
- **明确保留独立店铺领域服务**：经评估两种合并替代方案（并入视图会破坏视图零适配器依赖约定，并入命令会破坏命令经服务下沉约定并冲突于 P1-3），定稿**保留店铺领域服务作为命令层与店铺读取/切换适配器之间的稳定隔离边界**，不再拆合。
- **端点大参数与导航预算收窄**：将端点单次尝试辅助的 10 字段大参数对象收窄为分组传输勾子与精简选项，抽取模块内聚的“带剩余预算裁剪的页面导航执行器”，统一 `page-api` 与 `fetch`/`legacy` 的 `navTimeout` / `remainingMs` 裁剪、`AbortSignal` 传播与 `E_NETWORK` 包装规则。

### 单消费者纯计算子集群内部化与测试面收口

- **诊断域**：采用稳健收口方案，明确以诊断报表入口与诊断主汇聚入口作为对外公开稳定接口，**保留诊断主入口向外导出的四个 `summarize*` 纯计算函数**作为诊断域纯函数公开面，持续服务内部报表模块与既有纯函数单元测试。
- **商品利润域**：明确以 `getGoodsProfitView` 作为商品利润唯一对外公开入口与测试面，将保险、推广归因与利润计算明细子模块定界为内部私有实现，遵循“接口即测试面”原则同步迁移 4 处穿透内部子模块的单元测试。

### 文档边界清理与接缝原则内联

- **严格限定 `mall-switcher` 清理边界**：确认店铺读取与店铺切换实现中出现的相关字样属于拼多多后台页面 DOM 选择器与操作提示文案，予以完整保留禁止改动；仅删除架构导航指南中指向不存在旧模块的过时条目，并更新其指向真实店铺读写模块与推广统一模块的说明，确保全部文档引用与实际文件一致。
- **刷新总览与内联原则**：在 P0-1 至 P1-4 全部落地后刷新架构总览中的模块清单、无单例组合根测试接缝与完整 ADR 索引；遵循本地深模块原则（仅在确实存在至少两套适配器的真外部边界抽象 Port，SQLite 存储保持本地可替代内部接缝而不包裹单实现仓储端口），继续依靠代码审查与静态检查维护依赖方向而不新建额外的分层守卫测试。

## Testing Decisions

1. **既有领域公开接口回归与镜像分页验证**
   订单（`collectOrdersWindow`）、商品收集（`collectAllGoods`）、中性推广领域（`promo` 提供的 `getPromoReport` / `analyzePromoRoi` / `getPromoRoiView`）、`diagnose` 全维度汇总、`goods-profit`、`shops` 与端点导航的所有重构均跨越各自公开接口验证可观察结果：有界分页的取消信号响应、截断与限流标记一致性、推广分派与 ROI 计算、商品利润成本/保险/推广扣减以及 `page-api` / `fetch` / `legacy` 导航超时裁剪。
2. **穿透测试收口与诊断纯函数面保留（Replace, Don't Layer）**
   - 将 `test/services/goods-profit-calculation.test.js`、`test/services/goods-profit-insurance.test.js`、`test/services/goods-profit-promo.test.js` 与 `test/services/goods-profit-view.test.js` 中 4 处直接穿透导入商品利润私有子模块的单元测试迁移至 `src/services/goods-profit.js` 的唯一公开入口 `getGoodsProfitView`；
   - 保留 `src/services/diagnose/index.js` 对 `summarize*` 的纯函数公开导出以及 `test/services/diagnose-facts.test.js`、`test/services/promo-diagnose-view.test.js` 中的既有纯函数断言（维护 `reports.js` 内部消费与约 40 处有效纯函数单测）；
   - 同步更新 `src/commands/promo/roi.js:2`、`src/services/goods-segmentation.js:4`（`analyzePromoRoi`）以及 `test/services/promo-roi-contract.test.js`、`test/services/promo-roi-since.test.js`、`test/services/promo-diagnose-view.test.js` 指向保留模块 `src/services/promo.js`，删除随合并而失效的孤立透传单测。
3. **文档路径守卫与全仓静态/动态基线验证**
   在同一次变更内更新 `.agents/skills/pdd-architecture-navigation/SKILL.md` 第 56 行 `mall-switcher` 过时模块引用，并更新 `.agents/skills/pdd-command-feature-development/SKILL.md` 第 25 行（移除已合并吸收的 `src/services/promo-roi.js`，保留 `src/services/promo.js`），运行 `npm run check` 验证 `knip` 零孤立导出/未引用文件、`test/contract/doc-paths.test.js` 零死路径、`data-contract-v2` 与全量 Vitest 及 E2E 全部通过。
4. **参考先例（Prior Art）**：沿用既有订单范围测试、推广 ROI 与费用回归测试、诊断对比契约测试、商品采集与端点初始化测试。

## Out of Scope

- 账号存储与守护进程状态存储的宽表 CRUD 导出面重整（本规格明确延后不作调整，避免与 P1-3/P1-4 事务接口发生无清单扩面改造）。
- 将店铺领域服务并入视图或命令处理器（已定稿保留独立薄服务以守住分层边界）。
- 已分配至前面四份规格的核心深化与模块退役：限流器单例退役（P0-1）、阶段熔断/会话健康度/写节流与冷却注入（P0-2）、旧版存储探测与账号移除吸收及 `doctor`/`login` 例外收回（P1-3）、控制台登录浏览器薄包装删除与 `relogin-policy`（P1-4）。
- 任何业务指标口径、命令行参数选项、v2 视图字段结构、中文标签或错误码变更。
- SQLite 表结构迁移、主密钥加密方式修改，或恢复/新建分层依赖守卫测试文件。

## Further Notes

- 严格作为协同规格群收尾阶段（T5）在 P0-1 至 P1-4 全部实施完毕后推进，借助 `knip` 与 `doc-paths` 一次完成全仓冗余文件、死导出与过时文档路径的统一收口。
