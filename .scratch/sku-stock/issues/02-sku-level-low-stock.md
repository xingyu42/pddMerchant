# 02: 按规格库存触发库存告警

**What to build:** `goods stock` 的告警条件扩展为：商品总库存 ≤ 阈值，或至少一个在售规格库存 ≤ 阈值。每个规格增加 `low_stock`（在售、库存为有限数且 ≤ 阈值），每个告警商品增加 `low_stock_sku_count`（规格数据不可用时为 `null`）。已下架规格、库存缺失的规格、`on_sale` 缺失的规格都不触发。headline 新增一行：本页低库存规格总数，以及总库存高于阈值、因规格库存触发的商品数。`--threshold` 同时作用于商品和规格，不新增选项。参见 `.scratch/sku-stock/spec.md` 的「低库存规则」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 总库存高于阈值、某在售规格低于阈值的商品进入告警，`low_stock_sku_count` 正确
- [ ] 低库存规格已下架时不触发
- [ ] 规格库存为 0 时触发并计入缺货
- [ ] 规格库存缺失时 `low_stock: false`，不触发
- [ ] 规格数据不可用的商品按总库存判断，`low_stock_sku_count: null`
- [ ] headline 的新行数值与条目一致；原有两行语义不变
- [ ] 依赖旧筛选语义的服务层用例同步更新；`data-contract-v2` 覆盖新字段
- [ ] `npm test` 通过

## Comments
