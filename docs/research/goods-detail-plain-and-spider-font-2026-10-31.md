# 商品明细明文接口与 spider-font 末点签名 — 实测记录

> 2026-10-31，用户已登录的 Chrome（agent-browser-cli），只读。店铺标识和商品名已脱敏。

## 1. 明文商品明细接口（③ 采用）

`POST /sydney/api/goodsDataShow/queryGoodsDetailVOList`，不带 `actVs`。在页面内用 `credentials: 'include'` 直接 fetch 就能成功（无需 Anti-Content），返回明文：

- 请求体：`{ startDate, endDate, queryType, sortCol, sortType, pageNum, pageSize }`。实测通过的组合：`queryType: 1`（近 7 日）+ `pageSize: 10`；`queryType: 2`（近 30 日）+ `pageSize: 50`，一次返回 24/24 个商品。
- 外壳：`{ success, errorCode: 1000000, result: { goodsDetailList[], totalNum, timestamp, delayData } }`。
- 商品行字段（摘选）：`statDate`、`goodsId`、`goodsName`、`goodsFavCnt`、`goodsUv`、`goodsPv`、`payOrdrCnt`、`payOrdrGoodsQty`、`payOrdrUsrCnt`、`payOrdrAmt`（元）、`goodsVcr`（0-1）、`ordrCrtUsrCnt`、`ordrVstrRto`（0-1）、`payOrdrRto`（0-1）、`cfmOrdrCnt`、`cfmOrdrGoodsQty`、`cnsltUsrQty`、`goodsPtHelpRate`、`cate3AvgGoodsVcr`、`cate1Name`~`cate3Name`、`goodsStatus`；另有 `*Ppr` 环比、`*Ytd`、`peerPerf*`（档位，含义未确认）、`adStrategy*`。
- URL 字段：`hdThumbUrl`、`adStrategyJumpUrl`，不得输出。
- 交叉核对：主力商品近 30 日访客 1179、订单 34，与店透视商品报表一致。
- 对照组：混淆版 `queryGoodsDetailVOListForMMS`（带 `actVs: 1`）不带页面签名时返回 `3000000 非法请求`。
- 风险：这是灰度关闭时的旧接口，平台可能下线。

## 2. spider-font 末点签名（后备方案，本期不实现）

同一店铺连续两次加载 `/sycm/goods_effect`，两份 TTF（`pfile.pddpic.com/webspider-sdk-api/*.ttf`）对比结果：

- 码位随机，落在 U+E000–F8FF；字形名只是 `uniXXXX`，没有 `zero`~`nine`。
- 整个字形每次都变：轮廓数、点数、字节都不同，连 `.` 也是（8 点 → 14 点）。
- **每个字形最后一个点的坐标稳定**（±3）：

| 字符 | 字体 1 | 字体 2 | 店透视签名 X |
| --- | --- | --- | --- |
| 2 | 44,458 | 44,458 | 44 |
| . | 83,111 | 83,111 | 83 |
| 0 | 130,315 | 127,313 | 132 |
| 9 | 134,172 | 134,171 | 134 |
| 8 | 156,501 | 156,492 | 155 |
| 3 | 218,405 | 218,405 | 218 |
| 4 | 339,242 | 339,241 | 339 |
| 1 | 356,0 | 356,0 | 356 |
| 6 | 414,528 | 414,528 | 414 |
| 5 | 469,622 | 470,622 | 470 |
| 7 | 509,624 | 509,624 | 509 |

0 和 9 要靠 Y 区分。店透视（3.6.1）采用同样的方法：先按字形名匹配，失败后用末点签名，容差 `max(2, unitsPerEm×1%)`。如果明文接口下线，可以照此方案实现解码，并配合明文汇总做交叉校验。

## 3. 推广直接成交（店透视实现，静态分析；本店无投放，未实测）

- `POST https://yingxiao.pinduoduo.com/mms-gateway/venus/api/goods/promotion/v3/list`，请求体 `{ beginDate, endDate, blockType: 3, clientType: 1, pageNumber, pageSize: 50, filter: { searchKeyV2: goodsIds.join(',') }, sortBy: 9999, orderBy: 9999, scenesMode, withTagsInfo: true }`。`scenesMode` 1 = 稳定成本推广，3 = 全店托管。页面请求会附带 `crawlerInfo`。
- 响应在 `result.adInfos[]`；`adInfos === null && totalAdNum == 0` 表示未开通，按空列表处理。
- 每条记录依次展开 `optimizationMessage`、`reportInfo`、`reportInfo2`，同名字段后者覆盖。取值规则：`click ?? clickCount`、`directGmv ?? directPayGmv`、`indirectGmv ?? indirectPayGmv`、`spend ?? orderMarketingSpend`、`directOrderNum`、`indirectOrderNum`、`orderNum`。
- 金额单位：如果是对象，取 `value`（`unit === 'PERCENT'` 时除以 `unitCode || 100`）；如果是纯数字，除以 1000（厘 → 元）。计数直接按数值读取。按 `goodsId` 累加。
