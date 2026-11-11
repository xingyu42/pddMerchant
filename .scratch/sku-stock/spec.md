# PRD：SKU 级库存查询（`goods stock`）

Status: ready-for-agent

来源：GitHub #3「没有 SKU 级库存查询，改库存只能盲改」

## Problem Statement

商家的一个商品通常有多个规格。`goods stock` 只按商品总库存筛低库存：总库存充足、但某个规格快卖断时，告警不会出现。`goods update stock --sku-id` 能改单个规格的库存，可是没有任何命令返回在售规格的 SKU ID、规格名和规格库存。商家不知道 SKU ID，就没法只补某一档，只能盲改或回网页查。

上游商品列表其实已经带了每个规格的 `skuId`、`spec`、`skuQuantity`、`isOnsale`，只是商品端点的 normalize 只保留了商品级 `quantity`，规格数组被丢弃。

## Solution

`goods stock` 输出 SKU 明细，并按规格库存判断低库存：

- 每个告警商品带 `skus` 数组，列出该商品的全部规格：`sku_id`、`spec`、`quantity`、`on_sale`、`low_stock`。
- 商品进入告警列表的条件：商品总库存 ≤ 阈值，**或**任一在售规格库存 ≤ 阈值。已下架规格照常列出，不触发告警。
- 每个告警商品增加 `low_stock_sku_count`（库存 ≤ 阈值的在售规格数）。
- headline 增加规格层面的事实：触发告警的规格数，以及因规格库存触发、总库存高于阈值的商品数。

拿到 `sku_id` 后，商家直接用现有的 `goods update stock --goods-id <id> --sku-id <sku>` 补那一档。

## User Stories

1. 作为商家，我想在库存告警里看到每个规格的库存，以便知道具体哪一档快卖断。
2. 作为商家，我希望总库存充足但某个规格快卖断的商品也出现在告警里，以便及时补货。
3. 作为商家，我想看到每个规格的 SKU ID，以便直接传给 `goods update stock --sku-id`。
4. 作为商家，我想看到规格名，以便确认 SKU ID 对应的是哪一档（颜色 / 尺码等）。
5. 作为商家，我想知道每个规格是否在售，以便忽略已下架规格。
6. 作为商家，我希望已下架规格的低库存不触发告警，以便告警只反映真实会卖断的规格。
7. 作为商家，我想直接看出哪些规格低于阈值，以便不必自己逐个和阈值比较。
8. 作为商家，我想看到每个商品有几个规格低于阈值，以便按严重程度排序处理。
9. 作为商家，我想在 headline 里看到本页共有多少个规格低于阈值，以便快速判断补货工作量。
10. 作为商家，我想在 headline 里看到有多少商品是因为规格库存才进入告警的，以便理解告警和以前的差别。
11. 作为商家，我希望 `--threshold` 同时作用于商品总库存和规格库存，以便只用一个阈值。
12. 作为商家，我希望 `--page` / `--size` 的分页行为不变，以便现有脚本继续可用。
13. 作为商家，我希望某个规格的库存值缺失时显示 `null`，并且不被当作缺货，以便不出现误报。
14. 作为商家，我希望上游某个商品完全没有规格数据时，告警按总库存照常工作，并明确显示规格数据缺失，以便知道这次没有做规格层面的判断。
15. 作为商家，我希望库存为 0 的在售规格算作缺货并计入告警，以便最紧急的补货不被漏掉。
16. 作为商家，我希望查库存不需要调用任何写接口，以便放心在自动化流程里频繁运行。
17. 作为商家，我希望人类可读模式下也能看到规格明细，以便不开 `--json` 也能操作。
18. 作为维护者，我希望规格数据走白名单投影，以便上游给 SKU 加字段不影响输出。
19. 作为维护者，我希望 `goods list`、`goods segment` 等共用商品端点的命令输出不变，以便这次改动只影响 `goods stock`。

## Implementation Decisions

