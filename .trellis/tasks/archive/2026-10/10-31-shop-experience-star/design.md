# ② 店铺综合体验星级 — 技术设计

依据：`prd.md`、`docs/research/pilot-mall-recon-2026-10-31.md`。只透传平台数据，CLI 不做任何计算判断。

## 1. 分层与文件

| 层 | 文件 | 职责 |
| --- | --- | --- |
| adapter | 新增 `src/adapter/endpoints/experience.js` | 3 个 `page-api` 端点：`experience.navigatorInfo`、`experience.navigatorReadyDate`、`experience.navigatorList`；normalize 时按白名单投影，丢弃 `mallId`、`mallName`、图片 URL |
| services | 新增 `src/services/experience.js` | `getShopExperienceView(ctx, { days })`：校验参数，先取就绪日，再取快照和趋势，最后调 view |
| views | 新增 `src/services/views/experience.js`；修改 `labels.js` | 指标映射表、单位规整、headline、hints |
| commands | 新增 `src/commands/diagnose/experience.js`；修改 `src/commands/registry/diagnose.js` | `diagnose experience [--days 7]`；`needsAuth: true`，`needsMall: 'switch'` |

不加入 `DIAGNOSE_DIMENSIONS`：`diagnose shop` 和环比功能会读这个表，按 PRD R8，本期不并入 shop。

## 2. 端点

- 3 个端点都是 `strategy: 'page-api'`，`nav.url` 为 `https://mms.pinduoduo.com/sycm/goods_quality/pilot_mall`。由页面自带的请求客户端负责签名（Anti-Content），写法参照 `orders.js` 中的 `ORDER_LIST`。
- `isSuccess`：`raw.success === true && raw.errorCode === 1000000`。业务错误用 `readBusinessError()` 读取（字段为 camelCase 的 `errorCode`）。
- Info 无参数；ReadyDate 无参数，`result` 是 `YYYY-MM-DD` 字符串；List 的参数是 `{ beginDate, endDate }`。
- 每个端点的 normalize 只保留第 3 节表格中出现的上游字段，外加 `timestamp`（Info）或 `pt`（List），以及 `normalFlag`、`delayData`。

## 3. 指标映射（唯一的事实来源，放在 views/experience.js）

| key | 维度 | 名称 | 上游值字段 | 单位 | 规整 |
| --- | --- | --- | --- | --- | --- |
| `platform_help_rate_pct` | 售后服务 | 近30天平台求助率 | `ptHelpRate1m` | 百分比 | ×100 |
| `manual_reply_3min_rate_pct` | 售后服务 | 近30天3分钟人工回复率 | `aprsIn3minRplyUsrRto1m` | 百分比 | ×100 |
| `refund_in_transit_hours` | 售后服务 | 近30天在途订单退款时长 | `rfSignTime1m` | 小时 | 原值 |
| `refund_after_return_hours` | 售后服务 | 近30天商家签收退货后平均退款时长 | `rfProcTime1m` | 小时 | 原值 |
| `review_score_rank` | 商品品质 | 近90天用户评价得分排名 | `dsr3m` | 平台原值 | 原值（单位未确认） |
| `positive_review_rate_pct` | 商品品质 | 近30天积极评论率 | `posTypeRto1m` | 百分比 | ×100 |
| `serious_inferior_rate_pct` | 商品品质 | 近30天严重劣质率 | `seriousInferiorRto1m` | 百分比 | ×100 |
| `group_to_sign_days` | 物流服务 | 近30天成团-签收时效 | `adjNfkAvgCfmSignTime1m` | 天 | 原值 |
| `logistics_violation_rate_pct` | 物流服务 | 近30天物流综合违规处理率 | `lgstMergeFine1m` | 百分比 | ×100 |
| `shop_activity_pct` | 店铺活跃 | 近30天店铺活跃度 | `gmvRk` | 百分比 | 原值（上游已是 0-100） |

