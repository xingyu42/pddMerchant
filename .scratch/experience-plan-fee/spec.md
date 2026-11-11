# 消费者体验提升计划服务费

Status: needs-triage

## 现象

开通消费者体验提升计划（退货包运费）后，平台按订单动态计算并扣收服务费。CLI 拿不到这笔费用：

- `diagnose experience` 只输出 `consumer_experience_plan: { enabled, required, next_star_status }`（`isRps` / `isRequireRps` / `isRpsNextStarRkDesc`），没有费用
- `goods profit` 只能用商家手填的每单固定值（`--insurance-yuan`、`--technical-service-yuan`）近似，和逐单动态扣费不一致，利润偏差无法审计

## 未知（全部待侦察）

- 数据在哪个页面 / 端点：候选为消费者体验提升计划页面、资金中心账单 / 扣款明细
- 粒度：逐单金额、费率还是汇总
- 和订单号的对应方式
- 扣款时间点（下单、发货、结算）
- 退款 / 售后后是否退还
- 是否字体混淆

## 约束

- 服务费是 Platform-Reported 数值，原样报告，CLI 不按费率重算
- 接入 `goods profit` 会改变 ADR 0004 的成本语义和 `data` 契约，需要先更新 ADR
- 只有汇总或费率时，逐商品归属沿用 ADR 0004 对店铺级推广费的做法：不分摊

## 拆分

- `issues/01`：侦察（阻塞其余）
- `issues/02`：只读查询
- `issues/03`：接入 `goods profit`（依赖 02，且 01 确认有逐单数据）
