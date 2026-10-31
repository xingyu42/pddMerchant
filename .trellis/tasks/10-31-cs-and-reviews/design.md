# ④ 客服数据与评价汇总 — 技术设计

依据：`prd.md`；`docs/research/traffic-cs-review-recon-2026-10-31.md` 第五、六节；2026-10-31 补充的实测结论（见第 6 节）。只透传平台数据。

## 1. 分层与文件

| 层 | 文件 | 职责 |
| --- | --- | --- |
| adapter | 新增 `src/adapter/endpoints/customer-service.js` | `cs.overview`（page-api POST）、`cs.monthTrend`（legacy 被动捕获） |
| adapter | 新增 `src/adapter/endpoints/reviews.js` | `reviews.list`、`reviews.keywordAgg`、`reviews.typeAgg`，三个都是 page-api POST |
| services | 新增 `src/services/customer-service.js`、`src/services/reviews.js` | 参数校验、窗口计算、分页、调用 view |
| views | 新增 `src/services/views/customer-service.js`、`src/services/views/reviews.js`；修改 `labels.js` | 字段白名单、单位换算、headline、hints |
| commands | 新增 `src/commands/diagnose/{customer-service,reviews}.js`；修改 `registry/diagnose.js` | `needsAuth: true`，`needsMall: 'switch'` |
| infra | 修改 `src/infra/logger.js` 的 `REDACT_KEYS` | 加入 `cs_name`、`nickname`、`avatar`、`orderSn`（已存在的跳过） |

参照现有写法：page-api 端点参照 `endpoints/experience.js`；legacy 捕获参照 `endpoints/goods.js` 的 `GOODS_LIST`（`nav` + `urlPattern`）；可选数据源降级参照 `services/experience.js` 的 `optionalEndpoint`，只降级 `PddCliError`。

## 2. 客服：`diagnose customer-service [--days 30]`

- `--days` 取 1–63 的整数，默认 30，超出范围返回 `E_USAGE` / exit 2。窗口为 `[今天 − days, 昨天]`，按上海日期计算。
- `cs.overview`：`POST /desert/stat/mallServiceOverviewData`，参数 `{ startDate, endDate }`（`YYYY-MM-DD`），`nav.url` 为 `https://mms.pinduoduo.com/mms-chat/overview/service`。这是主数据源，失败时整个命令失败。
- `cs.monthTrend`：legacy 策略，`nav` 同上，`urlPattern: /desert\/stat\/mallMonthServiceData/`。页面加载时会自动发出这个 GET 请求，`result` 固定是最近 31 天的数组，日期字段为 `statDate`。这是可选数据源，失败时 `trend: null`。服务层只保留 `statDate` 落在窗口内的行。
- 两个端点的 `isSuccess` 都是 `success === true && errorCode === 1000000`。

字段映射（overview 汇总和 trend 每一行使用同一张表，trend 多出类目参考两项）：

| 输出 key | 上游 | 规整 |
| --- | --- | --- |
| `consult_user_count` | `consultUserCnt` | 原值 |
| `need_manual_reply_user_count` | `needManuReplyConsultUserCnt` | 原值 |
| `manual_receive_user_count` | `receiveUserCnt` | 原值 |
| `manual_reply_3min_rate_pct` | `manuReplyRate3Min` | ×100 |
| `reply_30s_rate_pct` | `manuReplyRate30s` | ×100 |
| `avg_manual_response_seconds` | `artificialResponseTime` | round 2 |
| `unsatisfied_review_count` | `unsatisfiedServeScoreCnt` | 原值 |
| `service_refund_count` | `serveRefundCnt` | 原值 |
| `complained_user_count` | `complainCsUserCnt` | 原值 |
| trend：`category_top10_avg_response_seconds` | `avgReplyTimeTop10` | round 2 |
| trend：`category_avg_response_seconds` | `avgReplyTimeTotal` | round 2 |

上游给 null 就输出 null，没有咨询的日子也是 null，不补 0。`*Compare`、`reply30sRateStapleRank` 等其他字段一律不输出。

data：`{ headline, window: { start_date, end_date, days }, caliber, summary, trend: { items: [{ date, ...第一张表的 key, category_top10_avg_response_seconds, category_avg_response_seconds }] } | null, hints, mall_id }`

- `caliber` 固定为 `多多客服-客服数据（人工回复）`（PRD R1.2）。
- headline 示例：`近 30 天咨询 3 人，3 分钟人工回复率 100%，平均人工响应 14.67 秒`。值为 null 时改写为"无咨询数据"。

