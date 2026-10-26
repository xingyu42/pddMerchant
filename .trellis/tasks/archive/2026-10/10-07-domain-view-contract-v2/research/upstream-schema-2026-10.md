# 上游字段采样结论（2026-10-07，真实账号只读）

采样方式：`PDD_DEBUG_RAW=1` + stdout `data` 结构提取（脚本仅输出键路径 / 类型 / 枚举值域 / 数量级）。未持久化任何订单号、商品 ID、金额值、收件人信息；原始输出位于系统临时目录，提取后已删除。

覆盖：`orders list`（7 天 20 条、60 天 22 条）、`orders detail`（1 条）、`orders stats`、`goods list`（20 条）、`goods templates`、`promo roi`（店铺无投放，全部为 0）。

## 1. 订单（`recentOrderList.pageItems[]` / `orderDetail`）

- 每条订单约 **150 个上游字段**（camelCase 与 snake_case 混用），绝大多数为平台内部开关/灰度标记。
- **状态**：上游直接提供中文标签 `order_status_str`（样本值 `"已发货，待收货"`），数字码 `order_status` 样本中为 `1`。→ 视图使用 `order_status_str`，缺失时回退 `未知(<order_status>)`。不自建状态码表。
- **金额单位 = 分（高置信）**：所有金额为整数；`goods_price × goods_number == goods_amount` 22/22 成立；`goods_amount − (merchant_discount + platform_discount + duoduo_pay_discount) + shipping_amount == order_amount` 20/22 成立（差异来自其他补贴字段）。数量级 1e3（数十元商品）。
- **时间 = unix 秒**（10 位）；`payment_start_time`/`receive_time` 等可能为 `0` 表示未发生 → 视图输出 `null`。

### 白名单映射（列表项 → `OrderView`）

| 视图键 | 上游键 | 说明 |
|---|---|---|
| `order_sn` | `order_sn` | |
| `status` | `order_status_str` | 回退 `未知(order_status)` |
| `goods_id` | `goods_id` | 转 string |
| `goods_name` | `goods_name` | |
| `spec` | `spec` | SKU 规格文字 |
| `quantity` | `goods_number` | |
| `unit_price_yuan` | `goods_price` | 分→元 |
| `goods_amount_yuan` | `goods_amount` | 分→元 |
| `merchant_discount_yuan` | `merchant_discount` | 分→元 |
| `platform_discount_yuan` | `platform_discount` | 分→元 |
| `shipping_fee_yuan` | `shipping_amount` | 分→元 |
| `paid_amount_yuan` | `order_amount` | 分→元，买家实付 |
| `ordered_at` | `order_time` | |
| `ship_deadline_at` | `promise_shipping_time` | 0 → null |
| `shipped_at` | `shipping_time` | 0 → null |
| `express_company` | `waybillDTOList[0].shippingName`（详情为 `shipping_name`） | |
| `tracking_number` | `tracking_number` | |
| `buyer_memo` | `buyer_memo` | 空串 → null |
| `after_sales_status` | `after_sales_status` | 样本全为 null；非 null 时输出 `未知(<code>)`（无值域证据） |

详情（`OrderDetailView`）= 列表视图 + `paid_at`（`pay_time`）、`grouped_at`（`group_time`）、`received_at`（`receive_time`，0 → null）、`invoice_status`（`invoice_apply_status_str`）。

**排除（D5 PII）**：`receive_name`、`receive_mobile`、`contactMobile`、`nickname`、`province_*`/`city_*`/`district_*`、`consumerAddress`、`refundAddressInfo.*`（商家退货地址与联系电话）、`waybillDTOList[].shippingPhone`、`deliveryManPhone`。

## 2. 订单统计（`statisticWithType`）

样本：`unship=4, unship12h=2, delay=0, unreceive=22`；同期 60 天列表 22 条全为「已发货，待收货」。

| 视图键 | 上游键 | 含义 | 置信度 |
|---|---|---|---|
| `pending_ship_count` | `unship` | 待发货 | 高 |
| `pending_ship_over_12h_count` | `unship12h` | 待发货中超过 12 小时（≤ unship，样本 2 ≤ 4） | 中（单一来源 + 子集关系） |
| `delayed_ship_count` | `delay` | 已超承诺时限的延迟发货 | 中（单一来源） |
| `pending_receipt_count` | `unreceive` | 已发货待收货 | 高（与列表 22 条完全吻合） |

## 3. 商品（`goods_list[]`，经现有 `toGoodsRecord`）

- `sku_price` / `sku_group_price` / `origin_sku_group_price` 为 **number 数组**（多 SKU），分。→ 视图输出区间：`price_min_yuan` / `price_max_yuan`（拼单价 `sku_group_price`），`single_price_min_yuan` / `single_price_max_yuan`（单买价 `sku_price`）；`origin_sku_group_price` 不输出（与拼单价重复且语义不明）。
- `promotion`：上游 8 字段（`min_price`、`max_price`、`activity_id`、`activity_type` 样本 3/101、`activity_name`、`enroll_id`、`activity_url_id`、`activity_id_for_b`）。→ 视图 `promotion: { name, price_min_yuan, price_max_yuan } | null`，其余丢弃（`activity_type` 无标签证据）。
- `goods_id`、`mall_id` 为 number → 转 string。

## 4. 运费模板

`{ id: number, name: string, free_province_need: null }`。→ `{ template_id: string, name }`，`free_province_need` 无值域证据，丢弃。

## 5. 推广

- 本店铺无投放，所有金额为 0，未能观测 MoneyVO。
- 既有证据：`07-05-promo-poseidon-adapt/implement.md:94` 记录 `{ "unit": "YUAN", "value": "500", "unitCode": 1 }`。
- → `moneyToNumber` 改为识别 `unit`：`YUAN` 原值；`FEN` ÷100；其他非空未知单位 → `null` 并追加 `meta.warnings`；无 `unit` 的裸数字按元处理（现有行为）。

## 6. 范围外发现（不在本任务修复）

- （已由 10-08-orders-status-and-refund 处理：默认改为全部订单并提供 `--status`）`orders list` 默认 `orderType: 2`（`src/adapter/endpoints/orders.js` `ORDER_LIST.buildPayload`）：样本中 4 笔待发货订单不在列表内，列表只返回已发货订单。建议另开任务确认 `orderType` 语义并提供 `--status` 过滤。
- （已由 10-08-orders-status-and-refund 处理：退款口径改为 `after_sales_status`，字段缺失输出 null）退款识别字段可能不存在：`computeOrderStats` 依赖 `refund_status` / `refundStatus` / `after_sale_type` / `afterSaleType`，采样中均未出现（仅见 `after_sales_status`，且样本全为 null）。线上 `refund_count` / `refund_rate_pct` 与 funnel `fulfillment_rate` 可能恒为 0 / 100，属字段缺失而非真实统计。建议另开任务基于 `after_sales_status` 重建退款口径（需有售后样本）。
- （已在 Phase 2 顺带修复）`readQuantity` 未读取上游件数字段 `goods_number`，导致多件订单按 1 件计入销量统计（inventory / segment）。
- （已在 Phase 4 验收时修复）`ORDER_STATS` 缺少 `nav`：diagnose 在新开空白页并发采集订单统计时报 `page API client unavailable`（仅 debug 日志可见），导致 `diagnose orders/shop` 订单维度恒为「数据不完整」。补 `nav: { url: PDD_HOME }` 后真实账号验证恢复；回归测试见 `test/adapter/orders-contract.test.js`。
