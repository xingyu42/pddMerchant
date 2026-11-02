# ③ 流量与商品明细 — 技术设计

依据：`prd.md`；`docs/research/traffic-cs-review-recon-2026-10-31.md` 第二、三节；`docs/research/goods-detail-plain-and-spider-font-2026-10-31.md`（以下简称"研究文档"）。

## 1. 分层与文件

| 层 | 文件 | 职责 |
| --- | --- | --- |
| adapter | 新增 `src/adapter/endpoints/traffic.js` | `traffic.readyTime`、`traffic.overviewList`、`traffic.goodsDetailList`，均为 page-api |
| adapter | 新增 `src/adapter/endpoints/promo-goods.js` | `promo.goodsPromotionList`（venus v3），写法参照 `PROMO_ENTITY_REPORT` 的 fetch 策略（nav 到 yingxiao，合并页面生成的请求体，其中带 crawlerInfo） |
| services | 新增 `src/services/traffic.js`、`src/services/goods-traffic.js`、`src/services/goods-traffic-promo.js` | 窗口计算、分页、推广按商品归属、调用 view |
| views | 新增 `src/services/views/traffic.js`、`src/services/views/goods-traffic.js`；修改 `labels.js` | 字段白名单、单位换算、headline、hints |
| commands | 新增 `src/commands/diagnose/traffic.js`、`src/commands/goods/traffic.js`；修改 `registry/diagnose.js` 和 `registry/goods.js` | 两个命令都是 `needsAuth: true`、`needsMall: 'switch'` |

可选数据源的降级写法和 ①②④ 一致：只有 `PddCliError` 降级，其他异常继续抛出（参照 `services/experience.js` 的 `optionalEndpoint`）。

## 2. `diagnose traffic [--days 30]`

- `--days` 取 1–30 的整数，默认 30。
- `traffic.readyTime`：`POST /sydney/api/mallFlow/queryMallFlowOverViewReadyTime`，参数 `{}`，`result` 为 `YYYY-MM-DD`。窗口 `endDate = ready`，`beginDate = ready − (days − 1)`。
- `traffic.overviewList`：`POST /sydney/api/mallFlow/queryMallFlowOverViewList`，参数 `{ beginDate, endDate }`，`nav.url` 为 `https://mms.pinduoduo.com/sycm/search_data/plate`。这是主数据源，失败时整个命令失败。
- 每天一行，日期字段为 `statDate`。字段映射如下，后缀 `_peer_avg` 取自上游的 `<字段>1dPln`，`_peer_excellent` 取自 `<字段>1dOst`，上游没有的字段输出 null：

| key | 上游 | 规整 |
| --- | --- | --- |
| `shop_visitor_count` | `uv` | 原值 |
| `shop_page_view_count` | `pv` | 原值 |
| `goods_visitor_count` | `guv` | 原值 |
| `goods_page_view_count` | `gpv` | 原值 |
| `pay_buyer_count` | `payOrdrUsrCnt` | 原值 |
| `pay_order_count` | `payOrdrCnt` | 原值 |
| `pay_amount_yuan` | `payOrdrAmt` | 元，round 2 |
| `pay_conversion_pct` | `payUvRto` | ×100 |
| `avg_order_value_yuan` | `payOrdrAup` | 元 |
| `uv_value_yuan` | `uvCfmVal` | 元/访客 |

- data：`{ headline, window: { start_date, end_date, days }, items: [{ date, ...key, ...key_peer_avg, ...key_peer_excellent }], summary: { shop_visitor_count, pay_order_count, pay_amount_yuan }, hints, mall_id }`。
  - `summary` 只对访客数、订单数、金额这三个**可以相加**的量求和，转化率、客单价这类不累加。
  - 访客数跨日相加会重复计算同一个人，字段说明写明它是"逐日访客数之和"，并在 hints 中注明。

## 3. `goods traffic [--days 1|7|30] [--goods-id <id>]`

- `--days` 只接受 1、7、30，分别对应 `queryType` 0、1、2，默认 30。窗口：`endDate` = 上海时区的昨天，`startDate = endDate − (days − 1)`。
- `traffic.goodsDetailList`：`POST /sydney/api/goodsDataShow/queryGoodsDetailVOList`，**不带 `actVs`**；参数 `{ startDate, endDate, queryType, sortCol: 0, sortType: 1, pageNum, pageSize: 50, goodsId? }`；`nav.url` 为 `https://mms.pinduoduo.com/sycm/goods_effect`。按 `result.totalNum` 翻页，最多 20 页，翻满时标记截断。
- **PUA 防护**（R2.2）：normalize 时如果任一数值是字符串，并且含有 U+E000–U+F8FF 范围的字符，就抛出 `PddCliError`，错误码为 `E_BUSINESS`，提示"平台返回字体混淆数据"。这种情况不能当作明文解析，也不能补成 0。
- 商品行映射（只按白名单投影，`hdThumbUrl`、`adStrategyJumpUrl`、`goodsName` 以外的文本字段、`*Ytd`、`peerPerf*` 都不输出）：

