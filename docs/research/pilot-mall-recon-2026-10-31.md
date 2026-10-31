# 店铺领航员 / 店铺综合体验星级 — 接口侦察报告

> 数据来源：用户已登录的 Chrome（agent-browser-cli），只读访问 `https://mms.pinduoduo.com/sycm/goods_quality/pilot_mall`（2026-10-31）
> 方法：CDP 网络监听抓取响应体 + 已加载 JS bundle（`Aftersales.*.chunk.js`）静态检索请求参数
> 脱敏：店铺 ID、店铺名、图片 URL 已替换为占位符；请求头只记录名称

---

## 一、页面结构与术语

页面顶部公告：**"店铺领航员将升级为店铺综合体验星级，以店铺综合体验星级为准"**。4.5 星对应领航员超过 30% 的商家，4.8 星对应超过 60%。

- **店铺综合体验星级**：展示在 App 商品详情页 / 店铺详情页，数据基础是**领航员综合分**
- **领航员综合分行业排名**：百分位，例如 46%
- **维度指标表现明细**：分 5 个体验维度（售后服务、商品品质、物流服务、店铺活跃、特色服务），每个指标给出店铺表现，以及达到下一星级的标准与是否达标
- **星级趋势图**：可选近 7 日 / 近 30 日，前端一次性拉取 30 天数据，切换范围时在客户端筛选，不发新请求

同一 bundle 中另有 **商品领航员**（`/sydney/api/goodsNavigator/*`），属于商品级指标，和本页的店铺级数据是两个概念。

## 二、端点表

所有端点都是 `POST`、`application/json`，请求头含 `Anti-Content`。响应外壳为 `{ success, errorCode, errorMsg, result }`，成功时 `errorCode = 1000000`，字段命名为 camelCase。

| 端点 | 请求体 | 用途 |
| --- | --- | --- |
| `/sydney/api/mallNavigator/queryUpgradeMallNavigatorInfo` | 无参数 | 最新一天的星级、综合分排名和各指标明细（本页主数据） |
| `/sydney/api/mallNavigator/queryUpgradeMallNavigatorList` | `{ beginDate, endDate }`（`YYYY-MM-DD`） | 按天给出的历史快照数组，前端取 `endDate - 30 天` |
| `/sydney/api/mallNavigator/queryUpgradeMallNavigatorReadyDate` | 无参数 | `result` 为最新就绪日期字符串，例如 `"2026-10-30"`，用作趋势的 `endDate` |
| `/sydney/api/mallNavigator/queryApplicationSceneList` | 无参数 | 星级应用场景的说明文案（含图片 URL），没有指标数据 |
| `/sydney/api/mallCoreData/queryMallNavigatorVersionTagV4` | — | `result: boolean`，灰度/版本标记 |
| `/sydney/api/mallService/queryConsumerSeekHelpDataWhiteList` | — | `result: boolean`，求助数据白名单标记 |

注意：Info 的 `timestamp`（统计时间，例如 `2026-10-29`）比 ReadyDate（`2026-10-30`）早一天，两者口径不同。

## 三、`queryUpgradeMallNavigatorInfo` 字段

### 3.1 星级与综合分

| 字段 | 示例 | 页面对应 / 含义 | 单位 |
| --- | --- | --- | --- |
| `mallStarTomms` | 4.6 | 商家后台展示的店铺综合体验星级 | 星 |
| `mallStarToc` | 4.5 | 推测为消费者端展示星级（待确认） | 星 |
| `mallStarTommsChange` | 0 | 较前 1 天 | 星 |
| `mallStarTommsNext` / `mallStarTommsNextPct` | 4.7 / 50 | 下一星级及其对应的综合分排名门槛 | 星 / 0-100 |
| `mallStarDesc` | "已超越40%同行" | 文案 | 文本 |
| `scoreRk` | 46.136 | 领航员综合分行业排名（页面显示 46%） | 0-100 百分位 |
| `scoreDsc` | "良" | 平台给出的综合分等级文案 | 文本 |
| `scoreRegionRank` | 4 | 区间档位，含义待确认 | 整数 |
| `stplName` | "母婴" | 行业 | 文本 |
| `timestamp` | "2026-10-29" | 统计时间 | 日期 |
| `normalFlag` / `delayData` | true / null | 数据正常标记 / 延迟说明 | — |

### 3.2 指标明细（值字段 → 页面）

