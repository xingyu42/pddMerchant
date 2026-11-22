# 字体混淆指标解码

Status: deferred

> 2026-11-22 用户确认 No-Go：保留 `01` 侦察结论与文档 `docs/research/spider-font-stability-recon-2026-11-22.md`，暂缓推进 `02`–`04`；待明文接口下线或需要直取混淆端点的 `*Pct` 环比指标时再重启。

## 目标

让只以字体混淆形式提供的经营指标可以作为事实输出。术语见 `GLOSSARY.md` 的 Obfuscated Metric：解码后要和明文来源交叉核对，核对不上就报告为不可用。

## 已定事项（2026-11-19 访谈）

- 单独立项，排在现有报表加深、今日实时、地域报告之后：它独有的指标最少，工作量最大

## 已知事实

来源：`docs/research/goods-detail-plain-and-spider-font-2026-10-31.md` 第 2 节、`docs/research/traffic-cs-review-recon-2026-10-31.md` 第七节。

- 混淆值是 U+E000–F8FF 的私有区字符，字体（`pfile.pddpic.com/webspider-sdk-api/*.ttf`）每次加载重新映射，字形名只有 `uniXXXX`，轮廓每次都变
- 每个字形最后一个点的坐标稳定（±3），可以据此识别 0–9 和小数点；0 和 9 要靠 Y 坐标区分。店透视 3.6.1 用的是同一方法，容差 `max(2, unitsPerEm×1%)`
- 是否混淆取决于 `checkGray` 灰度，不同店铺可能拿到明文
- 已实测为混淆的端点：`mallTrade/getMallTradeInfo`、`mallScore/queryMallScoreOverView`、`mallFlow/queryMallFlowOverView`、`goodsDataShow/queryGoodsPageOverView`、`goodsDataShow/queryGoodsDetailVOListForMMS`
- 多数指标已有明文替代来源（流量日趋势、今日实时、单品统计、交易小时趋势、明文商品明细）

## 待定

- 哪些指标只有混淆来源、值得为它们做解码
- 字体解析用自写的 TTF 读取还是引入依赖（新依赖需要评估）
- 每个解码值用哪个明文来源做交叉核对，核对失败时的输出
- 明文商品明细接口（`queryGoodsDetailVOList`）下线时的切换策略
