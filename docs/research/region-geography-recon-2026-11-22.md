# 省级地域分布端点只读实测（`region-report` 01）

> 2026-11-22 04:20 前后，默认真实账号只读实测（通过 `withCommand` 单实例浏览器上下文与 `page-api` 页面签名客户端调用，严格串行，无 429 / 40002 / 54001）。
> 脱敏：店铺 ID、订单号、买家/收件人、地址详情及私有凭据均已剥离，数值保留验证口径、单位与聚合一致性所需的统计结果。

## 一、端点实测总表

| 端点 | 请求参数 | 状态与混淆 | 返回顶层结构 | 覆盖窗口 |
| --- | --- | --- | --- | --- |
| `/sydney/api/mallCoreData/queryMallGeographyDistributionList` | 原生 `{ queryType: 0 }`；实测 `{ queryType: 1 \| 2 }` 同样返回 200 | `success: true`, `errorCode: 0`, `hasPua: false` | `{ geographyDistributionVOList, delayData }`（实测 `delayData: 0`） | 0 = 就绪日单日（`2026-11-21`），1 = 近 7 日，2 = 近 30 日 |
| `/sydney/api/windowsDataCentral/queryMallGeographyDistributionList` | `{ queryType: 0 \| 1 \| 2 }` | `success: true`, `errorCode: 0`, `hasPua: false` | `{ geographyDistributionVOList }`（无 `delayData`） | 与官方端点完全一致（0 / 1 / 2） |
| `/sydney/api/windowsDataCentral/queryMallGeographyDataList` | `{ provinceId, queryType: 1 \| 2 }` | `success: true`, `errorCode: 0`, `hasPua: false` | `{ geographyDataVOList }` | 1 = 近 7 日逐日（7 行），2 = 近 30 日逐日（30 行） |

三个端点全部为明文（`hasPua: false`），均未出现私有区字符。

## 二、字段、单位与 `Cent` / `cfmOrdrAop` / `delayData` 语义

### 2.1 官方地域分布行字段（`mallCoreData/queryMallGeographyDistributionList`）

实测单个有成团省份行样本（`queryType: 0`）：

- `provinceName`：`"浙江"`（省份短名）
- `provinceId`：整数省份 ID（由 `windowsDataCentral/queryMallGeographyDistributionList` 同行附带，例如 31；官方分布端点样例行含 `provinceName`、`statDate` 等）
- `statDate`：`"2026-11-21"`（区间窗口下每行 `statDate` 均为窗口截止日即就绪日）
- `cfmOrdrAmt`：`25.4`（**元**，浮点）；`cfmOrdrAmtCent`：`2540`（**分**，整数，精确等于 `cfmOrdrAmt * 100`）
- `cfmOrdrCnt`：`1`（成团订单数，整数）
- `cfmOrdrUsrCnt`：`1`（成团买家数，整数）
- `cfmOrdrAup`：`25.4`（**客单价**，`cfmOrdrAmt / cfmOrdrUsrCnt`，元）；`cfmOrdrAupCent`：`2540`（分）
- `cfmOrdrAop`：`25.4`（**笔单价**，`cfmOrdrAmt / cfmOrdrCnt`，元）；`cfmOrdrAopCent`：`2540`（分）

在 `windowsDataCentral` 多订单省份样例上验证公式：
- 近 7 日某省：`cfmOrdrAmt = 820.4`，`cfmOrdrCnt = 44`，`cfmOrdrUsrCnt = 37`
  - `820.4 / 37 = 22.172972972972975 === cfmOrdrAup` → 确认为**人均/客单价**（per-buyer average）
  - `820.4 / 44 = 18.645454545454545 === cfmOrdrAop` → 确认为**笔均/笔单价**（per-order average）
- 近 30 日同一省：`cfmOrdrAmt = 4954.21`，`cfmOrdrCnt = 270`，`cfmOrdrUsrCnt = 224`
  - `4954.21 / 224 = 22.117008928571426 === cfmOrdrAup`
  - `4954.21 / 270 = 18.348925925925926 === cfmOrdrAop`
- `delayData`：官方端点顶层字段，实测正常时为 `0`（参考 `diagnose experience` 语义：平台标记数据是否延迟）。

