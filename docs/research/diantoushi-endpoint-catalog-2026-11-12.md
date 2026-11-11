# 店透视 3.6.1 `pdd_sycm` 模块：拼多多接口全目录（静态分析）

> 来源：`tmp/recon/dts/tools/_pdd_sycm.af9cf9cd.unobf.decoded.txt`（店透视公开可读业务 chunk 的换行副本，下文记作 **U**，行号即该文件行号；下载与解码方法见 `tmp/recon/dts/codex-analysis.md`，不进 Git）。另查了 `vendors~_pdd_sycm.f2a14005.unobf.decoded.txt`、`pdd_sycm.decoded.txt`、`main.decoded.txt`，三者都没有拼多多业务接口
> 方法：2026-11-12 用 `@babel/parser` 把 U 当文本解析成语法树（脚本在 `tmp/recon/dts/catalog/`：`extract.mjs` 枚举 webpack 模块、导出键和带 `url` 的请求函数，`callsites.mjs` 追踪 `Object(X["key"])(...)`、`cache.fetchLocal(X["key"])` 别名等调用点），再人工读关键调用。**全部为静态分析、未实测**：没有执行插件代码，没有打开浏览器，没有调用任何拼多多或店透视接口
> 已有实测结论直接引用：`traffic-cs-review-recon-2026-10-31.md`、`goods-detail-plain-and-spider-font-2026-10-31.md`、`pilot-mall-recon-2026-10-31.md`、`realtime-and-fee-recon-2026-11-11.md`、`diantoushi-region-realtime-2026-11-11.md`
> 脱敏：文中没有店铺 ID、商品 ID、订单号、token、Cookie；请求体里出现的店铺 ID 一律写作 `<店铺ID>`

## 覆盖范围与限制

- 只下载了 `pdd_sycm` 模块。加载器 `main.decoded.txt` 按地址把拼多多页面分给 4 个模块：`isPddSycm`（`mms.pinduoduo.com`、`mms.yangkeduo.com`、`live.pinduoduo.com`）、`isPddYingxiao`（`yingxiao.pinduoduo.com`）、`isPddPfdetail`（`pifa.pinduoduo.com`）、`isPddMobile`（`mobile.yangkeduo.com` 等）。后三个模块没有下载，推广后台、批发和手机端页面上店透视另外调用的接口不在本目录里
- 接口封装集中在三个共享模块：`http/promise/business`（webpack 模块 25，U:21746–23851）、`http/promise/goods`（模块 52，U:24527–24853）、`http/promise/orders`（模块 64，U:25895–26302）；地域接口定义在页面组件模块 793（U:59413）。这三个共享模块是店透视各拼多多模块共用的，`pdd_sycm` 直接调用的只有 23 个端点（含地域 2 个和字体文件），另有 13 个只出现在页面钩子名单里；其余 109 个接口在本 chunk 内**只有定义、没有调用点**，表中标为「仅定义」，参数一栏只能给出包装函数的形参（多为 `data={}` 透传）
- 「CLI 现状」三档：**已实现**（给出 spec name）／**已实测未实现**（前几份 research 有真实账号只读记录）／**仅静态**
- 表中「键」是 webpack 导出键（如 `business["E"]`），「—」表示该函数没有导出、只能在模块内部使用
- 统计：只读接口 108 个，写接口 31 个，写流程附属与敏感读接口 6 个，共 145 个拼多多端点（模块 25/52/64 的 141 个不同 URL，加页面钩子里的 3 个和字体文件 1 个）

## 请求通道（读表前先看）

店透视有三条发请求的路，「特殊处理」一栏引用这里的编号。

| 编号 | 实现 | 行为 |
| --- | --- | --- |
| A | 模块 25 的 `axios`（U:22657） | 先过 `buildSpiderRequestConfig`：URL 以 `location.origin + "/sydney/api/"` 开头时，取 `/phantom/web/en/ft` 的 `web_spider_rule` 放进 `webspiderrule` 请求头，并按当前 TTF 建立字形映射（U:22597–22629）。随后往页面注入脚本：**请求头非空**时用页面里的原生 `fetch`（带上这些头，返回 `json.result`）；请求头为空时用页面自己的 `window.__mms.fetch[method]`（即商家后台的签名客户端，和 CLI 的 page-api 通道同源）。响应若拿到了映射，用 `webspider["a"]` 递归解码数字（U:22718 之后） |
| B | 模块 52 的 `axios`（U:24667） | 永远走 `window.__mms.fetch[method]`，**忽略调用方传入的 headers**，也没有字体解码。模块 64 的订单函数虽然传了 `anti-content`，经这条通道会被丢掉 |
| C | `yingxiaoBgPost`（U:22630） | 由扩展后台发起 `bgPost`，`credentials: "include"`；请求头 `AccessToken`（取 Cookie `PDDAccessToken`）、`VerifyAuthToken`（取 `localStorage.token`）、`anti-content`；请求体前置 `crawlerInfo`；带 `ruleId` 时用请求改写规则把 `Referer` / `Origin` 改成 `https://yingxiao.pinduoduo.com/goods/report/promotion/overView`。响应带 `error_code` 时，若 `result.verifyAuthToken` 存在就弹出 `mobile.yangkeduo.com/psnl_verification.html` 风控验证页并拒绝 |

辅助构造：
- `anti-content` 由 bundle 内嵌的拼多多 anti-content SDK 本地生成：`new (sign(4))({ serverTime: Date.now() }).messagePackSync()`（模块 478，U:39805–46047，经 `ddysApi["a"]` 即 `GetAnti`，U:28895）
- `buildGoodsDataShowRequest`（U:22728）：请求体加 `crawlerInfo`，请求头加 `anti-content`
- `buildSydneyDataRequest`（U:22755）：默认只加 `anti-content` 请求头；`includeCrawlerInfo: true` 时请求体也加 `crawlerInfo`
- 缓存 `cache.fetchLocal(fn)`（U:26762）：localforage 按「JSON 参数 + 当天日期」做键，同一天同参数只请求一次，跨天自动清除。表中标「缓存」的调用都经过它
- 页面钩子（U:73486）：注入脚本包住 `window.__mms.fetch.get/post`，把页面**自己**发出的部分请求体 / 响应写进 `localStorage` 的 `dts_request` / `dts_response`。店透视借此拿到页面原生请求体当参数模板（例如商品明细，U:30151、U:38435），删掉其中的 `crawlerInfo` 后再用。表中标「钩子」

