# `goodsList` 原始响应字段结构只读实测（2026-11-26）

> **采样时间**：2026-11-26 21:22–21:23（Asia/Shanghai）
> **采样方式**：经项目既有命令运行时（`executeSingle` + `listGoods`）以默认商家账号正常会话执行单次只读 `goodsList` 请求（`POST /vodka/v2/mms/query/display/mall/goodsList`，`is_onsale: 1, page: 1, size: 50, out_goods_sn_gray_flag: true`，`xhr_count: 1`），仅在内存中提取键名、类型、值域分布与脱敏数量级/对比关系，零写入、零敏感业务值落盘。
> **脱敏边界**：未记录任何 `goods_id`、`goods_name`、`out_goods_sn`、`outSkuSn`、`thumb_url`、`mall_id`、Cookie 或原始响应正文。

## 一、样本覆盖概况

- 响应外壳键：`errorCode`、`errorMsg`、`result`、`success`。
- `result` 键：`goods_list`（数组）、`sessionId`、`total`（`number`，`18`）。
- 本次采样覆盖默认账号全部在售商品：`18` 件商品、`327` 个 SKU（单商品 SKU 数 `6`–`32`）。
- 每条 `goods_list[]` 对象包含 `126` 个键；每个 `sku_list[]` 对象包含 `22` 个键。

## 二、目标字段逐项核验结论

| 核验项 | 上游精确键名 | 实测类型与分布（18 件商品 / 327 SKU） | 值域与边界语义 | 与 `.scratch/goods-list-fields/spec.md` 对齐情况 |
| --- | --- | --- | --- | --- |
| 累计销量 | `sold_quantity` | 18/18 存在，整数 `number`（`0` 占 6 件，`> 0` 占 12 件，数量级 `0`–`1e2`） | 非负整数；无其余拼写或驼峰变体 | 完全一致 |
| 近 30 天销量 | `sold_quantity_for_thirty_days` | 18/18 存在，整数 `number`（`0` 占 14 件，`> 0` 占 4 件，数量级 `0`–`1e2`） | 非负整数；精确键名为 snake_case `sold_quantity_for_thirty_days` | 完全一致 |
| 累计收藏数 | `fav_cnt` | 18/18 存在，整数 `number`（`0` 占 3 件，`> 0` 占 15 件，数量级 `0`–`1e2`） | 非负整数；精确键名为 `fav_cnt`（无 `fav_count` / `favCnt`） | 完全一致 |
| 运费模板 ID | `costTemplateId` | 18/18 存在，整数 `number`（18/18 均 `> 0`）；`cost_template_id` 全部 `undefined` | 精确键名为 camelCase `costTemplateId`；本店铺 18 件在售商品均已绑定模板，未绑定占位值（`0` vs `null`）本次未直接观测到 | 键名一致；因 `text(0)` 会返回 `"0"`，实现层建议对 `<= 0` / `'0'` / `null` / `undefined` 统一归一为 `null` |
| 创建 / 更新时间 | `created_at`、`updated_at` | 18/18 存在，10 位正整数 `number`（`created_at` 年份 `2023..2024`，`updated_at` 年份 `2025..2026`，18/18 满足 `updated_at >= created_at`） | **Unix 秒级时间戳**（10 位整数）；本样本无 `0` 或 `null`，同列表兄弟时间字段 `offline_time` 出现 `0`（3/18）且 `pre_sale_time` 全为 `0`（18/18），佐证未设置时间用 `0` 占位 | 完全一致，`toLocalDateTime()` 可直接识别 10 位秒并把 `<= 0` 转 `null` |
| 商家商品编码 | `out_goods_sn` | 18/18 存在，`string`（非空 13 件、长度 `4`–`6`；空串 `""` 5 件；`null` / `undefined` 0 件） | 未填写时上游返回空串 `""`，已填写时返回非空字符串 | 完全一致，`text()` 自动将 `""` 归为 `null` |
| 商家 SKU 编码 | `sku_list[].outSkuSn` | 327/327 存在，camelCase `outSkuSn`（`out_sku_sn` 为 0）；`string`（非空 22 个、长度 `17`；空串 `""` 305 个；`null` / `undefined` 0 个） | 未填写时上游返回空串 `""`，已填写时返回非空字符串 | 完全一致，`text()` 自动将 `""` 归为 `null` |

### 补充基线核验（供 `--with-skus` 与既有字段参考）

- `sku_list[]` 既有 4 个核心字段在 327 个 SKU 上形态稳定：
  - `skuId`：327/327 为正整数 `number`（视图侧用 `text()` 转字符串）。
  - `spec`：327/327 为非空 `string`。
  - `skuQuantity`：327/327 为非负整数 `number`（`> 0` 占 319 个，`0` 占 8 个）。
  - `isOnsale`：327/327 为布尔 `boolean`（`true` 325 个、`false` 2 个）。