### 2.2 官方端点与 `windowsDataCentral` 对比

| `queryType` | 统计截止日 | 官方 `mallCoreData`（行数 / 订单合 / 金额合） | `windowsDataCentral` 分布（行数 / 订单合 / 金额合） | 差异 |
| --- | --- | --- | --- | --- |
| `0`（1 天） | `2026-11-21` | `1` 行 / `1` 单 / `25.4` 元 | `1` 行 / `1` 单 / `25.4` 元 | 数值完全一致；官方另带 `*Cent` 与 `delayData` |
| `1`（7 天） | `2026-11-21` | `14` 行 / `74` 单 / `1375.96` 元 | `14` 行 / `74` 单 / `1375.96` 元 | 数值完全一致 |
| `2`（30 天） | `2026-11-21` | `26` 行 / `563` 单 / `10405.24` 元 | `26` 行 / `563` 单 / `10405.24` 元 | 数值完全一致 |

结论：省级汇总首选官方 `/sydney/api/mallCoreData/queryMallGeographyDistributionList`，同时提供 `delayData` 与整数分字段，也原生支持 `{ queryType: 0 | 1 | 2 }`。

## 三、缺行 / 零值行语义

- **省级分布端点**（`queryMallGeographyDistributionList`）：全国 34 个省级行政区中，近 1 / 7 / 30 日分别只返回 `1` / `14` / `26` 行，**无成团省份直接缺行**。
- **单省逐日端点**（`windowsDataCentral/queryMallGeographyDataList`）：固定返回窗口全部日期行（`qt=1` 为 `7` 行 `2026-11-15..2026-11-21`，`qt=2` 为 `30` 行 `2026-10-23..2026-11-21`）。`qt=2` 样例中：`zeroOrderDays: 11`、`positiveOrderDays: 19`、`nullOrderDays: 0`——无成团日期**保留日期行且 `cfmOrdrCnt` 等为 `0`**。

## 四、同窗口订单抽样核对（确认「成团」口径）

以 `2026-11-21`（上海自然日 `[2026-11-21 00:00:00, 2026-11-22 00:00:00)`）为窗口，通过 `orders.list` 抽样核对同日全店订单：
- `orders.list`：`totalItemNum: 1`，`sampledOrders: 1`，省分布：`浙江省: { count: 1, amountYuan: 25.4, statusCounts: { 待发货: 1 } }`
- `queryMallGeographyDistributionList`（`queryType: 0`）：`1` 行，`"浙江"`，`cfmOrdrCnt: 1`，`cfmOrdrAmt: 25.4`，`cfmOrdrAmtCent: 2540`，`cfmOrdrUsrCnt: 1`

两者在省份归属、订单数与实付金额上完全吻合，确认 `cfm*` 为「成团订单」口径，金额单位 `cfmOrdrAmt` 为元、`cfmOrdrAmtCent` 为分。

## 五、02 命令归属建议（供用户拍板）

结合以上实测结果：
- 参数体系与窗口语义：`mallCoreData/queryMallGeographyDistributionList` 使用 `{ queryType: 0 | 1 | 2 }`（对应 `--days 1|7|30`，截至平台就绪日），与 `goods traffic`（`--days 1|7|30`）天然对齐；而现有 `diagnose orders` 无 `--days` 参数、基于 `orders.list` 全单列表扫单样本，且 `diagnose orders` 统计口径是下单时间筛选样本与 P95/退款计数。
- **建议（首选）**：新增独立只读子命令 `diagnose region [--days 1|7|30]`（或由用户定名），显式声明「数据中心-地域成团」口径与区间窗口，避免在 `diagnose orders` 内混入两套窗口和两种口径。
- **备选**：若坚持不增子命令，可并入 `diagnose orders` 的独立 `regions` 区块（需同时标注自身 `caliber` 与 `window`，并说明与主区块基于 `orders.list` 样本的差异）。
- **单省逐日趋势（03）**：`windowsDataCentral/queryMallGeographyDataList` 已验证可用且返回 `7` / `30` 完整逐日行，需由用户确认是否需要随 02 一起建设。