---

## 一、流量（8）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/mallFlow/queryMallFlowRtData`（`V`，U:22958） | POST | 无参 | 今日实时店铺 / 商品访客、浏览；用于「店铺报表」选今日（U:72745）、「流量数据-流量看板-实时数据」弹窗（U:72165）、「实时数据-监控任务」（U:37525）。店铺报表把 `muvRt`/`mpvRt`/`guvRt`/`gpvRt` 回填成 `uv`/`pv`/`guv`/`gpv` | 通道 A（带 `webspiderrule`，实测为明文） | 已实现 `traffic.todayFlow` |
| mms `/sydney/api/mallFlow/queryMallFlowOverView`（`T`，U:22966） | POST | `{ beginDate, endDate }`，店铺报表按日拆分（每天一请求，3 个一批，U:72743）；`queryType` 非 0 时整段一次 | 店铺报表历史日期的流量汇总；字符串值用 numeral 转数字（U:72752） | 通道 A；缓存；实测本店字体混淆 | 已实测未实现 |
| mms `/sydney/api/mallFlow/queryMallFlowOverViewList`（`U`，U:22974） | POST | `{ beginDate: 今天-30天, endDate: 昨天 }`（U:72658） | 店铺报表近 7 / 近 30 日的日趋势 | 通道 A；实测明文 | 已实现 `traffic.overviewList` |
| mms `/sydney/api/mallFlow/queryLiveOverView`（`R`，U:22982） | POST | 仅定义 | 直播流量汇总（按路径推断） | 通道 A | 仅静态 |
| mms `/sydney/api/mallFlow/queryLiveOverViewList`（`S`，U:22990） | POST | 仅定义 | 直播流量趋势（按路径推断） | 通道 A | 仅静态 |
| mms `/sydney/api/mallFlow/getMallVisitPayPercent`（—，U:22998） | POST | 仅定义；页面 bundle 里为 `{ queryDate }` | 旧版访问-支付占比 | 通道 A | 仅静态（2026-10-31 报告：页面无入口） |
| mms `/sydney/api/mallFlow/getMallFlowData`（`Q`，U:23006） | POST | 仅定义；页面 bundle 里为 `{ startDate, endDate }` | 旧版流量数据 | 通道 A | 仅静态（同上） |
| mms `/sydney/api/hotWord/queryHotWord`（`K`，U:23014） | POST | 本 chunk 未调用；钩子记录页面自身请求体 | 热词 | 通道 A；钩子 | 仅静态（2026-10-31 报告：找不到页面入口） |

## 二、商品数据（7）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/goodsDataShow/queryGoodsPageRT`（`D`，U:22788） | POST | 无参 | 全店商品今日汇总；「店铺报表」今日（U:72764）、「商品数据-商品概况-实时数据」弹窗（U:71572）、监控任务（U:37542）。店铺报表取 `payOrdrCntRt`、`goodsFavCnt`、`guv` 算收藏率 | 通道 A；值为格式化字符串（千分位、百分号），numeral 解析 | 已实测未实现 |
| mms `/sydney/api/goodsDataShow/queryGoodsPageOverView`（`G`，U:22797） | POST | `{ queryDate, queryType }`；按日模式 `queryType` 为 0，每天一请求（U:72683、72762） | 店铺报表历史日期的商品概况 | 通道 A；`buildGoodsDataShowRequest`（`crawlerInfo` + `anti-content`）；缓存；实测混淆 | 已实测未实现 |
| mms `/sydney/api/goodsDataShow/queryGoodsPagePlnOstList`（`H`，U:22806） | POST | 无参（U:72702） | 店铺报表近 7 / 30 日：取 `statDate`、`goodsFavCnt`、`guv`，算 `goodsCltRate = goodsFavCnt / guv` | 通道 A | 仅静态 |
| mms `/sydney/api/goodsDataShow/queryGoodsDetailVOListForMMS`（`E`，U:22814） | POST | ① 商品报表（U:62778）：`{ goodsId: "", sortCol: 8, sortType: 1, pageNum, pageSize, actVs: 1, startDate, endDate, queryType }`，自定义日期按天拆成多次、`queryType: 0`；指定商品时 `goodsId` 为逗号拼接。② 商品明细弹窗 `GoodsEffectDetailModal`（U:38449）：以钩子拿到的页面请求体为模板，叠加日期项；`queryType: 6` 时绕过缓存。③ 商品明细实时监控（U:30199–30221）：`{ cate1Id: "", cate2Id: "", cate3Id: "", sortCol: 0, sortType: 1, queryType: 6, startDate = endDate = 今天 }`，默认 `pageSize: 50` 取两页，指定商品时逐个 `goodsId` + `pageSize: 99999`。④ 趋势弹窗（U:65119）：`{ goodsId, pageSize: 99999, sortCol: 0, sortType: 1, queryType: 0 }`，过去 N 天每天一请求。⑤ SKU 分析（U:68300）：`{ goodsId, startDate, endDate, queryType: 2, sortCol: 0, sortType: 1, pageNum, pageSize }` | 商品明细主力接口：商品报表的「汇总数据」总量（`goodsUv`/`payOrdrCnt`/`payOrdrAmt`）、商品明细、实时监控 | 通道 A（spider-font 解码）；①②④⑤缓存；请求体里会带店透视自己的 `shopName` 字段 | 已实测（混淆；不带页面签名裸调返回 `3000000 非法请求`）未实现 |
| mms `/sydney/api/goodsDataShow/queryGoodsDetailVOList`（无包装，U:30007） | POST | 店透视自己不发；钩子读取页面原生请求体当模板（U:30151、38435） | 灰度关闭时的明文商品明细 | 钩子 | 已实现 `traffic.goodsDetailList` |
| mms `/sydney/api/goodsDataShow/queryGoodsSpanDateList`（—，U:22822） | POST | 仅定义 | 单商品跨日期趋势（按函数名 `fetchGoodsDetailTrend` 推断） | 通道 A | 仅静态 |
| mms `/sydney/api/goodsDataShow/queryMallGoodsBillBoard`（`F`，U:22830） | POST | 仅定义 | 店铺商品榜单（函数名 `fetchGoodsListRank`） | 通道 A | 仅静态 |

