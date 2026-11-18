# 地域分布报告

Status: needs-triage

## 目标

输出店铺成团订单按省的分布。平台有现成的省级汇总，不需要逐单扫描订单。

## 已定事项（2026-11-19 访谈）

- 单独立项；排在今日实时（`.scratch/realtime-data/`）之后
- 只做省级汇总；订单上的省市区字段属于 `.scratch/order-region/`

## 上游来源

| 端点 | 状态 | 已知内容 |
| --- | --- | --- |
| `/sydney/api/mallCoreData/queryMallGeographyDistributionList` | 2026-11-11 在商家后台 `/sycm/stores_data/operation` 页面抓到一次响应（`tmp/recon/rt/geo.json`，不进 Git） | 明文，没有私有区字符；`result.geographyDistributionVOList[]` 本店 6 行，全部是同一个 `statDate`；行字段 `provinceName`、`provinceId`、`statDate`、`cfmOrdrAmt` / `cfmOrdrAmtCent`、`cfmOrdrCnt`、`cfmOrdrUsrCnt`、`cfmOrdrAup` / `cfmOrdrAupCent`、`cfmOrdrAop` / `cfmOrdrAopCent`；另有 `delayData`。请求体没有记录 |
| `/sydney/api/windowsDataCentral/queryMallGeographyDistributionList` | 仅静态（店透视 3.6.1） | `{ queryType }`，0 / 1 / 2 = 近 1 / 7 / 30 天；省级成团汇总 |
| `/sydney/api/windowsDataCentral/queryMallGeographyDataList` | 仅静态 | `{ provinceId, queryType }`，单省逐日 |

来源文档：`docs/research/diantoushi-region-realtime-2026-11-11.md` 1.2、`docs/research/diantoushi-endpoint-catalog-2026-11-12.md` 第七节。

## 待定

- 数据放在哪个命令里。访谈第一轮定过「不新增命令、以新增字段并入现有命令」，地域分布是否适用需要单独确认
- 时间窗口：官方接口一次返回的是单日还是区间；店透视那组接口只有近 1 / 7 / 30 天三档
- 金额、客单价的单位和 `Cent` 字段的关系；`cfmOrdrAop` 的含义
- 没有成团的省份是缺行还是零值行
- 口径是成团（`cfm*`），和 `diagnose orders` 等命令的订单口径如何并列陈述

## 约束

- 遵守 `data` 契约 v2；金额输出元（`_yuan`），缺失为 `null`
- 只输出省级汇总数字；收件人、地址、手机号不涉及
