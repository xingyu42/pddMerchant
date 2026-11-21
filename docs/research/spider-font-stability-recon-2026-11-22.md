# 字体混淆指标盘点与末点签名稳定性测试（`spider-font-decoding` 01）

> 2026-11-22 04:20 前后，默认真实账号只读实测与 5 次独立字体加载离线验证（字体文件下载自商家后台 `/phantom/web/en/ft` 规则下的 `pfile.pddpic.com/webspider-sdk-api/*.ttf`，脚本与临时样本存放在未入库的 `tmp/recon/`）。
> 脱敏：店铺 ID、商品 ID、商品名及原生签名请求体 `crawlerInfo` 均已剥离。

## 一、5 个混淆端点逐字段对照（混淆版 vs 现有明文替代来源）

### 1.1 `/sydney/api/mallTrade/getMallTradeInfo`
- 原生请求：`{ queryType: 6, queryDate: "2026-11-22" }`（`hasPua: true`）
- 响应主体及`*Pct` 对照：
  - 基础指标（全部有明文替代来源）：`payOrdrAmt` / `payOrdrCnt` / `payOrdrUsrCnt` / `payOrdrAup` / `payUvRto` → 已由 `traffic.todayTrade`（`/sydney/api/mallTrade/queryMallTradeList` `todayRtList[]`）明文提供；`rpayUsrRtoDth`、`mallFavCnt`、`sucRfOrdrAmt1d`、`sucRfOrdrCnt1d`、`uvCfmVal` → 均在同接口 `queryMallTradeList` `todayRtList[]` 响应对象中作为明文字段返回（`queryMallTradeList` 对当日无退款或尚未出数小时可能返回 `null`）。
  - `*Pct` 环比字段（`payOrdrAmtPct`、`payOrdrCntPct`、`payOrdrUsrCntPct`、`payOrdrAupPct`、`payUvRtoPct`、`rpayUsrRtoDthPct`、`mallFavCntPct`、`sucRfOrdrAmt1dPct`、`sucRfOrdrCnt1dPct`、`uvCfmValPct`）及 `*PctRised` / `*IsPercent`：**无直接明文单日环比接口**（注：`queryMallTradeList` 中相同 `*Pct` 键在当日样例中为 `null`；历史区间均可通过现有逐日明文序列自行对比）。

### 1.2 `/sydney/api/mallFlow/queryMallFlowOverView`
- 原生请求：`{ beginDate, endDate }`（`hasPua: true`）
- 字段对照：
  - 15 项核心指标（`uv`、`pv`、`guv`、`gpv`、`cfmOrdrUsrCnt`、`cfmOrdrCnt`、`cfmOrdrAmt`、`cfmOrdrAup`、`cfmUvRto`、`uvCfmVal`、`payUvRto`、`payOrdrAup`、`payOrdrUsrCnt`、`payOrdrCnt`、`payOrdrAmt`）：核心流量与支付指标已有明文 `/sydney/api/mallFlow/queryMallFlowOverViewList`（按 `statDate` 逐日返回），成团地域/单品指标有 `mallCoreData` / `goodsDetailVOList` 明文覆盖。
  - **仅有混淆版**：上述 15 项的期间环比变化字段 `*Pct`（带 `%` 号）。

### 1.3 `/sydney/api/goodsDataShow/queryGoodsPageOverView`
- 原生请求：`{ queryType: 0, queryDate }`（`hasPua: true`）
- 字段对照：
  - 10 项核心汇总（`payOrdrAmt`、`payOrdrCnt`、`payUvRto`、`gpv`、`guv`、`vstGoodsCnt`、`payOrdrUsrCnt`、`cfmOrdrUsrCnt`、`cfmOrdrCnt`、`goodsFavCnt`）：均可通过明文 `/sydney/api/goodsDataShow/queryGoodsDetailVOList`（或全店 `queryMallFlowOverViewList`、今日 `queryGoodsPageRT`）获取。
  - **仅有混淆版**：上述 10 项的期间环比变化字段 `*Pct`。