## 三、交易（5）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/mallTrade/getMallTradeInfo`（`Z`，U:22902） | POST | 仅定义；钩子记录页面请求体 | 交易数据汇总 | 通道 A；`buildSydneyDataRequest`（`anti-content`）；实测混淆 | 已实测未实现 |
| mms `/sydney/api/mallTrade/queryMallTradeList`（`ab`，U:22912） | POST | 店铺报表（U:72811）：今日 `{ queryType: 6, queryDate: 今天 }`，取 `todayRtList` → `todayPerHourRtList` → `dayList` 中第一个存在的数组的末项；其他日期 `{ queryType: 7, queryDate: 结束日, startDate, endDate }`，取 `dayList` | 交易趋势；今日退款 `sucRfOrdrAmt1d` / `sucRfOrdrCnt1d` | 通道 A；`buildSydneyDataRequest`；钩子 | 已实现 `traffic.todayTrade`（`queryType: 6`）；`queryType: 7` 区间用法仅静态 |
| mms `/sydney/api/mallTrade/getNotPayOrderInfo`（`eb`，U:22934） | POST | 仅定义 | 未支付订单信息（按路径推断） | 通道 A | 仅静态 |
| mms `/sydney/api/mallTrade/getLeadPayOrderInfo`（`N`，U:22942） | POST | 仅定义 | 引导支付（催付）订单信息（推断） | 通道 A | 仅静态 |
| mms `/sydney/api/mallTrade/getDailyLeadPayOrderInfo`（`z`，U:22950） | POST | 仅定义 | 同上，按日（推断） | 通道 A | 仅静态 |

## 四、经营总览（6）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/mallScore/queryMallScoreOverView`（`Y`，U:22780） | POST | 仅定义 | 经营总览的成交 / 服务汇总 | 通道 A；实测混淆 | 已实测未实现 |
| mms `/sydney/api/mallCoreData/queryAppRecentDataList`（—，U:22838） | POST | 仅定义，本 chunk 未调用 | 今日 / 昨日逐小时累计 | 通道 A；包装函数内把 `payOrdrAmtDth`、`payOrdrAupDth` **÷1000**（厘→元），补 `goodsVcr = payOrdrUsrCntDth / guvDth`，并给字段加 `cur` / `last` 前缀、去掉 `Dth` | 已实测未实现 |
| mms `/sydney/api/mallInfo/queryMallDataPageOverView`（—，U:22885） | POST | 仅定义 | 店铺数据页汇总（推断） | 通道 A | 仅静态 |
| mms `/sydney/api/mallInfo/mallPayList`（—，U:22893） | POST | 仅定义 | 分时支付列表（函数名 `fetchTimeMallPayList`） | 通道 A | 仅静态 |
| mms `/sydney/api/mallInfo/queryMallDataPageOverViewList`（—，U:22925） | POST | 仅定义 | 店铺数据页趋势（推断） | 通道 A；`buildSydneyDataRequest` 且 `includeCrawlerInfo: true` | 仅静态 |
| mms `/sydney/api/mallScore/queryMallConfigurationList`（无包装，U:73486） | POST | 店透视不发；钩子记录页面响应 | 经营总览配置（推断） | 钩子 | 仅静态 |

## 五、客服（8）

本 chunk 内都只有定义，参数取自 2026-10-31 页面 bundle 实测报告。

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/desert/stat/mallMonthServiceData`（`yb`，U:23194） | GET | 仅定义；无参 | 近 31 天客服日趋势 | 通道 A（GET 参数拼进查询串） | 已实现 `cs.monthTrend` |
| mms `/desert/stat/mallServiceOverviewData`（`zb`，U:23202） | POST | 仅定义；`{ startDate, endDate }` | 客服区间汇总（3 分钟人工回复率等） | 通道 A | 已实现 `cs.overview` |
| mms `/desert/stat/getMallHourConsultData`（`X`，U:23210） | POST | 仅定义；`{ startDate, endDate }` | 分时咨询 | 通道 A | 已实测未实现（传今天的行为未验证） |
| mms `/desert/stat/mallMonthSalesData`（`vb`，U:23216） | GET | 仅定义 | 客服销售日趋势 | 通道 A | 已实测未实现 |
| mms `/desert/stat/mallSalesOverviewData`（`wb`，U:23224） | POST | 仅定义；`{ startDate, endDate }` | 询单转化、客服销售额 | 通道 A | 已实测未实现 |
| mms `/sydney/api/customer/queryServiceTrend`（—，U:23054） | POST | 仅定义；`{ startDate, endDate }` | 数据中心客服趋势（31 行） | 通道 A | 已实测未实现 |
| mms `/sydney/api/customer/querySpecifiedDayServiceQuality`（`y`，U:23062） | POST | 仅定义；`{ queryDate }` | 单日客服质量 | 通道 A | 已实测未实现 |
| mms `/chats/csReportDetail`（`x`，U:23484） | GET | 仅定义；`?starttime&endtime` | 按客服账号拆分的绩效；**含客服账号名** | 通道 A | 已实测未实现（敏感，需白名单投影） |

## 六、评价与售后质量（11）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/saleQuality/querySaleQualityTopGoodsDetailList`（`ub`，U:23046） | POST | 仅定义 | 售后质量商品排行（函数名 `fetchSaleQualityRank`） | 通道 A | 仅静态 |
| mms `/sydney/api/saleQuality/querySaleQualityDetailInfo`（`qb`，U:23070） | POST | 仅定义 | 售后质量明细 | 通道 A | 仅静态 |
| mms `/sydney/api/saleQuality/queryMallDsrVO`（`tb`，U:23078） | POST | 仅定义 | 店铺 DSR | 通道 A | 仅静态 |
| mms `/sydney/api/saleQuality/queryGoodsEvaluateVO`（`sb`，U:23086） | POST | 仅定义；钩子记录页面请求体；页面为 `{ pageSize, pageNo, sortCol?, sortType?, goodsIdList? }` | 商品评价数 / 评分 | 通道 A；钩子 | 已实测未实现 |
| mms `/sydney/api/saleQuality/queryGoodsEvaluateDetailVOList`（`rb`，U:23094） | POST | 仅定义 | 单品评价趋势 | 通道 A | 仅静态 |
| mms `/saturn/reviews/list`（`i`，U:24761） | POST | 仅定义；钩子记录页面请求体 | 评价列表（正文含 PII） | 通道 B；钩子 | 已实现 `reviews.list` |
| mms `/saturn/review/reply/mall/list`（`j`，U:24769） | POST | 仅定义；钩子记录页面请求体 | 商家回评列表（推断） | 通道 B；钩子 | 仅静态 |
| mms `/saturn/review/reply/review/info`（`g`，U:24785） | POST | 仅定义 | 单条评价回复信息（推断） | 通道 B | 仅静态 |
| mms `/saturn/review/reply/list`（`h`，U:24793） | POST | 仅定义 | 回复列表（推断） | 通道 B | 仅静态 |
| mms `/ascgenius/strategy/list`（`t`，U:23636） | POST | 仅定义 | 按路径推断为售后智能策略列表，含义未确认 | 通道 A | 仅静态 |
| mms `/ascgenius/strategy/execute/list`（`s`，U:23644） | POST | 仅定义 | 同上，执行记录（推断） | 通道 A | 仅静态 |

