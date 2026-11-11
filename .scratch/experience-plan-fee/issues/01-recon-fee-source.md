# 01: 侦察消费者体验提升计划服务费的数据来源

**What to build:** 只读侦察服务费的上游来源，回答 `.scratch/experience-plan-fee/spec.md`「未知」一节的全部问题，结论写到 `docs/research/`。需要真实账号，执行前确认范围。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 定位页面与端点、请求参数、响应外壳和成功码
- [x] 确认粒度（逐单 / 费率 / 汇总）以及和订单号的对应方式
- [ ] 确认扣款时间点、退款后的处理（样例中运费补偿生效时间早于发货时间，推断在下单或支付后生效；实际扣费时点与退款后是否退还均未确认）
- [x] 记录是否命中 `spiderFont`、响应中需要剔除的 PII 与店铺标识
- [x] 给出结论：03 是否可做

## Comments
- 2026-11-11：浏览器只读实测完成，结论见 `docs/research/realtime-and-fee-recon-2026-11-11.md` 第二节：有逐单收费列表（按 orderSn 对齐），03 可做。未确认：退款后服务费是否退还、收费状态其余取值样本、汇总与列表计数口径差异。
