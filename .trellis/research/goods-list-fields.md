# 商品列表字段扩展与 `--with-skus` 设计对齐

> **状态**：已实现（分支 `feat/goods-list-fields`，2026-11-26 完成默认账号只读实测与代码/测试/文档交付；实测采样记录见 [goods-list-fields-recon-2026-11-26.md](../../docs/research/goods-list-fields-recon-2026-11-26.md)）。跳过新建 ADR（属于常规只读白名单扩展与既有 `--with-*` 模式复用），领域术语已沉淀至 [GLOSSARY.md](../../GLOSSARY.md#goods-catalog)。

## 1. 消费定位约定（已确认规则）

- **业务查询与经营报表命令**（`orders *`、`goods *`、`promo *`、`diagnose *`）：以 AI Agent `--json` 消费为第一优先级，字段与结构设计优先服务 JSON 清晰度与上下文 Token 效率；终端直读仅保留 `headline` 速览与通用表格兜底。
- **运维与环境命令**（`init`、`login`、`doctor`、`account *`、`config *`、`daemon *`、`console *`、`shops *`）：作为人类终端直读体验优化的重点命令范围。

## 2. 确认的字段映射表（已实现）

所有空串、缺失值或非正时间戳统一归一为 `null`：

| 视图字段 | 上游字段 | 类型与转换 |
| --- | --- | --- |
| `out_goods_sn` | `out_goods_sn` | `string \| null`（`text()`） |
| `origin_price_min_yuan` / `origin_price_max_yuan` | `origin_sku_group_price` | `number \| null`（分数组取 min/max 转元，与 `price_min_yuan` / `price_max_yuan` 对称；仅输出事实区间，不派生“是否掉活动”判定字段） |
| `sold_quantity` | `sold_quantity` | `number \| null`（非负有限数） |
| `sold_quantity_30d` | `sold_quantity_for_thirty_days` | `number \| null`（非负有限数） |
| `fav_count` | `fav_cnt` | `number \| null`（非负有限数） |
| `cost_template_id` | `costTemplateId` | `string \| null`（`text()`，`<= 0` / `'0'` / 非有限数统一转 `null`，与 `goods templates` 的 `template_id` 保持字符串一致） |
| `created_at` / `updated_at` | `created_at` / `updated_at` | `string \| null`（`toLocalDateTime()` 北京时间 `YYYY-MM-DD HH:mm:ss`） |
| `skus[].out_sku_sn` | `sku_list[].outSkuSn` | `string \| null`（`text()`） |

## 3. 暂缓与排除项

- **暂缓纳入**：`shipment_limit_second`、`two_pieces_discount`（待后续确认值域与需求）；SKU 级价格（`normalPrice`、`groupPrice`、`activityGroupPrice`）与 `skuSoldQuantity` 暂不纳入。
- **维持排除**：`thumb_url`（继续沿用仓库排除商品图片 URL 约定）。

## 4. 命令与视图契约（已实现）

- **`pdd goods list`**：
  - 默认精简输出：沿用 `GOODS_VIEW_FIELDS`，省略 `skus` 键（适合 `--size 50` 批量扫描商品清单、控制上下文 Token）。
  - 新增 `--with-skus` 选项：在同一条请求内（零额外 XHR）按需展开 `skus[]`（对应 `GOODS_LIST_WITH_SKUS_ITEM_FIELDS`）。
  - 开启 `--with-skus` 时，单个 SKU 输出基础 5 字段：`sku_id`、`spec`、`out_sku_sn`、`quantity`、`on_sale`；上游缺少 `sku_list` 时输出 `skus: null`（与空数组 `[]` 区分）；`headline` 追加本页规格总数及缺规格数据的商品件数。
- **`pdd goods stock`**：
  - 继续共享 `GOODS_VIEW_FIELDS`，自动继承新增的商品级字段。
  - 在 `GOODS_STOCK_SKU_FIELDS` 中同步补上 `out_sku_sn`（其余字段保持 `sku_id`、`spec`、`quantity`、`on_sale`、`low_stock`）。

## 5. 实现前核验（已完成）

已完成默认商家账号单次只读 `goodsList` 结构采样，核验结论沉淀于 [goods-list-fields-recon-2026-11-26.md](../../docs/research/goods-list-fields-recon-2026-11-26.md)：确认 `sold_quantity` / `sold_quantity_for_thirty_days` / `fav_cnt` / `costTemplateId` / `created_at`（10 位 Unix 秒）/ `updated_at`（10 位 Unix 秒）/ `out_goods_sn`（空串表未填）/ `sku_list[].outSkuSn` 键名与类型完全吻合，且 `origin_sku_group_price` 实测为日常拼单价基线（有活动时高于 `sku_group_price`）。

## 6. 参考来源

- [GLOSSARY.md](../../GLOSSARY.md#goods-catalog)
- [upstream-schema-2026-10.md](./archive/2026-10/10-07-domain-view-contract-v2/research/upstream-schema-2026-10.md)
- [realtime-and-fee-recon-2026-11-11.md](../../docs/research/realtime-and-fee-recon-2026-11-11.md)
- [.scratch/sku-stock/spec.md](../../.scratch/sku-stock/spec.md)