## 七、地域（5）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/windowsDataCentral/queryMallGeographyDistributionList`（组件内函数，U:59413） | POST | `{ queryType }`，0 / 1 / 2 = 近 1 / 7 / 30 天（U:60118） | 「店透视工具箱-地域分布」省级成团汇总 | **通道 B**（这两个地域接口定义在组件里，走模块 52 的 `axios`，没有 spider 解码；更正 2026-11-11 文档「走 spider-font 解码钩子」的说法） | 仅静态 |
| mms `/sydney/api/windowsDataCentral/queryMallGeographyDataList`（组件内函数，U:59421） | POST | `{ provinceId, queryType }`，逐省一请求（U:59842） | 「地域分布-趋势分析」单省逐日 | 通道 B；缓存 | 仅静态 |
| mms `/express_inf/mall/service/template/queryAllRegion`（`v`，U:26102） | GET | 仅定义；无参 | 全国行政区划字典（推断） | 通道 B | 仅静态 |
| mms `/bulk/region_black/rule`（`x`，U:26107） | GET | 仅定义；无参 | 地区黑名单（不发货地区）规则（推断） | 通道 B | 仅静态 |
| mms `/bulk/region_black/query`（`w`，U:26114） | POST | 仅定义 | 地区黑名单查询（推断） | 通道 B | 仅静态 |

## 八、粉丝（2）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/mallFans/queryTradeFanInfo`（`B`，U:23150） | POST | 仅定义 | 成交粉丝汇总（推断） | 通道 A | 仅静态 |
| mms `/sydney/api/mallFans/queryTradeFanInfoTrend`（`A`，U:23158） | POST | 仅定义 | 成交粉丝趋势（推断） | 通道 A | 仅静态 |

## 九、订单与物流（9）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/mangkhut/mms/recentOrderList`（`business["pb"]` U:23381；`orders["o"]` U:26055） | POST | ① 商品报表「查询退款金额 / 一键获取本页退款数据」（U:62588）：`{ goodsId, orderType: 0, afterSaleType: 4, remarkStatus: -1, urgeShippingStatus: -1, groupStartTime, groupEndTime, pageNumber, pageSize: 50, hideRegionBlackDelayShipping: false, mobile: "" }`，时间为 Unix 秒，最多近 90 天。② SKU 分析（U:68436）：`{ orderType: 0, afterSaleType: 0, goodsId, sortType: 7, remarkStatus: -1, urgeShippingStatus: -1, hideRegionBlackDelayShipping: false, groupStartTime, groupEndTime, pageNumber, pageSize }`，读 `pageItems` / `totalItemNum`，`confirm_time ×1000` 转毫秒 | 订单列表；省市区（`province_name` 等）也来自这里 | `pb`：通道 A，`anti-content` 头 → 页面原生 `fetch`；`o`：通道 B（头被丢弃）；钩子记录请求与响应 | 已实现 `orders.list`；`afterSaleType: 4` 不在 `ORDER_LIST_SCOPES` 已验证组合内，仅静态 |
| mms `/mangkhut/mms/orderDetail`（`cb`，U:23396） | POST | `{ orderSn, source: "MMS" }`（U:62613） | 退款金额：已取消订单直接累加列表的 `order_amount`，其余逐单查详情累加 `order_amount`，合计 ÷100（**分→元**） | 通道 A，`anti-content` | 已实现 `orders.detail` |
| mms `/mangkhut/mms/historyOrderList`（`k`，U:26069） | POST | 仅定义；钩子记录请求与响应 | 历史订单 | 通道 B（`anti-content` 被丢弃）；钩子 | 仅静态 |
| mms `/pizza/order/remarkTag/query`（`y`，U:26080） | POST | 仅定义 | 订单备注标签查询 | 通道 B | 仅静态 |
| mms `/express_base/shipping_list/mms`（`Cb`，U:23596） | GET | 仅定义 | 快递公司列表（推断） | 通道 A | 仅静态 |
| mms `/express_base/tracking_number/regex_match`（—，U:23612） | POST | 仅定义 | 运单号规则匹配（推断） | 通道 A | 仅静态 |
| mms `/express_base/express/profile/get`（`h`，U:26126） | GET | 仅定义 | 快递概况（推断） | 通道 B | 仅静态 |
| mms `/express_base/express/rank/mms/get_list`（`i`，U:26132） | GET | 仅定义 | 快递排行（推断） | 通道 B | 仅静态 |
| mms `/osaka/ship_additional/template/query/list`（`Bb`，U:23620） | POST | 仅定义 | 发货附加模板列表（推断） | 通道 A | 仅静态 |

## 十、商品管理（5）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/vodka/v2/mms/query/display/mall/goodsList`（`goods["e"]` U:24729；`business["W"]` U:23370） | POST | 商品报表选品（U:36977–37140）：列表 `{ is_onsale: 1, sold_out: 0, page, size }`；搜索 `{ goods_id_list: [id] }` 或 `{ goods_name }`，加 `pre_sale_type: 4, page: 1` | 在售商品列表 | 通道 B；缓存；钩子记录请求与响应。实测裸调触发 `54001`，必须走页面签名客户端 | 已实现 `goods.list` |
| mms `/vodka/v2/mms/query/sku/info`（`k`，U:24745） | POST | 仅定义 | SKU 信息 | 通道 B | 仅静态 |
| mms `/glide/v2/mms/query/commit/on_shop/detail`（`L`，U:23102） | POST | `{ goods_id }`（U:68338） | SKU 分析读取在售商品规格（「规格1 / 规格2」） | 通道 A | 仅静态（CLI 发布流程用的是 `/glide/v2/mms/query/commit/detail`） |
| mms `/opportunity-goods/chance-goods/get_hot_search_goods`（`f`，U:24737） | POST | 仅定义；钩子记录页面请求体 | 商机热搜商品（推断） | 通道 B；钩子 | 仅静态 |
| mms `/maine/api/price/protect/goods/list`（`Wb`，U:23756） | POST | 仅定义 | 价格保护商品列表（推断） | 通道 A | 仅静态 |