### 1.4 `/sydney/api/mallScore/queryMallScoreOverView`
- 实测请求：`{ queryType: 1 }`（via `page-api`）
- 实测结果：**本次返回为纯明文（`hasPua: false`）**！包含 `serviceDataVO`（`avgSucRfProcTime1m`、`pltInvlRto1m`、`rfRto1m`、`sucRfOrdrAmt1d`、`sucRfOrdrCnt1d` 及各 `*Pct`）、`dealDataVO`、`goodsDataVO`。该端点受灰度控制，不同店铺或直连策略下可能变为混淆串，但经验指标已由 `diagnose experience`（`navigatorInfo` / `navigatorList` 明文接口）覆盖。

### 1.5 `/sydney/api/goodsDataShow/queryGoodsDetailVOListForMMS`
- 实测请求：`{ startDate, endDate, queryType: 1, sortCol: 0, sortType: 1, pageNum: 1, pageSize: 10, actVs: 1 }`（via 裸 `page-api`，无 `/phantom/web/en/ft` 规则头）
- 实测结果：直接返回 `success: false, errorCode: 3000000, errorMsg: "非法请求"`（前端需要 `/phantom/web/en/ft` 与 `webSpiderRule` 请求头协商才能取数）。同功能明文接口 `/sydney/api/goodsDataShow/queryGoodsDetailVOList`（不带 `actVs`）仍正常返回 200（实测返回 `8` 个商品全部明文字段）。

### 1.6 唯一缺口结论

截至本次侦察，**核心业务指标均存在明文端点来源**。5 个混淆端点中仅剩 `*Pct` 环比变化率没有现成明文接口，属于低频展示派生字段；`queryGoodsDetailVOList` 明文接口依然健康运行。

## 二、5 次独立字体加载与末点签名稳定性实测

通过页面加载与 `/phantom/web/en/ft` 机制捕获 5 份独立 `.ttf` 字体文件，**5 次 SHA-256 全部互异**：

| 次序 | TTF 字节数 | SHA-256 前 16 位 | `unitsPerEm` | `numGlyphs` | PUA 映射数 | 末点匹配 | 误识别 / 歧义 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 10700 | `066107f49aedf7db` | 1000 | 12 | 10（`U+E000–F8FF`）+ `.`(`std17`) | 11 / 11 | 0 / 0 |
| 2 | 10280 | `64a049951769db3a` | 1000 | 12 | 10 + `.` | 11 / 11 | 0 / 0 |
| 3 | 10776 | `e0820a0ff4cb8741` | 1000 | 12 | 10 + `.` | 11 / 11 | 0 / 0 |
| 4 | 9652 | `d2255061cc2cc2e9` | 1000 | 12 | 10 + `.` | 11 / 11 | 0 / 0 |
| 5 | 9796 | `518cefa86f147ad1` | 1000 | 12 | 10 + `.` | 11 / 11 | 0 / 0 |

**55 / 55 个字形全部唯一匹配（0 漏识、0 歧义）**。各字符在 5 份字体里的末点 `(x, y)` 实测范围与漂移：

| 字符 | X 最小–最大（漂移） | Y 最小–最大（漂移） | 区分说明 |
| --- | --- | --- | --- |
| `0` | 129–137（8） | 307–313（6） | 与 `9` X 接近，Y 在 307–313 段完全分离 |
| `1` | 355–357（2） | 0–1（1） | |
| `2` | 43–45（2） | 458–458（0） | |
| `3` | 218–219（1） | 404–405（1） | |
| `4` | 338–339（1） | 240–241（1） | |
| `5` | 470–471（1） | 621–622（1） | |
| `6` | 414–415（1） | 528–529（1） | |
| `7` | 509–510（1） | 624–625（1） | |
| `8` | 150–160（**10**） | 490–501（**11**） | 漂移最大：容差需 ≥ `max(12, unitsPerEm * 1.5%)`（= 15）以留足余量 |
| `9` | 133–135（2） | 171–172（1） | Y 在 171–172 段与 `0`（307–313）相差 > 130 |
| `.` | 82–84（2） | 110–112（2） | 在 `cmap` 中保留 ASCII `U+002E`（字形名 `std17`），未混入 PUA |

