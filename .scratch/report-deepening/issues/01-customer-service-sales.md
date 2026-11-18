# 01: `diagnose customer-service` 增加客服销售区块

**What to build:** 商家运行 `diagnose customer-service` 时，在原有咨询、回复率数据之外，看到平台「多多客服-销售数据」口径下的询单人数、成团人数、询单转化率和客服销售额：一份区间汇总，一份逐日趋势（逐日另带询单转化率的同类目前 10% 均值和整体均值）。新数据放在 `data.sales`，带自己的口径标签和日期窗口，窗口结束于今天往前第 3 天；headline 增加一行带日期区间的概括。销售数据拉取失败时其余内容照常输出。字段、空值和失败规则见 `../spec.md`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `data.sales` 含 `caliber`「多多客服-销售数据」、`window`、`summary`、`trend`，字段名与 spec 一致；比率为 0–100 的 `_pct`，金额为 `_yuan`
- [ ] 销售窗口天数随 `--days`，结束日为上海时区今天往前第 3 天；现有 `window`、`summary`、`trend` 不变
- [ ] 逐日趋势按销售窗口过滤、按日期升序；同类目两项均值只出现在逐日行
- [ ] 询单 0 人时转化率为 `null`，成团 0 人时客服销售额为 `null`，尚未出数的日期保留为整行 `null`
- [ ] 客服可提升销售额和环比字段不出现在输出里
- [ ] headline 新增一行带日期区间的销售概括；询单人数为 `null` 时写「<区间> 无询单数据」
- [ ] 区间汇总失败：`sales` 为 `null`，hint「客服销售数据拉取失败」，退出码 0，不加 headline 行；仅逐日失败：`sales.trend` 为 `null`，hint「客服销售逐日趋势拉取失败」
- [ ] `data-contract-v2` 中该命令的 case 覆盖 `sales`；CLI + fixture 测试和服务层假时钟测试覆盖以上行为，fixture 为合成数据
- [ ] 报表文档、CHANGELOG、`.trellis/spec` 的服务契约与命令契约已同步
- [ ] `npm run check` 通过
- [ ] 真实账号验证（需先重新登录）：点击页签触发的逐日趋势能取到；查看自定义日期最早可选日并按 spec 处理窗口起始日；结果写入 Comments

## Comments

- 2026-11-19 预先重构排查：没有需要单独先做的重构，不设 00 号工单。本单内顺手做的一处小泛化：报表窗口目前只有「截至昨天」的写法，销售窗口需要「截至今天往前第 3 天」，把滞后天数做成参数即可。指标换算表已支持元和比率；点击触发后抓包的端点写法在商品、推广端点里已有先例。
