# 02: 中性推广领域统一（`promo` 吸收 `promo-roi`）与商品利润穿透测试收口

**What to build:** 保留既有的**中性推广领域模块（`promo`）**并吸收合并 `promo-roi` 逻辑（对外共同导出 `getPromoReport`、`analyzePromoRoi` 与 `getPromoRoiView`），消除 9 行路由透传文件的过薄跳转；同步更新推广 ROI 命令、商品分层（`analyzePromoRoi`）、三个推广测试导入及技能文档 `pdd-command-feature-development/SKILL.md` 第 25 行（移除旧 `promo-roi.js`、保留 `promo.js`），让诊断、商品利润与商品分层继续依赖中性推广域。同时按“接口即测试面”原则将商品利润域 4 处直接穿透内部计算子模块的单测全部迁移至唯一公开入口 **`getGoodsProfitView`** 并内部化私有利润子模块（遵循闭合定稿：显式保留诊断总入口对纯计算 `summarize*` 的公开纯函数导出面及独立 `services/shops` 领域边界，不引入任何额外分层测试）。参见 `../spec.md`。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `promo` 吸收 `promo-roi` 并导出 `getPromoReport`、`analyzePromoRoi` 与 `getPromoRoiView`，删除冗余的 `promo-roi` 文件并更新 ROI 命令、商品分层与相关单测导入
- [ ] 商品利润域 4 个单测文件从内部计算子文件穿透导入全面迁移至 `getGoodsProfitView` 公开入口，同步删除失效浅测
- [ ] 保持诊断 `index` 对 `summarize*` 纯函数公开导出面及既有 `diagnose-facts` / `promo-diagnose-view` 断言正常，保留独立 `services/shops` 模块
- [ ] 更新 `pdd-command-feature-development/SKILL.md` 第 25 行路径，通过 `doc-paths`、`data-contract-v2` 与 `npm run check`
