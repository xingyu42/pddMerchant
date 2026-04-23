# V0.2 #2 Goods-ID Endpoint Recon

**执行时间**：2026-04-24
**账号**：`mall_id=445301049`（绘梦童坊，同 V0.1）
**工具**：`scripts/v0-2-goods-id-recon.mjs` + 手工 playwright 抓取脚本
**目标**：找出返回**非 null `goods_id`** 的 goods 列表 endpoint，替代或补充 `vodka/v2/mms/query/display/mall/goodsList`

---

## 🚨 顶层结论：recon 受阻于账号风控

**关键发现**：recon 过程中 `vodka/v2/mms/query/display/mall/goodsList` **实际响应是 rate-limit 业务错误**：

```json
{"error_msg":"操作太过频繁，请稍后再试！","result":{"verifyAuthToken":"TuYhog3J_Sub6__HB79bfAe85c5c0972ac8fdb2"},"error_code":54001}
```

**这改变了对 V0.1 结论的理解**：

| V0.1 real-call verification §3.2 记录 | 重新解读 |
|---|---|
| `vodka/goodsList` 返回 `goods_id: null` 全部 | **可能是风控降级响应而非 endpoint 真实行为** — 账号 445301049 从 2026-04-24 起持续风控（orderDetail 已记录），同账号 goodsList 也撞上同一限流 |
| D16 per-item 策略在生产数据下失效 | **可能是基于错误样本做出的结论** — 需要在非风控态下重新验证 goodsList 的原生 goods_id 行为 |

**影响**：V0.1 的 D16 修正（per-item → global fallback + `matched_by='mixed'`）在 V0.2 #2 正式 recon 完成前**不应被移除**；其"生产常态"定性需要存疑标注。

---

## 📊 候选 endpoint 扫描结果

从 `/goods/goods_list/v2` 页面被动抓包（无用户交互，15s 捕获窗口），筛选 mms/yangkeduo 域内 JSON 响应，共捕获 50 个 goods/vodka 相关 URL，其中 13 个 JSON 响应直接被检查了 body。

### 候选响应体摘要

| URL | 响应状态 | goods_id 字段 | 评估 |
|-----|---------|---------------|------|
| `/vodka/v2/mms/query/display/mall/goodsList` | ❌ 54001 风控 | 无法判定 | V0.1 当前唯一使用的 endpoint；今日风控中 |
| `/glide/v2/mms/addProperties/goodsList` | ✅ 但 `{total:0, list:[]}` | 空列表，无法判定 | **潜在强候选**：命名相近但不同 namespace；被动加载返空，需进一步 recon POST payload |
| `/plutus/api/plutus/bin/goods/query` | ✅ 但 `{total:0, data:[]}` | 空列表，无法判定 | **潜在候选**：`bin/goods` 语义不清（商品池？仓库？），需 recon |
| `/vodka/v2/mms/inventory/alert/query?type=0/1` | ✅ `{mallId, alertNum, isDeleted}` | 仅聚合计数，**无 goods 列表** | 不适用 — 库存告警计数汇总 |
| `/vodka/v2/mms/query/display/mall_goods/count` | （未抓到 body） | N/A | 从命名推测：仅返回计数 |
| `/glide/v2/mms/addProperties/goods/count` | ✅ `result: 43` | 纯数字 | 不适用 — 账号有 43 件商品的计数 |
| `/opportunity-goods/chance-goods/new_rec_goods_list` | ✅ 非空含 `chance_id` | **有 `chance_id` / `mall_id` 而非 `goods_id`** | 不适用 — "机会商品"全平台推荐池，非本店铺 SKU |
| `/witcher/api/goods-list-buttons` | ✅ 按钮配置 | 无 | 不适用 |
| `/vodka/v2/mms/query/display/sales/strategy/v2` | ✅ 运营提示 banner | 无 goods 列表 | 不适用 |

### 最终真正候选（2 个）

| Endpoint | 评估 |
|----------|------|
| **`/glide/v2/mms/addProperties/goodsList`** | 命名最接近现有 `vodka/goodsList`，不同 namespace；被动触发返回空，需深入 recon 其 POST payload 结构 |
| **`/plutus/api/plutus/bin/goods/query`** | 语义不明确，可能是特定场景（商品池/仓库/批量操作目标集），需 recon 其触发方式 |

---

## 🛑 阻塞原因

1. **账号风控**：继续对 `vodka/goodsList` 真实调用会加重风控，且会污染 real-call 回归数据
2. **候选 endpoint 被动捕获为空**：`glide/addProperties/goodsList` 与 `plutus/bin/goods/query` 需要主动触发（传入合适 POST payload 或通过特定页面 UI 交互）；当前 recon 脚本仅被动抓取页面初始化 XHR，无 payload 构造能力
3. **无备用账号**：仓库只有 445301049 一套 auth-state，换账号验证需重新 `pdd login`