## 十一、推广（12）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| yingxiao `/mms-gateway/venus/api/goods/promotion/v3/list`（`kb`，U:23317） | POST | ① 商品报表付费流量（U:62697，见 codex-analysis.md H1）：`{ beginDate, endDate, blockType: 3, clientType: 1, pageNumber, pageSize: 50, filter: { searchKeyV2: 商品ID逗号串 }, sortBy: 9999, orderBy: 9999, scenesMode: 1 \| 3, withTagsInfo: true }`，1 = 稳定成本推广、3 = 全店托管，每场景最多重试 3 次。② 推广数据（U:77300 附近，`getSearchData`）：`{ beginDate, endDate, filter: { searchName: 商品ID }, scenesType: 2, sortBy: 0, orderBy: 4, pageNumber: 1, pageSize: 50 }`，今日不走缓存 | 推广商品列表 `result.adInfos` | 通道 C，`ruleId 830004`，`crawlerInfo` | 已实现 `promo.goodsPromotionList` |
| yingxiao `/mms-gateway/venus/api/raphael/ad/info/query`（`q`，U:23334） | POST | 「商品数据-商品明细」弹窗选「全站推广」（U:38496）：`{ startDate, endDate, searchKey: "", withReportInfo: true, orderBy: null, sortBy: null, pageNumber, pageSize }` | 全站推广的商品付费点击；弹窗按 `freeTraffic = goodsUv - 推广点击`（为负时 `null`）另算免费流量（U:38426） | 通道 C，`ruleId 830002`；缓存 | 仅静态 |
| yingxiao `/mms-gateway/venus/api/unit/listPage`（`Ob`，U:23300） | POST | 同一弹窗选「多多搜索」(`scenesType: 0`) /「多多场景」(`2`)（U:38519）：`{ beginDate, endDate, scenesType, pageNumber, pageSize }` | 推广单元列表 | 通道 C，`ruleId 830003`；缓存 | 仅静态 |
| yingxiao `/mms-gateway/apollo/api/report/queryEntityReport`（`nb`，U:23446） | POST | 推广数据 mixin（U:77223–77487）：`{ entityDimensionType: 0, entityId: <店铺ID>, externalFields: [planId, adId, goodsId, …], query: { fieldToValue: { adSearchVal: 商品ID } }, queryDimensionType: 2, goodsId, queryRange: { pageNumber: 1, pageSize: 100 \| 50 }, scenesType: 9 \| 2 \| 6, startDate, endDate }`（`getStationData` 用 9，`getSceneData` 用 2，`getPushData` 用 6） | 实体报表，取 `entityReportList[].externalFieldValues` 的计划 / 单元 | 通道 C，`ruleId 830011`；缓存 | 仅静态（CLI 用同名的 `/mms-gateway/poseidon/api/report/queryEntityReport`，`promo.entityReport`） |
| yingxiao `/mms-gateway/apollo/api/report/queryDailyReport`（`mb`，U:23462） | POST | `{ entityId, scenesType, queryDimensionType: 2, startDate, endDate, goodsId?, query: { fieldToValue: { planId, adId?, locationId: "" } } }`（U:77284 等） | 按计划 / 单元的日报；店透视按 `stationData` 全站推广、`searchData` 标准推广、`starShop` 明星店铺、`liveData` 直播推广等分组汇总 | 通道 C，`ruleId 830012`；缓存 | 仅静态 |
| yingxiao `/mms-gateway/apollo/api/report/queryHourlyReport`（—，U:23478） | POST | 仅定义 | 小时报 | 通道 C，`ruleId 830013` | 仅静态（CLI 用 `/mms-gateway/poseidon/api/report/queryHourlyRangeReport`，`promo.hourlyReport`） |
| mms `/janus/api/subSystem/generateAccessToken`（`C`，U:23347） | POST | `{ redirectUrl: "https://yingxiao.pinduoduo.com/goods/report/promotion/overView" }`（U:34694） | 推广后台免登：为子系统生成 accessToken | 通道 A，`anti-content` 头 | 仅静态（CLI 直接打开 yingxiao 页面） |
| yingxiao `/mms-gateway/user/getToken`（`Kb`，U:23362） | POST | `{ accessToken, subSystemId }`（U:34712） | 用上一步的 accessToken 换推广后台 token，供 `ensureYingxiaoRequestReady` 使用 | 通道 C，`ruleId 830001` | 仅静态 |
| mms `/cps/api/query/zsCaptainList`（`Qb`，U:23110） | POST | 仅定义 | 多多进宝招商团长列表（推断） | 通道 A | 仅静态 |
| mms `/cps/api/query/zsCaptainInfo`（`Pb`，U:23118） | POST | 仅定义 | 招商团长信息（推断） | 通道 A | 仅静态 |
| mms `/cps/api/query/unitList`（`fetchUnitList` —，`fetchSetUnitList` `Ab`，U:23232、23580） | POST | 仅定义；钩子记录请求与响应 | 多多进宝推广单元 | 通道 A；钩子 | 仅静态 |
| mms `/cps/api/data/orderDataList`（`m`，U:26044） | POST | 仅定义 | 多多进宝订单数据 | 通道 B | 仅静态 |

## 十二、活动（20）

