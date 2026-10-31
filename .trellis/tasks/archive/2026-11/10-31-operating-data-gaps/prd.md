# 经营数据补全：利润 / 星级 / 客服评价 / 流量

## Goal

补齐 CLI 缺失的四类经营事实数据：商品净利润、店铺综合体验星级、客服与评价、流量。这些数据用来判断推广是否真正赚钱、店铺服务权重是否下滑、转化环节的问题出在哪里。

本任务是父任务：持有需求全集、子任务映射、跨子任务验收与最终集成审查，不直接承载实现。

## 背景与约束

- 需求来源：2026-10-31 grill-with-docs 访谈（Q1–Q28）。术语见 `CONTEXT.md` 的「Operating Reports」一节，利润口径见 `docs/adr/0004-goods-profit-reporting-semantics.md`。
- 侦察依据：`docs/research/pilot-mall-recon-2026-10-31.md`（星级）、`docs/research/traffic-cs-review-recon-2026-10-31.md`（流量 / 客服 / 评价）。店透视插件的分析放在 `tmp/recon/dts/codex-analysis.md`（不进 Git），只作参考，其中的结论会被吸收到子任务 ③ 的 PRD。
- 项目原则沿用 `.trellis/spec/services/domain-service-contracts.md`：只报事实，不生成经营建议、评分、等级和优劣分类。平台自己给出的分数和判定可以原样透传（Platform-Reported Score）。
- data 契约 v2 适用于所有新命令：`headline` 用中文；金额 `_yuan`；比率 0-100，后缀 `_pct`；时间 `_at`；缺失值为 null，不写成 0；上游原始对象和 PII 不进入 `data`。
- 所有新增上游端点都是只读接口。侦察中发现的写接口（提交、回复、举报、报名、点击确认等）一律不调用。

## 子任务映射与顺序

按 ① → ② → ④ → ③ 的顺序实施。各子任务可以独立规划、实现、验收、归档，彼此没有代码依赖。

| 顺序 | 子任务 | 交付 |
| --- | --- | --- |
| ① | `10-31-goods-profit` | `goods cost set/list/remove/import`、`goods profit` |
| ② | `10-31-shop-experience-star` | `diagnose experience` |
| ④ | `10-31-cs-and-reviews` | `diagnose customer-service`、`diagnose reviews` |
| ③ | `10-31-traffic-and-goods-detail` | `diagnose traffic`、`goods traffic` |

## 明确排除

- 词级搜索热度、进店搜索词排名、店铺级搜索热度指数（免费后台拿不到，或者用户决定排除）。
- 加购率、跳失率（免费后台没有）。
- 商品领航员（商品级体验数据）。
- 访客数的免费 / 付费拆分（推广点击数和访客数是两个口径）。
- 保本 ROI、亏损标签、按销售额分摊店铺级推广费。
- CLI 自行对评价分词或统计词频。
- 本期不把新维度并入 `diagnose shop`。

## 跨子任务验收

- [ ] 每个新命令都被 `test/contract/data-contract-v2.test.js` 覆盖，fixture 名称和 `spec.name` 一致。
- [ ] 新端点的 fixture 已脱敏：不含店铺 ID 原值、店铺名、买家昵称、头像、订单号、图片 URL。
- [ ] 新增的枚举到中文标签映射全部放在 `src/services/views/labels.js`。
- [ ] README 的命令表和 `skills/pdd-cli/SKILL.md` 已同步，并说明哪些指标免费后台不提供。
- [ ] `npm test` 全部通过。
- [ ] 集成审查：新命令的输出里没有 CLI 自己生成的评分或分类，无效值都表示为 null。
