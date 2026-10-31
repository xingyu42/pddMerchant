# ④ 客服数据与评价汇总

## Goal

提供客服回复指标的逐日明细，以及中差评的内容汇总，帮助定位转化环节的问题。店铺级近 30 天的 3 分钟人工回复率已经由 ② 透传，本任务不重复提供。

父任务：`10-31-operating-data-gaps`。接口依据：`docs/research/traffic-cs-review-recon-2026-10-31.md` 第五、六节。术语见 `CONTEXT.md` 中的 Negative Review 和 Reply-Rate Caliber。

## Requirements

### R1 客服数据

- R1.1 新增 `pdd diagnose customer-service [--days 30]`。只使用多多客服的 `desert` 口径：逐日趋势取自 `mallMonthServiceData`，含类目参考值；区间汇总取自 `mallServiceOverviewData`，最早可回溯到今天往前 63 天，最晚到昨天。
- R1.2 输出和字段说明里写明口径来源。不采用 `sydney` 客服趋势（它把 0 和 null 混用），也不和 ② 的星级口径合并成一个序列。
- R1.3 比率转成 0-100，后缀 `_pct`；时长按上游单位规整为秒或分钟，并写明单位。没有咨询的日期输出 null。
- R1.4 不输出客服账号名。

### R2 评价汇总

- R2.1 新增 `pdd diagnose reviews [--days 30]`。`--days` 只接受 30、60、90、180，分别对应平台 `rangeType` 的 1、5、4、3。
- R2.2 平台标签聚合（`keywords/agg`）：满意标签和不满意标签，以及各自的计数。
- R2.3 问题类型聚合（`type/agg`）：5 类问题，每类输出正面计数、负面计数和占比。
- R2.4 中差评列表（`reviews/list`）：中差评指描述评分 ≤3 星。每条输出描述、物流、服务三项评分，正文，追评，平台标签，评价时间，商品 ID，是否已回复，图片数。
- R2.5 隐私：正文和追评原文输出，其中手机号格式的片段做掩码。昵称、头像、订单号、订单 ID、规格、图片 URL、视频 URL、订单快照一律不输出。
- R2.6 CLI 不自行分词，也不统计词频。

## Acceptance Criteria

- [ ] `diagnose customer-service` 的 fixture 覆盖：有咨询的日期、无咨询的日期（输出 null）、区间超出 63 天时返回 exit 2。
- [ ] `diagnose reviews` 的 fixture 覆盖：标签聚合、问题类型、中差评分页，以及正文中手机号被掩码。
- [ ] `--days 45` 返回 exit 2。
- [ ] 输出中不含 R1.4 和 R2.5 列出的任何字段；新增的敏感字段名已加入 `REDACT_KEYS`。
- [ ] 实现前在页面内 XHR 拦截中实测 `reviews/list` 的请求体，确认 `descScore` 的实际格式。
- [ ] data 契约 v2 测试覆盖这两个命令。