本节全部只有定义，没有调用点，用途按路径和函数名推断。

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| mms `/sydney/api/activity/queryMallActivityGoodsList`（`j`，U:23022） | POST | 仅定义；钩子记录页面请求体 | 活动商品数据 | 通道 A；钩子 | 仅静态 |
| mms `/sydney/api/activity/queryMallActivityOverView`（—，U:23030） | POST | 仅定义 | 活动数据汇总 | 通道 A | 仅静态 |
| mms `/leekmms/activity/query/integratedActivityType`（`i`，U:23164） | GET | 仅定义 | 活动类型 | 通道 A | 仅静态 |
| mms `/lakemms/activityGoods/statusType`（`k`，U:23172） | POST | 仅定义 | 活动商品状态枚举 | 通道 A | 仅静态 |
| mms `/lakemms/activityGoods/list`（`M`，U:23180） | POST | 仅定义；钩子记录页面请求体 | 已报名活动商品 | 通道 A；钩子 | 仅静态 |
| mms `/leekmms/activity/query/enroll/rule`（—，U:23188） | POST | 仅定义 | 报名规则 / SKU（函数名 `fetchActSkuList`） | 通道 A | 仅静态 |
| mms `/madrid/query_mms_batch_source_types`（`ob`，U:23500） | POST | 仅定义 | 优惠券批次来源类型 | 通道 A | 仅静态 |
| mms `/madrid/query_mms_mall_batch_list`（`lb`，U:23508） | POST | 仅定义 | 店铺优惠券批次列表 | 通道 A | 仅静态 |
| mms `/madrid/merchant/query_batch_create_goods_batch_list`（`w`，U:23524） | POST | 仅定义 | 商品券批次列表 | 通道 A | 仅静态 |
| mms `/madrid/query_filtered_mall_goods_list`（`Xb` U:23780；`b` U:23828） | POST | 仅定义 | 建券 / 补贴活动的可选商品 | 通道 A | 仅静态 |
| mms `/bordeaux/new_customer_discount/query_promotion_event_list_by_goods`（`db`，U:23532） | POST | 仅定义 | 商品的新客立减活动 | 通道 A | 仅静态 |
| mms `/libra-backend/mms/activity/marketing/query`（`o`，U:23540） | POST | 仅定义 | 营销活动查询 | 通道 A | 仅静态 |
| mms `/libra-backend/mms/activity/marketing/batch/query/activity/detail/info`（`n`，U:23548） | POST | 仅定义 | 营销活动明细 | 通道 A | 仅静态 |
| mms `/bordeaux/mms/common/promotion_event/query_valid_event_list`（`hb`，U:23684） | POST | 仅定义 | 进行中的促销活动 | 通道 A | 仅静态 |
| mms `/bordeaux/mms/common/promotion_event/query_historical_event_list`（— U:23692；`Ub` U:23724） | POST | 仅定义 | 历史促销活动 / 历史活动商品 | 通道 A | 仅静态 |
| mms `/bordeaux/mms/common/promotion_event/query_enrolled_goods_list`（`Rb`，U:23708） | POST | 仅定义 | 活动已报名商品 | 通道 A | 仅静态 |
| mms `/bordeaux/mms/promotion_event/query_valid_promotion_event_list`（`r`，U:23732） | POST | 仅定义 | 满减等进行中活动（函数名 `fetchAmountReduceCurrent`） | 通道 A | 仅静态 |
| mms `/bordeaux/mms/promotion_event/query_promotion_event_goods_list`（`ib`，U:23740） | POST | 仅定义 | 活动商品列表 | 通道 A | 仅静态 |
| mms `/saturn/new/goods/reward/query/current/activity`（`I`，U:23652） | POST | 仅定义 | 新品奖励当前活动 | 通道 A | 仅静态 |
| mms `/saturn/new/goods/reward/query/activity/stats`（`J`，U:23660） | POST | 仅定义 | 新品奖励活动统计 | 通道 A | 仅静态 |

## 十三、其他（10）

| 端点（host+path） | 方法 | 请求参数（观察到的调用） | 用途 / 店透视功能 | 特殊处理 | CLI 现状 |
| --- | --- | --- | --- | --- | --- |
| `https://api.yangkeduo.com/api/phantom/web/en/ft`（`Fb`，U:23140） | POST | `{ scene: "cp_b_data_center" }`（U:22552、30824） | spider-font 配置：`ttf_url`、`web_spider_rule` | 通道 A（非 sydney 地址，走 `__mms.fetch`）；结果进 Vuex 和内存缓存 | 已实测（10-31 页面插件调用）未实现 |
| TTF 字体文件：`ttf_url`，或页面 HTML 中匹配 `webspider.*?ttf` 后拼 `https://commfile.pddpic.com/`（`Gb` `fetchSpiderFont`，U:23122） | GET | URL 来自上一行 | 解析字形建立数字映射 | `opentype.load`（vendors 模块 1190） | 已实测（10-31：`pfile.pddpic.com/webspider-sdk-api/*.ttf`）未实现 |
| mms `/rfreight/postpaid/pc/order_insurance_list`（`fb`，U:23248） | POST | 仅定义 | 消费者体验提升计划收费记录 | 通道 A | 仅静态（CLI 用 `/mms-gateway/rfreight/postpaid/order_insurance_list`，`experiencePlan.orderInsuranceList`） |
| mms `/rfreight/postpaid/pc/compensation_list`（`v`，U:23256） | POST | 仅定义 | 运费补偿记录 | 通道 A | 仅静态（`/mms-gateway/rfreight/postpaid/compensation_list` 已实测未实现） |
| live `/sprite/obs/anchor/info`（`P`，U:23262） | GET | 仅定义 | 主播信息（直播后台，`https://live.pinduoduo.com`） | 通道 A | 仅静态 |
| live `/sprite/obs/anchor/showList`（`Db`，U:23270） | POST | 仅定义 | 直播场次列表 | 通道 A | 仅静态 |
| live `/sprite/obs/statistic/finish`（`Hb`，U:23276） | GET | 仅定义 | 单场直播结束统计 | 通道 A | 仅静态 |
| live `/sprite/obs/history/history/goodsList`（`O`，U:23284） | POST | 仅定义 | 直播历史商品 | 通道 A | 仅静态 |
| live `/kiwi/obs/statistic/live/data`（`Ib`，U:23492） | POST | 仅定义 | 直播数据 | 通道 A | 仅静态 |
| mms `/mercury/play_money/list`（无包装，U:73486） | POST | 店透视不发；钩子记录页面请求与响应 | 含义未确认 | 钩子 | 仅静态 |

---

## 写接口（CLI 不得调用）

以下 31 个接口会改动店铺、商品、活动、评价、订单或物流状态。本 chunk 内都**没有调用点**（只是共享模块里的定义），记录在这里仅为识别用途。CLI 的商品写命令只使用自己已有、受 `--confirm` 约束的端点；本表接口一律不接入。