- 下一星级门槛取 `<值字段>NextPctThreshold`，按同一规则规整；`gmvRk` 对应 `gmvRkNextPctThreshold`。
- 达标状态取 `<值字段>NextStarRkDesc`：`0` → `已达标`，`1` → `未达标`，其他值或 null → null。值为 null 时状态也输出 null（页面显示 `--`）。
- `avgDescRevScrRcatePct3m` 页面没有展示、单位也不明，不输出。所有 `*Rk`、`*RkDesc`、`*4p5Standard`、`*5Standard`、`*RkStage` 以及 `mallStarToc` 都不输出（PRD R6）。
- 数值保留 2 位小数，统一用 `infra/units.js` 的 `round`。

## 4. data 契约（`diagnose.experience`）

```text
{
  headline: string[],
  status,                       // 数据完整 / 数据不完整
  snapshot: {
    stat_date,                  // Info.timestamp，YYYY-MM-DD
    star, star_change, next_star,           // mallStarTomms / mallStarTommsChange / mallStarTommsNext
    next_star_rank_pct,                     // mallStarTommsNextPct（下一星级对应的综合分排名门槛）
    score_rank_pct,                         // scoreRk，领航员综合分行业排名
    score_grade, star_text, industry,       // scoreDsc / mallStarDesc / stplName，原文
  },
  indicators: [{ key, dimension, name, value, unit, next_star_threshold, next_star_status }],
  consumer_experience_plan: { enabled, required, next_star_status },  // isRps / isRequireRps / isRpsNextStarRkDesc
  trend: { start_date, end_date, days, items: [{ date, star, score_rank_pct, <第 3 节全部 key> }] } | null,
  hints: string[],
  mall_id,
}
```

- `dimension`、`unit`、`next_star_status` 输出中文标签，映射表放在 `labels.js`。
- `trend.items` 按日期升序。平台缺数据的日期直接缺行，不补 0（R7）。
- headline 最多 3 句：`店铺综合体验星级 4.6 星（较前1天 0），下一星级 4.7 星`；`领航员综合分行业排名 46.14%，平台评级「良」`；`考核指标 N 项，已达标 X 项、未达标 Y 项`。数值缺失时省略对应片段。

## 5. 窗口、错误与完整性

- `--days` 取 1–30 的整数，默认 7，超出范围返回 `E_USAGE` / exit 2。
- 趋势窗口：`endDate` = ReadyDate 的返回值，`beginDate` = `endDate − (days − 1)`，按日期字符串计算，不依赖宿主机时区。
- Info 失败：命令整体失败，沿用 runner 的错误 envelope。ReadyDate 或 List 失败：`trend: null`，`status` 为数据不完整，并给出 hint。处理方式和 ① 的 F1 一致：只降级 `PddCliError`，其他异常继续抛出。
- `normalFlag === false` 或 `delayData` 非 null 时，追加 hint「平台标记数据延迟」，`status` 保持不变。

## 6. 测试与 fixture

- 在 `test/fixtures/test-data.js` 增加 `createExperienceFixtures()`，用侦察报告里的样本（店铺字段换成合成值），交给真实 normalize 生成 fixture。
- 单元测试 `test/services/experience-view.test.js`：映射与单位、达标标签、null 透传、白名单字段集合、headline。
- 单元测试 `test/services/experience.test.js`：窗口计算，`--days` 边界（0 / 1 / 30 / 31），List 失败降级为 null，非 PddCliError 继续抛出。
- 在 `test/contract/data-contract-v2.test.js` 增加 `diagnose.experience` 用例，并用 `entityFields` 覆盖 `indicators[]` 和 `trend.items[]`。
- e2e：`diagnose experience --json` 输出单行；`data` 里不出现上游键 `mallId`、`mallName`，也不出现店铺名文本。`mall_id` 和其他 diagnose 命令一样，由 ctx 明文输出，这是项目现有的约定。

## 7. 回退

纯新增：只追加了一个命令注册和若干 labels。回退时撤掉 registry 中这一行注册即可。不涉及 schema 和共享 runner。

## 8. 遗留（不在本期范围）

`dsr3m` 的单位、`mallStarToc` 的含义、趋势接口里 `*Rk` 的单位，都等以后有样本再确认。真实账号的冒烟验证需要 Boss 另行授权。