---

## 📋 建议决策

### 短期（V0.2 收尾）

**暂停 #2 推进**。证据不足以修改 D16 策略：

- V0.1 "goodsList goods_id=null" 结论**可能本身就是风控样本**，与假设前提"endpoint 真实返回 null"不等价
- 现有 V0.1 D16 global fallback + `matched_by='mixed'` 防御行为**不会误分类**：两种情况（真 null / 风控降级）都走 goods_name 路径保底正确
- per-item 策略升级 ROI 无法量化 — 需先验证 endpoint 非风控态下原生行为

### 等风控解除后（V0.2.1 或 V0.3 recon）

1. **重新验证 `vodka/goodsList` 原生 goods_id 行为**：账号刚解封时立即跑 `pdd goods list --size 50`，看返回是否仍全 null
2. **深入 recon 两个候选 endpoint**：
   - 在 `/goods/goods_list/v2` 页面 UI 点击不同 tab / 触发商品详情 / 批量编辑，观察 `glide/addProperties/goodsList` 和 `plutus/bin/goods/query` 是否被触发并返非空
   - 如果触发，记录其 POST payload + response shape
3. **（可选）跨账号对比**：找一个未风控账号跑对比，观察 goods_id 字段是否账号相关

### 中期（V0.3+）

若始终找不到含 goods_id 的 endpoint：
- **接受 D16 现状**：global fallback + `matched_by='mixed'` 作为最终行为；删除"V0.2 待升级 per-item"的注释，在 design 档里标注"受限于 PDD goods.list API 字段异构，per-item 策略不可用"
- 或在 `orders.list` → `goods` 侧建立 ID 映射（用 orders 里真实的 goods_id 反推 inventory 的 SKU 映射）— 但这只覆盖有订单的 SKU；滞销 SKU 本就无订单，此路不通

---

## 🔍 附录：捕获的完整 goods/vodka 相关 URL 清单

来自 `/goods/goods_list/v2` 页面被动抓包（15s 窗口，50 个 goods/vodka 相关请求）：

```
/link/api/follow/price/high_price_copy_goods/sidebar/check
/link/api/follow/price/marketing_activity/high_price_goods/sidebar/check
/mms-gateway/commission/isMallHasCommissionGoods
/api/price/mariana/goodsPrice/showEntry
/rivendell/api/anomalyGoods/queryMallIsInGray
/vodka/v2/mms/newStyleGoods/gray/queryNewStyleGoodsGray
/mille/mms/reseller/goods/sidebarShowable
/plutus/api/plutus/bin/goods/query                    ← 候选（空）
/vodka/v2/mms/common/query/status
/vodka/v2/mms/inventory/alert/query?type=0
/vodka/v2/mms/inventory/alert/query?type=1
/witcher/api/goods-list-buttons?mallId=445301049
/cambridge/api/xinjiangChanceGoods/mall/inWhitelist
/glide/v2/mms/addProperties/goodsList                 ← 候选（空）
/vodka/v2/mms/gray/status
/vodka/v2/mms/gray/status/v2
/vodka/v2/mms/cat1List
/vodka/v2/mms/query/display/mall_goods/count
/opportunity-goods/chance-goods/new_rec_goods_list
/vodka/v2/mms/query/display/goods_copyed/is_exist
/vodka/v2/mms/query/display/mall/goodsList            ← V0.1 现用 + 今日 54001 风控
/glide/v2/mms/addProperties/goods/count
/vodka/v2/mms/query/display/sales/strategy/v2
```

---

## 📝 recon 脚本说明

`scripts/v0-2-goods-id-recon.mjs` 可在风控解除后复用：

```bash
# 默认扫描 7 个常见 goods 页面
node scripts/v0-2-goods-id-recon.mjs

# 自定义页面列表
node scripts/v0-2-goods-id-recon.mjs --pages https://mms.pinduoduo.com/goods/goods_list/v2

# 有头浏览器 + 详细日志
node scripts/v0-2-goods-id-recon.mjs --headed --verbose
```

脚本特性：

- 扩展识别 13 种 goods_id key 变体（`goodsID` / `productId` / `mall_goods_id` / 等）
- 同时统计 `goods_name` 系字段命中（即使无 id 也能识别 goods-bearing endpoint）
- 自动 dedup URL + 按 non-null goods_id 降序排序
- 遇 redirect 时警告（如本次 `/goods/goods_list/v2 → /goods/goods_list`）
- 输出 markdown 报表到本文件路径