| key | 上游 | 规整 |
| --- | --- | --- |
| `goods_id` | `goodsId` | 字符串 |
| `goods_name` | `goodsName` | 原文 |
| `visitor_count` | `goodsUv` | 原值 |
| `page_view_count` | `goodsPv` | 原值 |
| `fav_user_count` | `goodsFavCnt` | 原值 |
| `order_create_user_count` | `ordrCrtUsrCnt` | 原值 |
| `order_rate_pct` | `ordrVstrRto` | ×100 |
| `pay_conversion_pct` | `goodsVcr` | ×100 |
| `pay_rate_pct` | `payOrdrRto` | ×100 |
| `pay_order_count` | `payOrdrCnt` | 原值 |
| `pay_goods_qty` | `payOrdrGoodsQty` | 原值 |
| `pay_buyer_count` | `payOrdrUsrCnt` | 原值 |
| `pay_amount_yuan` | `payOrdrAmt` | 元，round 2 |
| `consult_user_count` | `cnsltUsrQty` | 原值 |
| `category` | `cate3Name` | 原文 |

### 3.1 推广拆分（R3.3，按研究文档第 3 节）

- `promo.goodsPromotionList`：`POST https://yingxiao.pinduoduo.com/mms-gateway/venus/api/goods/promotion/v3/list`，参数 `{ beginDate: startDate, endDate, blockType: 3, clientType: 1, pageNumber, pageSize: 50, filter: { searchKeyV2: <本页 goodsId，用逗号连接> }, sortBy: 9999, orderBy: 9999, scenesMode, withTagsInfo: true }`。对每一页商品明细，`scenesMode` 分别取 1 和 3 各查一次；推广列表本身按 `pageNumber` 翻页，返回条数少于 50 时停止。
- normalize：
  - 读取 `result.adInfos`。`adInfos === null && Number(totalAdNum) === 0` 视为未开通，返回空列表；其他非数组的情况抛 `responseShapeError`。
  - 每条记录按顺序展开 `optimizationMessage`、`reportInfo`、`reportInfo2`，同名字段后者覆盖，然后取值：`click ?? clickCount`、`directGmv ?? directPayGmv`、`indirectGmv ?? indirectPayGmv`、`spend ?? orderMarketingSpend`，以及 `directOrderNum`、`indirectOrderNum`。取值时 null、undefined、空串都视为缺失。
  - 金额：值为对象时取 `value`（`unit === 'PERCENT'` 时除以 `unitCode || 100`）；值为纯数字时除以 1000（厘转元）。全部换成整数分计算，避免浮点误差。计数直接按数值读取。
  - 白名单：只保留 `goodsId` 和上面列出的这几个值，`goodsName`、`hdThumbUrl`、计划名等一律丢弃。
- 归属：两个 `scenesMode` 的结果按 `String(goodsId)` 精确匹配，相加后得到每个商品的 `promo_direct_order_count`、`promo_indirect_order_count`、`promo_direct_amount_yuan`、`promo_indirect_amount_yuan`、`promo_spend_yuan`、`promo_click_count`。
- 非推广部分：`non_promo_order_count = pay_order_count − promo_direct_order_count`；`non_promo_amount_yuan = pay_amount_yuan − promo_direct_amount_yuan`（按分计算）。差值为负时置 null，并给出 hint。
- 失败处理（R3.4）：推广请求以 `PddCliError` 失败时，所有 `promo_*` 和 `non_promo_*` 都为 null，并在 `data_quality.promo_complete` 里标为 false。请求成功但该商品没有推广记录时，`promo_*` 为 0，`non_promo_*` 等于总量。
- 固定 hint：`推广拆分口径来自对第三方插件实现的分析，尚未经有投放店铺实测`；`非推广成交 = 商品明细总量 − 推广直接成交，平台不提供该拆分`。

data：`{ headline, window: { start_date, end_date, days }, filter_goods_id, items, total, data_quality: { goods_truncated, promo_complete }, hints, mall_id }`。

## 4. 测试与 fixture

- `createTrafficFixtures()`、`createGoodsTrafficFixtures()` 全部用合成数据。推广样本要覆盖：两种金额形态（厘数字和对象）、全店托管 `adInfos: null`、同一商品出现在两个 scenesMode 中、负差额。
- 必测场景：PUA 字符触发 `E_BUSINESS`；`--days 14` 和 `--days 31` 返回 exit 2；商品明细翻页截断；推广失败时输出 null，没有记录时输出 0；输出中不含 URL 和禁止字段。
- 在 `data-contract-v2` 中加入这两个命令，并用 `entityFields` 覆盖 `items[]`。

## 5. 回退

纯新增：只追加了两条命令注册和若干 labels，不涉及 schema 和共享 runner。

## 6. 已知风险

- `queryGoodsDetailVOList` 是旧接口，平台可能下线；下线后命令报错，到时按研究文档第 2 节的末点签名方案另行立项。
- venus v3 接口、金额单位、`adInfos: null` 分支都只做过静态分析；拿到有投放店铺的授权后，应该做一次只读冒烟，把结果和店透视的商品报表逐项核对。