- **商品端点 normalize**：每个商品额外投影规格数组，只保留 `skuId`、`spec`、`skuQuantity`、`isOnsale` 四项。`sku_list` 缺失或不是数组时，该商品的规格记为"不可用"（与"零个规格"区分），不抛 shape 错误；单个规格的库存值不是有限非负数时记为缺失。商品级 `quantity` 的现有校验不变。
- **服务层商品记录**：携带规格数组，字段归一为 snake_case（`sku_id`、`spec`、`quantity`、`on_sale`）。`goods list`、`goods segment` 等其他命令的视图是白名单投影，不受影响。
- **低库存规则**（服务层）：
  - 规格低库存 = 在售且库存为有限数且 ≤ 阈值。
  - 商品进入告警 = 商品总库存 ≤ 阈值，或至少一个规格低库存。
  - 库存缺失的规格不算低库存；`on_sale` 缺失的规格按"未知"处理，不触发告警。
- **`goods stock` 条目视图**：在现有商品视图字段之后增加 `low_stock_sku_count` 和 `skus`。规格数据不可用时 `skus` 为 `null`、`low_stock_sku_count` 为 `null`。规格视图字段为 `sku_id`（字符串）、`spec`、`quantity`、`on_sale`（布尔，缺失为 `null`）、`low_stock`（布尔）。`goods stock` 使用独立的条目字段列表和规格字段列表，`goods list` 的商品视图字段列表不变。
- **headline**：保留现有两行；新增一行给出本页低库存规格总数，以及"总库存高于阈值、因规格触发"的商品数。存在规格数据不可用的商品时再加一行说明件数。
- **命令选项**：不新增选项，`--threshold` 同时作用于商品与规格。
- `goods update stock` 不做任何改动。

## Testing Decisions

- 好的测试只断言外部行为：CLI 在 fixture adapter 下输出的 envelope `data` 和 headline，不断言 normalize 的中间结构。
- 主接缝：用 `PDD_TEST_ADAPTER=fixture` 运行 `goods stock`，fixture 由 `createUpstreamGoods` 扩展出带 `sku_list` 的合成商品，覆盖：
  - 总库存高于阈值、某个在售规格低于阈值 → 商品进入告警，`low_stock_sku_count` 正确；
  - 低库存规格已下架 → 不触发；
  - 规格库存为 0 → 触发且计入缺货；
  - 规格库存缺失 → `quantity: null`、`low_stock: false`；
  - 商品缺 `sku_list` → 按总库存判断，`skus: null`，headline 说明规格数据缺失；
  - 上游规格对象带多余字段 → 输出不变。
- `data-contract-v2` 中 `goods.stock` 的实体字段改为 `goods stock` 专用的条目字段和 `items[].skus[]` 规格字段；`goods.list` 仍断言原商品视图字段集，用来确认它没有变化。
- 同步更新 `goods-list-contract` 中依赖 `getGoodsStockView` 旧筛选语义的用例。
- Prior art：`test/contract/data-contract-v2.test.js`（`lowStockFixtures`），`test/e2e/business-contract.e2e.test.js`，`test/services/goods-list-contract.test.js`，`test/e2e/goods-receipt.e2e.test.js`（SKU 级输出的 e2e 写法）。

## Out of Scope

- `goods list` 输出规格明细。
- 按 `--goods-id` 查询单个商品的规格（商品列表接口没有商品 ID 筛选参数）。
- 修改 `goods update stock` 或批量改库存。
- 修复 `PDD_DEBUG_RAW` 在已投影视图上看不到原始载荷的问题。
- 规格销量、库存周转天数等派生指标。

## Further Notes

- `sku_list` 的字段名（`skuId`、`spec`、`skuQuantity`、`isOnsale`）来自 issue 报告人对真实响应的观察，仓库中没有记录过的上游样本，现有 `createUpstreamGoods` 也不带 `sku_list`。实现时按这四个字段构造合成 fixture；`isOnsale` 的取值形式（布尔或 0/1）需要在真实账号只读冒烟中确认，冒烟前先确认范围。
- `skuQuantity` 是否为可售库存（与 `goods update stock` 写入的口径一致）同样待冒烟确认；确认前 spec 按"规格库存"描述，不额外解释口径。
- 店透视 bundle 里定义了 `/vodka/v2/mms/query/sku/info`，但没有找到调用点，参数和响应都未知（`docs/research/diantoushi-region-realtime-2026-11-11.md` 第三节）。冒烟时如果发现 `goods.list` 的 `sku_list` 不完整，可以把它当作备选来源。
