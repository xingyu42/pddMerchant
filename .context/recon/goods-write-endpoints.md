# Goods Write Endpoints Recon

**日期**: 2026-05-07
**账号**: mall_id=445301049
**工具**: jshook CDP + Chrome 147
**操作商品**: goods_id=673182058048

---

## 1. 上架 (onSale)

| 维度 | 值 |
|------|-----|
| **URL** | `POST /vodka/v2/mms/pc/onSale` |
| **urlPattern** | `/vodka\/v2\/mms\/pc\/onSale/` |
| **Payload** | `{ goodsId: number, crawlerInfo: string }` |
| **crawlerInfo** | = `Anti-Content` 请求头的值（反爬签名，由 PDD 前端 SDK 生成） |
| **Response (success)** | `{ success: true, errorCode: 1000000, errorMsg: null, result: true }` |
| **Response (需审核)** | `{ success: false, errorCode: 1000002, errorMsg: "该商品上架需审核，请耐心等待", result: false }` |
| **UI 流程** | 下架商品列表 → 点击"上架" → 确认弹窗"确定上架商品？" → 点击"确认" |

## 2. 下架 (offSale)

| 维度 | 值 |
|------|-----|
| **URL** | `POST /vodka/v2/mms/pc/offSale` |
| **urlPattern** | `/vodka\/v2\/mms\/pc\/offSale/` |
| **Payload** | `{ goodsId: number, crawlerInfo: string }` |
| **crawlerInfo** | 同上 |
| **预检** | `POST /vodka/v2/mms/pc/resourceValidate` — `{ goodsIdList: [id], checkItem: ["if_in_bidding_check","if_in_goods_decoration","if_in_combine_buy"] }` |
| **Response** | `{ success: true, errorCode: 1000000, errorMsg: null, result: true }` |
| **UI 流程** | 在售商品列表 → 点击"下架" → 确认弹窗（含预估损失金额） → 点击"确认" |

## 3. 改价 (sync/edit/price)

| 维度 | 值 |
|------|-----|
| **URL** | `POST /guide-api/mms/sync/edit/price` |
| **urlPattern** | `/guide-api\/mms\/sync\/edit\/price/` |
| **Payload** | `{ goods_list: [{ goods_id, sku_info_list: [{ sku_id, price, multi_price }] }] }` |
| **Response** | `{ fail_goods_num: 0 }` — 0 则全成功 |
| **注意** | 不需要 `crawlerInfo`，仅需 Anti-Content 头 |
| **注意** | `price` = 单买价（分），`multi_price` = 拼单价（分）|
| **注意** | 支持批量 — `goods_list` 可含多个商品 |
| **来源** | JS bundle 代码分析 (`goods-list chunk:3302290`) |
| **替代** | 原端点 `/glide/v2/mms/price/adjust/adjust_in_list` 也可用，但 payload 更复杂 |

## 4. 改库存 (sync/edit/quantity)

| 维度 | 值 |
|------|-----|
| **URL** | `POST /guide-api/mms/sync/edit/quantity` |
| **urlPattern** | `/guide-api\/mms\/sync\/edit\/quantity/` |
| **Payload** | `{ goods_list: [{ goods_id, sku_info_list: [{ sku_id, quantity }] }] }` |
| **Response** | `{ fail_goods_num: 0 }` — 0 则全成功 |
| **关键** | `quantity` 是 **绝对值**，不是增量！直接设置目标库存 |
| **注意** | 不需要 `crawlerInfo`，仅需 Anti-Content 头 |
| **注意** | 支持批量 — `goods_list` 可含多个商品 |
| **来源** | JS bundle 代码分析 (`goods-list chunk:3302323`) |
| **替代** | 原端点 `/vodka/v2/mms/edit/quantity/increase` 也可用，但用增量且需要 beforeQuantity |

## 5. 改标题 (batch_edit goods_name)

| 维度 | 值 |
|------|-----|
| **URL** | `POST /guide-api/mms/goodsName/batch_edit` |
| **urlPattern** | `/guide-api\/mms\/goodsName\/batch_edit/` |
| **Payload** | `{ goods_id2_name: { "<goods_id>": "<new_title>" } }` |
| **Response** | `{ success: true, error_code: 1000000, result: null }` |
| **不需要** | `crawlerInfo`，仅需 `credentials: 'include'` |
| **支持批量** | payload 是 goods_id → name 映射 object，可同时改多个商品 |
| **真实验证** | ✅ 2026-05-08 goods_id=673182058048 "2023"→"2024" 即时生效 |
| **注意** | 商品属性不合规时静默失败（返回 success 但不生效），需确保商品属性完整 |

**Payload 示例**:
```json
{
  "goods_id2_name": {
    "673182058048": "新标题内容"
  }
}
```

**替代端点**:
- `/guide-api/mms/goodsName/batchEditByTaskType` — 任务型批量修改（关键词替换 task_type=1 / 删除关键词 task_type=2 / 添加前后缀 task_type=3），返回 `success_goods_num/fail_goods_num/fail_reason`，错误报告更明确

---

## Anti-Content / crawlerInfo 关键发现

1. **onSale/offSale** 端点需要 `crawlerInfo` 字段在 body 中（= Anti-Content 头的值）
2. **改价/改库存** 端点不需要 `crawlerInfo`，仅需要 Anti-Content 请求头
3. Anti-Content 值由 PDD 前端 SDK 生成（`5028bac9015f9ab8...` JS chunk）
4. `page.evaluate(fetch)` 方式无法自动获得 Anti-Content 签名
5. **解决方案**: 使用 page UI 操作触发（点击按钮 + 确认弹窗），而非直接 fetch 调用

## Response 命名不一致

| 端点 | 字段命名 |
|------|---------|
| onSale/offSale/改库存 | camelCase: `errorCode`, `errorMsg` |
| 改价 | snake_case: `error_code`, `error_msg` |

errorMapper 必须兼容两种：`raw.error_code ?? raw.errorCode`