备注：小数点基准在旧记录为 `(83, 111)`，本次样本在 5 份字体中为 `(82–84, 110–112)`。由于 `8` 单轴漂移已达 `10–11`（旧估计 `±3` 偏紧），实际工程若采用该方案，`tol = max(2, unitsPerEm * 0.01) = 10` 刚好压线，应放宽到 `15`（或至少 `12`）同时仍与所有邻近字符保持 > 50 单位间距。

## 三、非数字字符、`-1` 哨兵与交叉核对方案

- **百分号 `%`、负号 `-`、千分位 `,`**：均作为普通 ASCII 字符直接拼接在 PUA 字符串里（实测 `*Pct` 字段带 `hasPercent: true` 且字符串长度为 5–7）。TTF 仅包含 `0–9` 与 `.`（11 个有效字形 + `.notdef`），不含 `-`、`%`、`,`。
- **`-1` 哨兵**：本次 PUA 样本未见 `-1`；明文 `querySpecifiedDayServiceQuality` 的 `cmprP1d*` 同比字段出现过 `-1` 表示对比期无基数。若 `*Pct` 在无对比基数时返回 `"-1"` 或 `"--"`，解码后应结合 `*PctRised` / `*IsPercent` 或数值特征识别，并由明文核对兜底。
- **交叉核对明文来源**：
  - `queryMallFlowOverView`（逐项指标）↔ `queryMallFlowOverViewList`（按 `beginDate == endDate` 求和或取单日）
  - `getMallTradeInfo`（当日实时成交与退货）↔ `queryMallTradeList(queryType: 6)` `todayRtList.at(-1)`
  - `queryGoodsPageOverView`（全店商品汇总）↔ `queryGoodsDetailVOList` / `queryGoodsPageRT`
  - `queryGoodsDetailVOListForMMS` ↔ `queryGoodsDetailVOList`（如明文接口继续有效可逐商品比对；若其下线则无全量明文比对源，只能用单品 `queryGoodsStat` 或汇总交叉校验总量）

## 四、字体解析实现评估

本次离线验证脚本 `tmp/recon/fonttools/analyze-5fonts.mjs` 直接使用 Node 原生 `Buffer` 解析 SFNT 表目录（`cmap` format 4 / format 12、`head.unitsPerEm`、`loca` short/long、`glyf` 末轮廓终点 `x/y` 累加），**核心解析代码仅约 80–100 行，无需引入任何第三方 npm 依赖（如 `opentype.js` / `fontkit`）**，零安全维护负担且与 `knip` 约束契合。

## 五、Go / No-Go 结论

- **技术可行性**：**Go**。5 份独立动态 TTF 的 55 个字形末点签名识别达到 100% 准确且 0 歧义，零依赖自写解析器约 80–100 行即可实现。
- **业务性价比（综合建议）**：**建议 No-Go / 暂缓 02–04**，理由如下：
  1. 现有命令与需求中的全部核心指标均有可用明文接口覆盖（`queryGoodsDetailVOList` 实测仍稳定可用、`queryMallScoreOverView` 本次也返回明文），仅缺各端点的 `*Pct` 期间环比字段，且当前明文报表并不输出这类平台环比文本。
  2. 引入 `/phantom/web/en/ft` 规则协商、字体下载缓存、容差漂移与 `GLOSSARY.md` 要求的「解码 + 交叉核对，不通过则报告不可用」链路，维护复杂度远高于当前收益。
  3. 仅当后续平台下线 `queryGoodsDetailVOList` 明文接口，或明确需要直接采用混淆端点的 `*Pct` 指标时，再触发 02–04 推进；该决策由用户最终拍板。