- 排除/暂缓字段确认存在于上游载荷，需继续依赖白名单过滤：
  - 图片 URL：`thumb_url`、`hd_thumb_url`、`image_url`、`hd_url`、`sku_list[].skuThumbUrl`。
  - 暂缓商品级字段：`shipment_limit_second`（18/18 为正整数 `number`）、`two_pieces_discount`（18/18 为正整数 `number`）。
  - 暂缓 SKU 级字段：`normalPrice`、`groupPrice`、`activityGroupPrice`、`skuSoldQuantity`。

## 三、有活动 vs 无活动价格字段实测对照（修正历史调研记录）

> 本节实证补充并修正 [upstream-schema-2026-10.md](../../.trellis/research/archive/2026-10/10-07-domain-view-contract-v2/research/upstream-schema-2026-10.md) §3（当时因样本缺少活动商品，曾记录 `origin_sku_group_price` 与拼单价重复且语义不明）。

### 1. 数组结构核实

- 在全部 18 件商品上（无论单商品 SKU 数为 6 还是 32），`sku_group_price`、`origin_sku_group_price`、`sku_price` 均为**长度为 2 的整型数组（单位：分）**，表达商品级别的 `[min, max]` 价格区间（`array(len=2, elem=number)`）。
- 现有 `src/services/views/goods.js` 的 `priceRange()` 通过 `Math.min` / `Math.max` 提取区间，对长度为 2 的数组完全兼容。

### 2. 无活动商品 vs 有活动商品对照（11 件无活动 + 7 件有活动）

| 组别 | 样本数 | `promotion_goods` 形态 | `sku_group_price` 与 `origin_sku_group_price` 关系 | `promotion_goods.min_price / max_price` 对照 | `sku_list[].activityGroupPrice` |
| --- | --- | --- | --- | --- | --- |
| **无活动商品** | 11/18 | 显式 `null`（11/11） | 逐元素完全相等（`sku_group_price === origin_sku_group_price`，11/11） | 无 `promotion_goods` 对象 | 全部 SKU 均为 `null`（11/11 商品） |
| **有活动商品** | 7/18 | 8 键对象（7/7：`activity_id`、`activity_id_for_b`、`activity_name`、`activity_type`、`activity_url_id`、`enroll_id`、`min_price`、`max_price`） | `sku_group_price` 严格低于 `origin_sku_group_price`（全元素 `<=` 且至少一端 `<`，7/7） | `promotion_goods.min_price === min(sku_group_price)` 且 `promotion_goods.max_price === max(sku_group_price)`（7/7）；同时两端均严格低于 `origin_sku_group_price`（7/7） | 7/7 商品均含正整数 `activityGroupPrice` 的 SKU（合计 114/327 个 SKU，其余 213/327 为 `null`） |

### 3. 口径结论

- `sku_group_price` 对应 **Current Group Price（当前拼单价）**：存在生效活动时反映活动改价后的拼单区间（与 `promotion_goods.min_price..max_price` 吻合），无活动时回落到日常拼单区间。
- `origin_sku_group_price` 对应 **Daily Group Price（日常拼单价）**：在活动期间仍保持商品日常拼单基线区间，在无活动期间与 `sku_group_price` 相等。
- 上述实测关系完全支持 `spec.md` 的纯事实透出方案：视图层并行输出 `price_min_yuan / price_max_yuan` 与 `origin_price_min_yuan / origin_price_max_yuan`，由调用方自行对照 `promotion`。

## 四、对下游工单（Ticket 02 / 03）的实现提示

1. **无键名或类型偏差**：`spec.md` 所列全部上游键名与 `goodsList` 实测完全一致，无需调整映射键名。
2. **`cost_template_id` 防御性空值归约**：由于默认账号 18 件在售商品全部绑定了运费模板，未能直接观测到未绑定时的上游占位值（`0` 或 `null`）；因已绑定值为正整数 `number` 且 `src/services/views/_shared.js` 的 `text(0)` 会返回 `"0"`，Ticket 02 应在视图或服务归一处将 `0`、`'0'`、非正数与 `null`/`undefined`/空串统一转为 `null`。
3. **测试合成样本依据**：合成测试可放心将 `created_at` / `updated_at` 设为 10 位 Unix 秒、将 `out_goods_sn` / `outSkuSn` 未填写样本设为 `""`、将 `sku_group_price` / `origin_sku_group_price` 设为 2 元素分数组（无活动相等、有活动 `sku_group_price < origin_sku_group_price` 且与 `promotion_goods.min_price..max_price` 对齐）。
