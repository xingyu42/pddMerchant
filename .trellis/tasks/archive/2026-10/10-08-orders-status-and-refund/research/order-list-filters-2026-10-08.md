# recentOrderList 过滤参数与售后字段采样（2026-10-08，真实账号只读）

采样方式：临时脚本（系统临时目录，已删除）复用 `withCommand` 鉴权流程，调用 `ORDER_LIST` 并覆盖 `orderType` / `afterSaleType`；窗口 60 天、`pageSize=50`。只输出计数、`order_status_str` 分布、含 status/refund/after/sale 的字段值域；未持久化订单号、金额、收件人信息。

同时刻 `statisticWithType`：`unship=8, unship12h=0, delay=0, unreceive=20`。

## 1. `orderType`（发货状态 Tab）

| orderType | afterSaleType | total | 状态分布 | 佐证 |
|---|---|---|---|---|
| 0 | 1 | 35 | 已发货待收货 20 / 已收货 7 / 待发货 8 | = 1+2+3 之和 |
| 1 | 1 | 8 | 待发货 8 | = `unship` 8 |
| 2 | 1 | 20 | 已发货，待收货 20 | = `unreceive` 20 |
| 3 | 1 | 7 | 已收货 7 | |
| 4 / 5 | 1 | 0 | — | 语义未知，不暴露 |

结论（高置信，计数与独立统计接口吻合）：0=全部，1=待发货，2=已发货待收货，3=已收货。现默认 `orderType: 2` 即「已发货待收货」Tab。

## 2. `afterSaleType`（售后过滤）

| orderType | afterSaleType | total | 状态分布 |
|---|---|---|---|
| 0 | 1 | 35 | 仅无售后订单（`after_sales_status` 35/35 为 null） |
| 0 | 0 | 53 | 已发货待收货 24 / 已收货 7 / 已发货退款成功 2 / 待发货 8 / 未发货退款成功 7 / 已取消 2（首页 50 条） |
| 0 | -1 | 53 | 与 0 完全一致 |
| 0 | 2 | 4 | 已发货，待收货 4（`after_sales_status` 10×3、11×1） |
| 0 | 3 | 0 | — |

结论：1=仅无售后，0/-1=不过滤，2=售后处理中。现默认 `afterSaleType: 1` 会在请求层排除全部售后/退款/取消订单 → 本地退款统计在请求层就被清零。

## 3. 售后相关字段值域（orderType=0, afterSaleType=0，50 条）

| 字段 | 值域 | 对应关系 |
|---|---|---|
| `after_sales_status` | null×37、5×9、10×3、11×1 | 5 ↔ 「…退款成功」9/9；10/11 ↔ afterSaleType=2 的 4/4 |
| `order_status_str` | 含「已发货，退款成功」2、「未发货，退款成功」7、「已取消」2 | |
| `pay_status` | 2×39、4×9、0×2 | 4 ↔ 退款成功 9/9；0 ↔ 已取消 2/2 |
| `order_status` | 1×48、2×2 | 2 ↔ 已取消 |
| `fulfillmentStatus` | 1×8、2×24、4×7、31×7、32×2、null×2 | 31 ↔ 未发货退款成功；32 ↔ 已发货退款成功 |

不存在的字段：`refund_status`、`refundStatus`、`after_sale_type`、`afterSaleType`（`computeOrderStats` 当前依赖的四个字段在真实数据中全部缺失）。

`after_sales_status` 标签置信度：
- `5` = 退款成功：高（三个独立字段一致，9/9）
- `10` / `11` = 售后处理中：中（与服务端过滤 afterSaleType=2 4/4 吻合；10 与 11 的子类区别无证据）

## 4. 其他发现

- `pageSize=100` 被上游拒绝：`E_BUSINESS 单页数据量过大或非法`；`50` 正常。`orders list --size` 当前未校验上限（范围外，另行处理）。
- 「已取消」订单 `pay_status=0`（未支付），`promise_shipping_time` 为 null。