| 端点（mms 域名） | 键 / 行号 | 推断动作 |
| --- | --- | --- |
| `/lakemms/activityGoods/enroll` | —，U:23038 | 活动报名 |
| `/lakemms/activityGoods/cancelEnroll` | `Tb`，U:23700 | 取消报名 |
| `/lakemms/activityGoods/applyOffline` | `Jb`，U:23668 | 申请活动商品下线 |
| `/glide/v2/mms/twoPieceDiscount/update` | `Nb`，U:23240 | 修改第二件优惠 |
| `/latitude/message/sendOrderUrge` | `xb`，U:23426 | 给买家发催付消息 |
| `/madrid/closeMerchantCouponBatch` | `u`，U:23516 | 关闭优惠券批次 |
| `/madrid/merchant/async_create_merchant_goods_batch_v2`（源码 URL 末尾有空格） | `d`，U:23796 | 异步创建商品券批次 |
| `/madrid/merchant/general_create_merchant_goods_batch` | `e`，U:23836 | 创建商品券批次 |
| `/libra-backend/mms/activity/marketing/stop` | `p`，U:23556 | 停止营销活动 |
| `/libra-backend/mms/activity/marketing/batch/update` | `m`，U:23564 | 批量修改营销活动 |
| `/libra-backend/mms/activity/marketing/stage/batchCreate` | `l`，U:23572 | 批量创建营销活动阶段 |
| `/robot/extra/track/add` | `Lb`，U:23604 | 补录物流轨迹 |
| `/glide/v2/mms/serviceTemplate/sfMarkup/goods/bind` | `h`，U:23628 | 商品绑定顺丰加价服务模板 |
| `/mille/mms/goods/deleteGoods` | `bb`，U:23676 | 删除商品 |
| `/bordeaux/mms/common/promotion_event/quit` | `Sb`，U:23716 | 退出促销活动 |
| `/bordeaux/mms/promotion_event/edit_promotion_event_goods` | `jb`，U:23748 | 修改 / 删除活动商品 |
| `/bordeaux/new_customer_discount/close_promotion_event` | `c`，U:23772 | 关闭新客立减 |
| `/bordeaux/new_customer_discount/create_promotion_event` | `f`，U:23820 | 创建新客立减 |
| `/bordeaux/goods_promotion/create_or_edit_goods_promotion_event` | `g`，U:23804 | 创建 / 编辑商品促销 |
| `/maine/api/price/protect/goods/edit` | `Vb`，U:23764 | 修改价格保护 |
| `/vodka/v2/mms/edit/quantity/increase` | `goods["n"]`，U:24753 | 增加库存 |
| `/glide/v2/mms/price/adjust/adjust_in_list` | `goods["a"]`，U:24817 | 列表内改价 |
| `/guide-api/mms/presale/batch/modify` | `goods["o"]`，U:24825 | 批量修改预售 |
| `/glide/v2/mms/official/goodsName/edit` | `goods["m"]`，U:24833 | 修改商品标题 |
| `/saturn/review/reply/submit` | `goods["q"]`，U:24777 | 提交评价回复 |
| `/saturn/review/reply/publish` | `goods["p"]`，U:24801 | 公开回复 |
| `/saturn/review/reply/cancel/publish` | `goods["c"]`，U:24809 | 取消公开 |
| `/saturn/reportedReview/edit/createReportedReview` | `goods["d"]`，U:24841 | 举报评价 |
| `/pizza/order/remarkTag/update` | `orders["A"]`，U:26088 | 修改订单备注标签 |
| `/pizza/order/noteTag/add` | `orders["b"]`，U:26096 | 添加订单备注 |
| `/bulk/region_black/edit` | `orders["e"]`，U:26120 | 修改地区黑名单 |

写流程附属与敏感读接口（6 个，同样不接入）：

| 端点（mms 域名） | 键 / 行号 | 原因 |
| --- | --- | --- |
| `/madrid/merchant/validate_goods_enroll_subsidy_activity` | —，U:23788 | 补贴活动报名前校验，属于写流程 |
| `/bordeaux/new_customer_discount/pre_check_create_promotion_event` | `a`，U:23812 | 创建新客立减前预检 |
| `/robot/extra/track/preCheck` | `Mb`，U:23588 | 补录物流轨迹前预检 |
| `/latitude/order/validOrderUrge` | —，U:23411 | 催付前校验（`anti-content`） |
| `/galerie/business/get_signature` | `goods["l"]`，U:24847 | 申请上传签名，固定 `{ bucket_tag: "review-report" }`，用于举报评价上传图片 |
| `/fopen/order/receiver` | `orders["q"]`，U:26164 | 读取收件人信息（`anti-content`），返回收件人 PII，与项目 PII 规则冲突 |

---

## 横切注意事项

### 成功码与响应外壳

- 店透视本身几乎不看业务码。通道 A 走原生 `fetch` 时直接取 `json.result`，通道 A / B 都把 `success` 设为「`result.success` 是布尔就用它，否则为 `true`」（U:22705、24703），`errorCode` 不参与判断；只有通道 C 检查 `error_code`
- 浏览器抓包里的上游成功码各模块不同：sydney / desert 为 `errorCode: 1000000`，rfreight 为 `1000`，mangkhut / vodka 用 snake_case `error_code`（见 CLAUDE.md Gotchas 与 2026-11-11 记录）
- **CLI 走 page-api 通道时，合成的成功码一律是 `0`**。新接入模块的成功规则要接受 `0`（`experience-plan` 已踩过：只认 `1000` 时退出码 6）

### spider-font 解码

- 触发条件（店透视实现）：通道 A 且 URL 以 `<当前站点>/sydney/api/` 开头。字体配置来自 `/phantom/web/en/ft`，请求头 `webspiderrule` 取 `web_spider_rule`；映射按 TTF URL 缓存，URL 变化即重建（U:22521–22629）
- 映射建立：先按字形名 `zero`…`nine` / `period`，失败后按每个字形最后一个点的 X 坐标签名 `2:44, .:83, 0:132, 9:134, 8:155, 3:218, 4:339, 1:356, 6:414, 5:470, 7:509`，0 / 9 用 Y 区分，容差 `max(2, unitsPerEm×1%)`（细节见 `codex-analysis.md` H4 与 `goods-detail-plain-and-spider-font-2026-10-31.md` 第 2 节）
- 字体失败时只 `console.warn`，请求照发、结果不解码；未知字符原样保留。店透视随后用 numeral 转数，失败补 0，所以字体失败可能被显示成 0
- 地域接口和全部模块 52 / 64 接口（通道 B）都没有解码钩子
- 对 CLI：明文替代优先（`queryGoodsDetailVOList`、`queryMallFlowOverViewList`、`queryMallFlowRtData` 等）；必须用混淆接口时，按私有区字符检测并报「数据不可用」，或实现上述末点签名解码