## 3. 评价：`diagnose reviews [--days 30]`

- `--days` 只接受 30、60、90、180，分别对应 `rangeType` 1、5、4、3，其他值返回 exit 2。
- 时间：`endTime` = 当前 Unix 秒，`startTime` = `endTime − days × 86400`，和页面写法一致。
- 三个端点的 `nav.url` 都是 `https://mms.pinduoduo.com/goods/evaluation/index`：
  - `reviews.keywordAgg`：`POST /saturn/reviews/keywords/agg`，参数 `{ startTime, endTime, rangeType }`；
  - `reviews.typeAgg`：`POST /saturn/reviews/type/agg`，参数同上；
  - `reviews.list`：`POST /saturn/reviews/list`，参数 `{ startTime, endTime, pageNo, pageSize: 10, descScore: ['1','2','3'] }`。`descScore` 是**字符串数组**（已实测确认）。`pageSize` 用页面默认的 10，最多翻 30 页，翻满时标记截断并给出 hint。
- `isSuccess`：先看实际 fixture 中的外壳字段（`/saturn` 和 sydney 的外壳可能不同），再按 `success === true` 或 `errorCode === 1000000` 判断。normalize 必须按白名单投影，原始对象不能透传出来。
- 三个数据源相互独立：任意一个以 `PddCliError` 失败，对应部分输出 null 并给出 hint；三个都失败时，命令整体失败，抛出最后一个错误。

输出：

- `keyword_tags`：`{ positive: [{ name, count }], negative: [{ name, count }] }`，来自 `positiveKeywordList` / `negativeKeywordList` 的 `{ keywordName, num }`。
- `issue_types`：`[{ name, positive_count, negative_count, share_pct }]`，来自 `typeList` 的 `{ typeName, positive, negative, proportion }`。`proportion` 本身已经是 0-100，原样输出。
- `negative_reviews`：`{ items, total, truncated }`。`total` 取上游的 `totalRows`。每条 item：
  - `goods_id`（字符串）、`reviewed_at`（由 `createTime` 秒转为上海时间）；
  - `desc_score`、`logistics_score`、`service_score`、`history_score`：上游 `score !== 0` 时，页面只展示"历史评分"，这时三项分数为 null，`history_score = score`；否则 `history_score` 为 null；
  - `comment`、`append_comment`：`appendReview` 如果是对象就取其中的文本字段，是字符串就直接用，否则为 null。两者都要做手机号掩码：`/1[3-9]\d{9}/` 替换为 `前三位****后四位`；
  - `tags`：取 `keywords[]` 的文本；`replied`：`reply` 非空时为 true；`picture_count`：`pictures` 的长度。
- 禁止输出：`name`、`avatar`、`orderSn`、`orderId`、`specs`、`thumbUrl`、`goodsInfoUrl`、`orderSnapshotInfo`、图片 URL、视频 URL（PRD R2.5）。
- headline 示例：`近 30 天中差评 N 条`；`不满意标签前 3：A(2)、B(1)`；`问题类型负面最多：商品质量`。数据缺失时省略对应句子。

## 4. 测试与 fixture

- 在 `test/fixtures/test-data.js` 新增 `createCustomerServiceFixtures()` 和 `createReviewFixtures()`，全部用合成数据。评价正文里要放一个合成手机号，用来验证掩码；同时放入禁止输出的字段，用来验证白名单确实把它们滤掉。
- 测试覆盖 PRD 的验收项：有咨询和无咨询的日期、`--days 64` 和 `--days 45` 返回 exit 2、分页截断、单个数据源失败时降级、非 `PddCliError` 继续抛出、掩码生效。
- `data-contract-v2` 增加这两个命令的用例，并用 `entityFields` 覆盖各个数组。e2e 断言输出中不含禁止字段。

## 5. 回退

纯新增两条命令注册，加上 `REDACT_KEYS` 的追加，不涉及 schema 和共享 runner。

## 6. 实测补充（2026-10-31，Boss 授权的只读浏览器侦察）

- `reviews/list` 的筛选逻辑：bundle 中的 `"descScore-1"` 先按 `-` 拆开，再执行 `params.descScore.push("1")`，所以元素是字符串。时间参数 `startTime`/`endTime` 是秒，`pageNo`/`pageSize` 为 1/10。
- `mallMonthServiceData`：GET 请求，带 Anti-Content，外壳为 `{ success, errorCode, errorMsg, result: [31 行] }`，日期字段 `statDate`；没有咨询的日子本店字段为 null，类目均值仍然有值。
