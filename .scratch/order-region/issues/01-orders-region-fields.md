# 01: 订单列表与详情输出收货省市区

**What to build:** `orders list` 的每条订单和 `orders detail` 的订单对象都输出 `province`、`city`、`district`，值为平台给出的省、市、区名称，上游缺失或为空串时为 `null`。收件人姓名、手机号、联系电话、昵称、详细地址、商家退货地址、快递员电话继续不进入任何输出。这是对 v2 契约决定 D5 的修订，只放行省、市、区三个名称。参见 `.scratch/order-region/spec.md`。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] fixture 模式下 `orders list` 每条订单带 `province` / `city` / `district`，值与合成 fixture 一致
- [x] fixture 模式下 `orders detail` 的订单对象带同样三个字段
- [x] 上游缺失或空串时三个字段为 `null`
- [x] `data-contract-v2` 中 `orders.list`、`orders.detail` 的字段集包含三个新字段并通过
- [x] e2e PII 守卫的键名检查不再拦截省市区，仍拦截收件人、手机、电话、地址、昵称、联系方式；收件人姓名、手机号、详细地址的合成值依旧不出现在输出里
- [x] 上游注入 `consumerAddress`、`refundAddressInfo` 等地址类字段时输出不变
- [x] 订单视图单测的精确键集与 PII 用例同步更新
- [x] `.trellis/spec` 中订单 PII 的契约描述写明省、市、区名称可输出（修订 D5）
- [x] `npm test` 通过

## Comments
- 2026-11-11：已在集成分支 feat/region-sku-stock 完成（64bf883）。