### queryType

- 店透视日期控件到 `queryType` 的映射（U:24917）：`recent1` / `date` / `week` / `month` / `daterange` → `0`（逐日单独请求再累加），`recent7` → `1`，`recent30` → `2`，`today` → `6`
- 店铺报表的交易接口另用 `7`（自定义区间，带 `startDate` / `endDate`）
- 平台完整枚举（2026-10-31 页面 bundle）：`-1` 实时、`0` 昨日 / 单日、`1` 近 7 日、`2` 近 30 日、`3` 自然周、`4` 自然月、`5` 按日、`6` 今日实时、`7` 自定义；`querySearchDataForMms` 另有一套映射
- 地域接口的 `queryType` 只有 0 / 1 / 2（近 1 / 7 / 30 天）
- 店透视把多日拆成单日请求后逐日相加，访客类指标会跨日重复计入；界面自带提示「返回数据为整合官方单日数据，可能存在误差」

### 单位换算（bundle 内可见的）

| 来源 | 换算 | 位置 |
| --- | --- | --- |
| `queryAppRecentDataList` 的 `payOrdrAmtDth`、`payOrdrAupDth` | ÷1000，厘 → 元（实测同时返回 `*Cent` 分） | U:22838 |
| 推广列表裸数值金额（`spend`、`gmv`、`directGmv` 等） | ÷1000，厘 → 元；对象形式 `{ value, unit, unitCode }` 取 `value`，`unit === "PERCENT"` 再 ÷`unitCode \|\| 100` | U:47820 附近 |
| 订单 `order_amount` | ÷100，分 → 元 | U:62613 之后 |
| `recentOrderList` 的 `groupStartTime` / `groupEndTime` | Unix **秒** | U:62588、68436 |
| 订单 `confirm_time` | 秒，店透视 ×1000 后格式化 | U:68458 |
| `queryGoodsPageRT`、`queryMallFlowOverView`、`queryGoodsPageOverView` 的字符串值 | numeral 解析（千分位、百分号） | U:72752、72771 |
| 推广派生 `cpm` | `spend / impression × 1000` | U:37385 |

### 其他

- 店透视把自己的 `shopName` 放进多数请求体（用作缓存键，同时随请求发往上游）。CLI 照抄参数时要去掉
- 店透视统计「付费流量」有两套口径：商品报表用推广列表 `clickCount`（稳定成本推广 + 全店托管）；商品明细弹窗用全站推广 / 多多搜索 / 多多场景的点击，`freeTraffic = goodsUv - 推广点击`。两者都来自客户端减法，平台接口里没有现成的免费 / 付费拆分
- vodka 接口裸调会触发 `54001 操作太过频繁`（2026-11-11 实测）；店透视走 `__mms.fetch`，与 CLI page-api 一致

## 未能确认的事项

- 109 个接口在 `pdd_sycm` 内既没有调用点也不在页面钩子名单里，真实参数、响应字段和用途只能按路径推断；它们的调用方应在未下载的 `pdd_yingxiao` / `pdd_pfdetail` / `pdd_mobile` 或已下线功能里
- `afterSaleType: 4`（店透视用于「退款订单」）的确切语义没有实测；CLI 目前只用已验证组合
- `mercury/play_money/list`、`queryMallConfigurationList`、`ascgenius/*`、`osaka/*`、`express_base/*` 的业务含义未确认
- `rfreight/postpaid/pc/*` 与 CLI 在用的 `mms-gateway/rfreight/postpaid/*` 是否同一后端、字段是否一致，未比对
- `apollo/api/report/*` 与 CLI 在用的 `poseidon/api/report/*` 的差异未比对
- 远程资源独立于扩展版本更新，本目录对应 2026-10-31 下载的这份 chunk，当前线上版本可能已有增减

## 附录：店透视自有服务与第三方（不在主表）

| 主机 | 路径（摘要） | 用途 |
| --- | --- | --- |
| `diantoushi.com`（`ROOT` / `HOST`） | `/permission/info`（`business["gb"]`，带店透视 token）、`/user/info`、`/user/loginout`、`/user/login`、`/user/captcha/login`、`/user/v3/captcha`、`/money/userMoneyInfo`、`/user/shop/*`（绑定 / 解绑 / 会员权益等）、`/plug/track`、`/template/*`、`/cloud/template/*`、`/cloud/item/*`、`/goods/*`（浏览历史、选品库等）、`/category/*`、`/check/*`、`/word/cut`、`/upload/file` | 账号、权限、店铺绑定、云端模板、埋点 |
| `api.diantoushi.com`（`ROOT_API`） | `/user/captcha/login`、`/user/login/sms`、`/sms/code`、`/account/info`、`/account/evaluate`、`/user/sendCaptcha`、`/user/resetPassword`、`/user/register`、`/user/loginout`、`/user/dtsToken` | 登录注册 |
| `dfapi.diantoushi.com`（`ROOT_DELIVER`） | `/order/parseReceiverv2`、`/order/remark`、`/order/save`、`/order/saveGoods`、`/order/infov2`、`/order/pay`、`/order/parcelListV2`、`/goods/listv3`、`/finance/amount` | 礼品代发；调用写法为 `axios.bgPost`，而模块 52 的 `axios` 上没有该属性，推断已失效 |
| `api.duoduoyoushu.com`（`ROOT_DDYS`） | `/wx/user/login/*`、`/category/getCategoryInfo` | 多多有数（关联产品）登录与类目 |
| `statistics.diantoushi.com` | `/tj/page` | 页面统计 |
| `assets.diantoushi.com` | `/vendors/weather/index.json`、模块 JS | 静态资源 |
| 第三方 | `liveapi.huitun.com`、`dyapi.huitun.com`；淘宝 / 阿里妈妈 `*.json`（`ai.alimama.com` 等，模块 1234–1236，U:68785–70499） | 同一 chunk 打包进来的其他平台代码，与拼多多无关 |
