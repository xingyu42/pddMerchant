# 01: `goods stock` 输出规格明细

**What to build:** `goods stock` 的每个告警商品带 `skus` 数组，列出该商品全部规格的 `sku_id`（字符串）、`spec`、`quantity`、`on_sale`（布尔，缺失为 `null`）。上游商品缺少 `sku_list` 或它不是数组时，`skus` 为 `null`，headline 增加一行说明规格数据缺失的商品件数。告警筛选规则本工单不变（仍按商品总库存）。商家拿到 `sku_id` 后可以直接用 `goods update stock --sku-id` 补单个规格。规格字段名和取值规则见 `.scratch/sku-stock/spec.md`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 商品端点只从上游规格中投影 `skuId`、`spec`、`skuQuantity`、`isOnsale`，`sku_list` 缺失时不抛 shape 错误，记为规格数据不可用（区别于零个规格）
- [ ] 单个规格库存不是有限非负数时 `quantity: null`
- [ ] `goods stock` 条目使用独立的条目字段列表（现有商品视图字段 + `skus`）和规格字段列表；`goods list`、`goods segment` 输出不变
- [ ] 上游规格对象注入多余字段时输出不变
- [ ] 合成 fixture 扩展出带 `sku_list` 的商品；fixture 模式 CLI 断言 `skus` 内容、`skus: null` 分支和对应 headline
- [ ] `data-contract-v2` 中 `goods.stock` 改用新条目字段与 `items[].skus[]` 字段，`goods.list` 仍断言原商品视图字段集
- [ ] `npm test` 通过

## Comments