| 维度 | 字段 | 示例 | 页面文案 | 单位 | 下一星级门槛字段 |
| --- | --- | --- | --- | --- | --- |
| 售后服务 | `ptHelpRate1m` | 0.0323 | 近30天平台求助率 3.23% | 0-1 比率 | `ptHelpRate1mNextPctThreshold` |
| 售后服务 | `aprsIn3minRplyUsrRto1m` | 0.5 | 近30天3分钟人工回复率 50.00% | 0-1 比率 | `…NextPctThreshold`=0.8 |
| 售后服务 | `rfSignTime1m` | 27.77 | 近30天在途订单退款时长 27.77小时 | 小时 | `…NextPctThreshold`=3.995 |
| 售后服务 | `rfProcTime1m` | null | 签收退货后平均退款时长 `--` | 小时 | `…NextPctThreshold` |
| 商品品质 | `dsr3m` | null | 近90天用户评价得分排名 `--` | 待确认 | `dsr3mNextPctThreshold` |
| 商品品质 | `avgDescRevScrRcatePct3m` | null | 评价相关，前端在趋势数据中除以 100 | 待确认 | `…NextPctThreshold`=50 |
| 商品品质 | `posTypeRto1m` | 0.9091 | 近30天积极评论率 90.91% | 0-1 比率 | `…NextPctThreshold`=0.9444 |
| 商品品质 | `seriousInferiorRto1m` | 0.0013 | 近30天严重劣质率 0.13% | 0-1 比率 | `…NextPctThreshold` |
| 物流服务 | `adjNfkAvgCfmSignTime1m` | 2.04 | 近30天成团-签收时效 2.04天 | 天 | `…NextPctThreshold` |
| 物流服务 | `lgstMergeFine1m` | 0.0194 | 近30天物流综合违规处理率 1.94% | 0-1 比率 | `…NextPctThreshold` |
| 店铺活跃 | `gmvRk` | 22.24 | 近30天店铺活跃度 22% | 0-100 | `gmvRkNextPctThreshold`=50 |
| 特色服务 | `isRps` / `isRequireRps` | false / true | 消费者体验提升计划开通状态：未开通（延迟两天更新） | 布尔 | — |
| 特色服务 | `isBfc` / `isRequireBfc` / `bfcOrdrRt` | false / false / null | 另一项特色服务，页面未展示 | — | — |

每个指标还附带以下后缀字段：

| 后缀 | 观察 | 推断 |
| --- | --- | --- |
| `*NextStarRkDesc` | 页面"已达标"的为 0，"未达标"的为 1 | 相对下一星级是否达标：0=已达标，1=未达标 |
| `*Rk` | 例如 `ptHelpRate1mRk`=52.92 | 该指标的行业排名百分位（0-100），待确认 |
| `*RkDesc` | 取值 0/1/2 | 排名档位，含义待确认 |
| `*4p5Standard` / `*5Standard` | 取值 0/1 | 是否满足 4.5 星 / 5 星标准，和页面达标状态并不完全一致，待确认 |
| `*RkStage` | 取值 0-3 或 null | 阶段档位，含义待确认 |

另有一组 `qltyRfndRto1mRk`、`lowCmtRto1mRk`、`rpurRto1mRk`、`qltyPtHelpRto1mRk`、`avgCfmShpTime1mRk`、`mallActiveScore1mRk`，本店全为 null，推测是新版指标的预留字段。

## 四、`queryUpgradeMallNavigatorList`（趋势）

- 前端调用：`queryUpgradeMallNavigatorList({ beginDate: endDate - 30d, endDate })`；另一处组件默认取近 7 天，并允许自定义 `startTime` / `endTime`
- `result` 为数组，每天一行，日期字段为 `pt`；每行 33 个字段，是 Info 的子集：值字段、`*Rk`、`gmvRk`、`gmvRkDesc`、`mallStarTomms`、`scoreRk`、`bfcOrdrRt`。不含门槛字段和达标字段
- 某天无数据时前端用 `{ pt }` 补位，所以缺失日在后端是直接缺行
- **单位不一致风险**：同一指标的 `*Rk` 在趋势数据中出现 0-1 量级的值（例如 `posTypeRto1mRk`=0.0242），在 Info 中是 0-100 量级（17.79）。还不能确定这是同一单位下的真实变化，还是两个接口单位不同，需要用同一天的数据对比确认
- 本次抓到的响应体被 CDP 截断在 20000 字符，只覆盖了 2026-10-01 到 10-21；完整长度未知

## 五、同一 bundle 中的相关端点（未调用，供后续侦察）

| 领域 | 端点 |
| --- | --- |
| 客服数据 | `/sydney/api/customer/queryReadyDate`、`querySpecifiedDayServiceQuality`、`queryServiceTrend` |
| 评价 / DSR | `/sydney/api/saleQuality/queryMallDsrReadyDate`、`queryMallDsrVO`、`queryMallDsrVOList`、`queryGoodsEvaluateVO`、`queryGoodsEvaluateDetailVOList` |
| 商品领航员 | `/sydney/api/goodsNavigator/queryGoodsNavigator`、`queryGoodsNavigatorList`、`queryGoodsNavigator30DaysTrend`、`queryGoodsNavigatorDataTrend`、`showGoodsNavigator` |
| 服务分 / 求助 | `/sydney/api/mallService/getMallServeScoreInfo`、`getMallServeScoreTrend`、`getMallServeScoreCoreProb`、`seekHelpData`、`seekHelpDataTrend`、`getMallDisputeRefundAfterSalesList` |
| 店铺分 | `/sydney/api/mallScore/queryMallScoreInfo`、`queryMallScoreOverView` |
| 流量 / 交易 | `/sydney/api/cateStatis/cateFlowChart`、`cateFlowComp`、`/sydney/api/mallFlow/topGoods`、`topMall` |
| 写操作（禁止调用） | `mallScore/submitConfigurationList`、`mallScore/clickRecommendFlag`、`mallScore/clickExpressSmsToast`、`mallService/attitude/sign` |

## 六、开放问题

1. `mallStarToc` 和 `mallStarTomms` 分别对应哪一端的展示星级
2. `*Rk`、`*RkDesc`、`*4p5Standard`、`*5Standard`、`*RkStage` 的准确语义
3. 趋势数据中 `*Rk` 的单位是否和 Info 一致
4. `dsr3m`、`avgDescRevScrRcatePct3m` 的单位（本店为 null，无法观察）
5. 趋势接口允许的最大日期跨度
6. 不带 `Anti-Content` 能否调用：CLI 走浏览器页面内的 XHR 拦截，正常情况下不涉及这个问题
