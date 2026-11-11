# 店透视 3.6.1：地区与今日实时接口（静态分析）

> 来源：`tmp/recon/dts/tools/_pdd_sycm.af9cf9cd.unobf.decoded.txt`（店透视公开可读 bundle 的换行副本，下载与解码方法见 `tmp/recon/dts/codex-analysis.md`，不进 Git）
> 方法：2026-11-11 文本检索，未执行插件代码，未调用拼多多接口。以下全部是**观察到的代码行为**，响应字段和单位都还没有实测
> 行号指上述换行副本

## 一、地区

### 1.1 订单上的省市区

店透视订单表（U:68520 附近，请求带 `orderType: 0`，推断为 `recentOrderList`）直接读取订单的 `province_name`、`city_name`、`district_name`，拼成 `省 市 区 ****`，详细地址用 `****` 遮住；手机号固定显示 `****`。这和 `createUpstreamOrder` fixture 的字段名一致。

### 1.2 平台地域分布（省级汇总）

| 端点 | 请求体 | 响应 |
| --- | --- | --- |
| `/sydney/api/windowsDataCentral/queryMallGeographyDistributionList` | `{ queryType }` | `result.geographyDistributionVOList[]`：`provinceId`、`provinceName`、`cfmOrdrAmt`、`cfmOrdrCnt`、`cfmOrdrUsrCnt`、`cfmOrdrAup` |
| `/sydney/api/windowsDataCentral/queryMallGeographyDataList` | `{ provinceId, queryType }` | `result.geographyDataVOList[]`：单省逐日（`statDate`），字段同上 |

- 页面「店透视工具箱-地域分布」只提供 `recent1` / `recent7` / `recent30`，对应 `queryType` 0 / 1 / 2（U:24917）。没有今日实时
- 粒度只到省；口径是**成团**（`cfm*`），店透视在前端把它们改名成 `pay*` 显示
- 客单件数 `payCntAup = cfmOrdrCnt / cfmOrdrUsrCnt` 是店透视自己算的
- 请求通过通用 axios 发出（`/sydney/api/` 前缀会走 spider-font 解码钩子），是否命中字体混淆未知

## 二、今日实时

店透视「店铺报表」选「今日」时（U:72740–72830）调用下面三个接口；「今日」以外的日期走历史接口。

| 端点 | 请求体 | 观察到的用法 |
| --- | --- | --- |
| `/sydney/api/mallFlow/queryMallFlowRtData` | 无 | `result` 中所有带 `Rt` 后缀的键去掉后缀使用：`muvRt` / `mpvRt` / `guvRt` / `gpvRt` 等 |
| `/sydney/api/goodsDataShow/queryGoodsPageRT` | 无 | 同样去掉 `Rt` 后缀；用到 `payOrdrCntRt`、`payOrdrAmtRt`、`goodsFavCnt`、`guv`（全店商品维度的今日汇总） |
| `/sydney/api/mallTrade/queryMallTradeList` | `{ queryType: 6, queryDate: <今天> }`，请求头带 `anti-content` | 取 `todayRtList`，没有时依次回退 `todayPerHourRtList`、`dayList`；用最后一项（最新小时）的 `sucRfOrdrAmt1d` / `sucRfOrdrCnt1d`（今日成功退款金额 / 单数） |

另一个今日接口：

| 端点 | 请求体 | 观察到的用法 |
| --- | --- | --- |
| `/sydney/api/mallCoreData/queryAppRecentDataList` | 未见参数 | `result.todayData[]` / `yesterdayData[]`：逐小时序列，字段带 `Dth` 后缀（`payOrdrAmtDth`、`payOrdrAupDth`、`payOrdrUsrCntDth`、`guvDth` 等）；金额按 **÷1000** 处理（推断为厘）；最后一项作为今日累计 |

注意：
- 值可能是字符串，店透视统一用 numeral 转数字（U:72750）；缺失时补 0。CLI 需要缺失为 `null`
- 店透视给今日数据打的时间是**本机时间 + 2 分钟**（U:37530），上游响应里没有快照时间。CLI 的 `snapshot_at` 只能是抓取时间，需要说明这一点
- 客服今日：bundle 中有 `/desert/stat/getMallHourConsultData` 和 `/sydney/api/customer/querySpecifiedDayServiceQuality`，本次没有追到调用参数

## 三、其他

- `/vodka/v2/mms/query/sku/info` 在 bundle 中有定义（U:24741），本 chunk 内没有调用点，参数和响应未知；`/vodka/v2/mms/edit/quantity/increase` 是写接口，不调用
- 全部接口都需要真实账号只读实测：字段完整性、单位、是否混淆
