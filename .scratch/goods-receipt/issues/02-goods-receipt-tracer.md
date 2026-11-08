# 02: `pdd goods receipt` 主干（常规优惠口径，单页列表）

**What to build:** 新增只读命令 `pdd goods receipt`，调用商品价格管理列表接口（场景值固定 `[7,8]`），按 SKU 原样报告 **Estimated Merchant Receipt（预估实收）**。字段映射、零值与空值规则、错误处理全部以 `.scratch/goods-receipt/spec.md` 为准。这一阶段每个商品只输出列表接口带回的 SKU，`sku_count` 如实反映已输出的 SKU 数；补全由 03 负责。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `--goods-id`（可重复，也可逗号分隔）、`--page`、`--size`（默认 10，取值 1–10）可用；`--size 11` 返回退出码 2
- [x] 每个 SKU 按 spec 的映射表输出：`group_price_yuan`、`pre_coupon_price_yuan` / `pre_coupon_price_source`（活动价或「拼单价」）、`single`、`multi`，各自带 `discounts[]`；金额为分转元
- [x] 平台明确的无优惠输出 `0` 和 `[]`；缺少多件场景时 `multi: null`；缺少单件场景时 `single: null` 并写入 `meta.warnings`；非当前口径的场景值被忽略并写入 `meta.warnings`
- [x] `data` 含 `headline`（商品数、SKU 数、口径）、`items`、`total`、`page`、`size`、`caliber: "商家出资常规优惠"`；输出不含图片链接、30 日销量、上游原始对象
- [x] 上游业务错误返回退出码 6，提示为上游原文
- [x] `data-contract-v2` 覆盖 `goods.receipt`；e2e 测试使用合成 fixture

## Comments

- 2026-11-08：已在集成分支 `feat/goods-receipt` 完成（e229c21）；code review 修复见 5de97f1、4054a74。
