# V0.1 Endpoints Recon

**账号**：`mall_id = 445301049`（单店铺，未开通多多进宝 / 未开通 SYCM）
**抓包环境**：jshook CDP + Next.js PDD mms（Chrome 147.0.7727.102）
**抓包时刻**：2026-04-23
**recon 范围**：tasks.md Section 0 (0.2 ~ 0.5)

---

## 1. Mall Context 来源（Task 0.5）

### 1.1 State 层（V0 原 probe 路径全部过时，需扩展）

当前 PDD mms 采用 **Next.js**（`__NEXT_DATA__`）+ 业务命名空间 `__mms`。V0 `mall-switcher.js:5-22` 配置的 `__PRELOADED_STATE__` / `__INITIAL_STATE__` **在新版后台不存在**。

Canonical state paths（按读取优先级）：

| 路径 | 字段名 | 类型 | 示例值 |
|---|---|---|---|
| `window.__mms.user.userInfo._userInfo.mall_id` | `mall_id` | number | 445301049 |
| `window.__mms.user.userInfo._userInfo.mall.mall_id` | 同上嵌套 | number | 445301049 |
| `window.__NEXT_DATA__.props.userInfo.mall_id` | `mall_id` | number | 445301049 |
| `window.__NEXT_DATA__.props.user.mallId` | `mallId` | number | 445301049 |
| `window.__NEXT_DATA__.props.pageProps.coreData.extra.mallId` | `mallId` | number | 445301049 |
| `localStorage.new_userinfo`（JSON 内字段 `mall_id`） | `mall_id` | number | 445301049 |

**推荐 V0.1 state probe 扩展**（保持向后兼容）：
```js
const CURRENT_STATE_PATHS = [
  ['__mms', 'user', 'userInfo', '_userInfo', 'mall_id'],     // 新增 #1
  ['__mms', 'user', 'userInfo', '_userInfo', 'mall', 'mall_id'],
  ['__NEXT_DATA__', 'props', 'userInfo', 'mall_id'],         // 新增 #2
  ['__NEXT_DATA__', 'props', 'user', 'mallId'],
  ['__NEXT_DATA__', 'props', 'pageProps', 'coreData', 'extra', 'mallId'],
  // 以下 V0 原有路径保留（向后兼容旧版后台）
  ['__PRELOADED_STATE__', 'mall', 'currentMallId'],
  ['__PRELOADED_STATE__', 'mall', 'mallId'],
  ['__PRELOADED_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'mall', 'currentMallId'],
  ['__INITIAL_STATE__', 'mall', 'mallId'],
  ['__INITIAL_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'account', 'mallId'],
];
```

### 1.2 XHR Response Body 层（Task 0.5 canonical mall_id 路径）

| 维度 | 值 |
|---|---|
| **典型 endpoint** | `POST https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList` |
| **body path** | `$.result.goods_list[i].mall_id` |
| **命名约定** | `mall_id`（snake_case，值类型 number） |
| **触发条件** | 导航 `/goods/goods_list` 页面自动触发（初次 + 每次刷新） |
| **与 V0 fixture 一致性** | ✅ `test/fixtures/endpoints/goods.list.json` 同 shape |

**D7 handler 递归搜索语义成立**：PDD 业务 XHR 的 `mall_id` 出现在 `result.goods_list[i]` 下，递归搜索首个 `mall_id`/`mallId`/`currentMallId` 可命中。

**⚠️ orders 类 XHR 不含 mall_id**：`POST /mangkhut/mms/recentOrderList` 响应 `result.pageItems[i]` 无 `mall_id` 字段（orders 页的 xhr probe 会 miss —— 可接受，state 层已覆盖）。

### 1.3 单店铺账号的 DOM probe 不可用
- 本账号 `mall_id=445301049` 为单店铺，无 mall-switcher UI（`[data-testid="mall-switcher"]` 全部找不到）
- D7 的 DOM probe 在此账号永远落空 —— 符合预期，xhr+state probe 已足够

---

## 2. ORDER_DETAIL Endpoint（Task 0.3）

| 维度 | 值 |
|---|---|
| **URL** | `POST https://mms.pinduoduo.com/mangkhut/mms/orderDetail` |
| **Content-Type** | `application/json` |
| **Request body** | `{ "order_sn": "<string>", "source": "MMS" }` |
| **order_sn 示例** | `260422-461944921680776` |
| **order_sn 必填** | ✅ 省略时返 `error_code=1000` / `error_msg="订单号不能为空"` |
| **Response envelope (error)** | `{ "error_code": <number>, "error_msg": <string>, "result": <obj?> }` (**snake_case**) |
| **Rate limit** | `error_code=54001` + `result.verifyAuthToken` |
| **Response envelope (success)** | ⚠️ 未抓到（账号触发 rate limit；见下方 recon blocker） |

### D2 结论：**D2.b trigger-based** 模式

Endpoint 是 **固定 URL + POST body 参数**，既非 D2.a 动态 URL，也非纯 GET + path param：

```js
// src/adapter/endpoints/orders.js
export const ORDER_DETAIL = {
  name: 'orders.detail',
  urlPattern: /mangkhut\/mms\/orderDetail/,
  nav: { url: (params, ctx) => `https://mms.pinduoduo.com/orders/list` },  // 任意合法 mms 页
  trigger: async (page, params) => {
    await page.evaluate(({ order_sn, source }) => {
      return fetch('/mangkhut/mms/orderDetail', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_sn, source: source || 'MMS' }),
      });
    }, params);
  },
  requiredTrigger: true,  // 必须 trigger，否则 collector 会等不到
  errorMapper: (raw) => {
    if (raw?.error_code === 1000) return { code: 'E_USAGE', message: raw.error_msg };
    if (raw?.error_code === 54001) return { code: 'E_RATE_LIMIT', message: raw.error_msg };
    if (raw?.error_code && raw?.error_code !== 0) return { code: 'E_BUSINESS', message: raw.error_msg };
    return null;
  },
  // normalize / isSuccess：response shape 未抓到，先按 list item 推导，V0.1 首次真实调用时补全
};
```

### ⚠️ Recon blocker: success response shape 未抓到
- 本次抓包触发 rate limit（error_code=54001），无法得到 `result` 字段结构
- V0.1 实施建议：先按 `ORDER_LIST pageItems[0]` shape 假设 detail 是 list item 的超集（加物流/售后/买家地址等），V0.1 首次真实调用时 console.log 响应并回填 recon 文档

---

## 3. ORDER_LIST shape（Task 0.3 附带 — 影响 D10）

这部分原本是 ORDER_DETAIL recon 的副产物，但对 D10 extractor 和 D4 stale 识别有直接影响。

| 维度 | 值 |
|---|---|
| **URL** | `POST https://mms.pinduoduo.com/mangkhut/mms/recentOrderList` |
| **Request body 示例** | `{"orderType":1,"afterSaleType":1,"remarkStatus":-1,"urgeShippingStatus":-1,"groupStartTime":1769156176,"groupEndTime":1776932176,"pageNumber":1,"pageSize":20,"sortType":10,"mobile":""}` |
| **Response envelope** | `{ success: true, errorCode: 0, errorMsg: "成功", result: {...} }` (**camelCase** — 与 orderDetail 的 snake_case 命名不一致！) |
| **分页总数字段** | `result.totalItemNum` (number) |
| **分页数据字段** | `result.pageItems[]` |
| **Shape** | **Flat**（顶层即 goods 字段，无 `items[]` 嵌套） |

**每条 order 的关键字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `order_sn` | string | "260422-461944921680776" |
| **`goods_id`** | **number** | **真实 API 含 goods_id**（732191698596）—— 与 V0 fixture `orders.list.json` 的假设不同（fixture 无 goods_id） |
| `goods_name` | string | "夏季新款男童..." |
| `goods_number` | number | 商品数量（quantity 语义） |
| `goods_price` | number | 单价（分） |
| `order_amount` | number | 订单总额（分） |
| `out_goods_sn` | string | 商家外部编号 |
| `spec` | string | 规格描述 "红色-咸蛋超人(无亮灯包边),90" |
| `mall_id` | — | **不存在**（orders 端点不携带 mall_id） |

### 对 D4 / D10 的影响

**D10 extractor** 简化为：
```js
function extractItems(order) {
  if (Array.isArray(order.items)) return order.items.map(normalize);  // nested, 保留为未来真实 orderDetail 可能形态
  // flat shape (现实 orders.list 真实形态)
  return [{
    goods_id: order.goods_id ?? null,
    goods_name: String(order.goods_name ?? ''),
    quantity: Number(order.goods_number ?? order.goods_quantity ?? 1),
  }];
}
```

**D4 决策重评**：
- Proposal 原文："V0.1 按归一化后的 `goods_name` 精确匹配；V0.2 待 ORDER_DETAIL 真实字段后切换到 `goods_id`"
- **Recon 修正**：真实 orders.list **已有 goods_id**，V0.1 可以**直接用 goods_id** 做匹配键
- **新 D4 策略**：优先 `goods_id`（精确），fallback `normalize(goods_name)`（mock fixture 向后兼容）
- `ambiguous_groups` 策略保留，但真实场景几乎不会触发（goods_id 唯一）

### 混合命名一致性

同一 mangkhut 域：
- `recentOrderList` → `errorCode` / `errorMsg` (camelCase)
- `orderDetail` → `error_code` / `error_msg` (snake_case)

**errorMapper 必须兼容两种**（推荐写成：`raw.error_code ?? raw.errorCode`）。

---

## 4. PROMO_DDK Endpoint — **REMOVED from V0.1 scope**

**Boss 决策（2026-04-23）**：`promo ddk` 不纳入 V0.1 实施范围，保留 V0 现有 placeholder 行为（`src/commands/promo/ddk.js` 返 `E_DDK_UNAVAILABLE` + exit code 1 不变）。

**Recon 记录（供未来 V0.2+ 参考，非 V0.1 编码依据）**：
- 测试账号 `mall_id=445301049` **未开通多多进宝**。
- 所有 `/jinbao/*` URL 均重定向至 `/jinbao/open`（开通引导页），**不触发任何业务 XHR**。
- 若未来需要重启此功能：需已开通 jinbao 的账号重做本节抓包，并补充 endpoint URL / response shape。

**proposal/tasks/design 相关改动**：
- `openspec/changes/fill-v0-placeholders/specs/promo/` 已删除
- `design.md` D3 改为"V0.1 不动"
- `tasks.md` 原 Section 4 已删除
- `tasks.md` 原 Task 7.11 (`ddk_exit_code_contract` PBT) 已删除

---

## 5. SYCM Funnel Endpoint — **REMOVED from V0.1 scope**

**Boss 决策（2026-04-23）**：funnel 维度不再走"多多参谋 / SYCM / DMP"路径，改用订单履约漏斗（数据源 = `listOrders` + `computeOrderStats`）。本节归档为历史记录，非 V0.1 编码依据。

**废止理由**：
1. "生意参谋 (SYCM)" 是淘宝产品而非 PDD，本次 recon 的 `/sycm/*` 路径其实落到 PDD 的"跨境电商招募"页，是错误入口
2. PDD 对应产品名为"多多参谋"（内部 DMP），但测试账号及大多数中小商家默认未开通
3. 即便找到真实 DMP 入口，依赖外部订阅服务会让 V0.1 交付门槛大幅上升
4. funnel 的核心业务价值（转化率诊断）可以用订单域数据近似：`conversion_rate = (total - refund_count) / total`、`refund_rate`

**V0.1 新方案**：详见 `openspec/changes/fill-v0-placeholders/design.md` D5（订单履约漏斗阈值）、`specs/diagnose/spec.md` "Diagnose Funnel — Order Fulfillment Funnel"。

---

### 抓包历史记录（仅供未来 V0.2+ 参考，非 V0.1 编码依据）

| URL | 实际落点 |
|---|---|
| `/sycm/flow_index` | `/sycm/goods_effect`（重定向） |
| `/sycm/goods_effect` | 页面 h1="跨境电商卖家招募"（未渲染业务内容；非真实 funnel 入口） |

**143 条 XHR 全为** menu / whitelist / permission check（`/earth/api/*`, `/janus/api/*`, `/carson/api/*`, `/medicine/*`, `/pluto/*`），**无 `/sycm/` / `/dmp/` / `/insight/` 域业务 XHR**。

**未来若 V0.2 需重启"真实流量漏斗"**：需已开通"多多参谋"的账号重做抓包，入口大概率在 `/mms.pinduoduo.com/dmp/*` 或首页经营概况 summary endpoint（如 `/mars/app/home/*`）。

---

## 6. runEndpoint 合约扩展需求（对 Section 1）

基于本次 recon，D8 扩展的 4 条合约**全部必要**：

| 扩展字段 | 必要性理由 |
|---|---|
| `nav.url: string \| fn` | ORDER_DETAIL 固定 URL、但需从 params 构造查询 query；PROMO_DDK 将接受 `--goods_id` 参数（未来） |
| `errorMapper` | orderDetail 的 `error_code=1000/54001` 必须映射为 `E_USAGE` / `E_RATE_LIMIT`；两个 mangkhut endpoint 命名不一致需要桥接 |
| `requiredTrigger: true` | ORDER_DETAIL 走 D2.b trigger-based，缺 trigger 会让 collector 等不到 |
| 内置 429 retry | orderDetail 触发过 rate limit；PDD 业务 anti-content 保护普遍存在；1s/2s/4s 退避合理 |

---

## 7. Recon → Implementation Decision Points（请 Boss 决策）

以下 4 个决策点**影响 Section 1-6 的实施范围**，等 Boss 决策后才能进入编码阶段。

### 决策点 A — State probe 路径过时

**事实**：V0 `mall-switcher.js` 的 6 条路径在 Next.js 版 PDD mms 后台全部 miss（见 §1.1）。

| 方案 | 操作 | 成本 | 收益 |
|---|---|---|---|
| **A1** 扩展 Section 2 scope | 在 `resolveMallContext` 加 `__mms.*` + `__NEXT_DATA__.props.*` 路径 | +1 subtask（约 10 行代码 + 2 单测） | 修根因，state probe 毫秒级即命中，xhr probe 只需作为兜底 |
| **A2** 保持 proposal 不变 | 仅加 xhr probe；state 继续 miss | 零额外成本 | xhr probe 每次都要走 3s 超时（见 D1），且 orders 页 xhr 无 mall_id 会 fallthrough 到 dom probe（10s+） |

**建议：A1**（scope creep 小但收益显著）

### 决策点 B — DDK & SYCM 未开通账号行为

**事实**：测试账号（以及大多数个人/小商家账号）未开通 jinbao / SYCM（见 §4 §5）。

| 方案 | 操作 | 用户体验 |
|---|---|---|
| **B1** 新增 `E_DDK_NOT_OPEN` / `E_SYCM_NOT_OPEN` + URL gate | 开通状态检测 + 友好错误 | 2-5s 快速失败 + 明确提示 |
| **B2** 让 runEndpoint 走通用 E_TIMEOUT | 现状不变，nav.readyEl 超时 | 30s 等待 + 通用超时错误（不友好） |
| **B3** 延后至 V0.2 | V0.1 不处理未开通；skip 用例 | 同 B2，但明文 scope-out |

**建议：B1**（对齐 D3 的"对齐 promo.search"路径要求友好降级）

### 决策点 C — orders endpoint 命名混乱

**事实**：`recentOrderList` 用 camelCase，`orderDetail` 用 snake_case（见 §3）。

| 方案 | 操作 |
|---|---|
| **C1** `errorMapper` 统一处理 `raw.error_code ?? raw.errorCode` | 单测覆盖两种 envelope |
| **C2** 每个 endpoint 各自的 errorMapper | 更清晰但代码冗余 |

**建议：C1**（扩展 `runEndpoint` 时提供公共 helper）

### 决策点 D — ORDER_LIST 真实有 goods_id，D4 策略升级

**事实**：真实 `orders.list` 每行包含 `goods_id: number`（见 §3）。

| 方案 | 操作 |
|---|---|
| **D1 (升级)** stale-match 优先 goods_id，fallback goods_name | 精确度提升，ambiguous_groups 几乎不会触发 |
| **D2 (原 proposal)** 坚持只用 goods_name | 保守，但浪费真实 API 的信息 |

**建议：D1**（扩展 D4 文档：`matched_by: 'goods_id' | 'goods_name'`，两种路径均覆盖单测）

---

## 8. Recon 完成度对照

| Task | 目标 | 结果 |
|---|---|---|
| 0.1 登录 PDD | ✅ | jshook Chrome 已登录，mall_id=445301049 |
| 0.2 orders.detail XHR | ✅ URL/params | POST /mangkhut/mms/orderDetail + {order_sn, source}；success shape 因 rate limit 未抓到 |
| 0.3 SYCM funnel | ⚠️ blocker | 账号未开通；URL/shape 未获得 |
| 0.4 mall_id 响应路径 | ✅ | `$.result.goods_list[i].mall_id` (goodsList endpoint)；另 state 路径 4 处 |
| 0.5 归档 | ✅ 本文档 | |
| 0.6 Boss 签收 | ⏳ 待决策点 A-D 回复 | |
| ~~(原 0.2) promo.ddk XHR~~ | ❌ **REMOVED from scope** | Boss 决策 2026-04-23：DDK 不纳入 V0.1 |

**blocker 的补救路径**：
- 联系一个 **已开通 SYCM** 的测试账号，重跑 §5 抓包即可补全
- 或：V0.1 实施时用 **speculative endpoint 元数据**（regex urlPattern 通配），首次真实调用时 console.log + 回填本文档

---

## 附录：原始 XHR 证据引用

### A1. goods.list XHR 中含 mall_id 的请求

- `requestId: 15992.1581`
- `POST https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList`
- `postData: {"pre_sale_type":4,"page":1,"out_goods_sn_gray_flag":true,"shipment_time_type":3,"is_onsale":1,"sold_out":0,"size":10}`
- Response preview: `{"success":true,"errorCode":1000000,"errorMsg":null,"result":{"sessionId":"...","total":32,"goods_list":[{"quantity":368,...,"mall_id":445301049,...`

### A2. orderDetail request 确认

- `requestId: 15992.2357`
- `POST https://mms.pinduoduo.com/mangkhut/mms/orderDetail`
- `postData: {"source":"MMS"}` （缺 order_sn）
- Response: `{"success":false,"errorCode":1000,"errorMsg":"订单号不能为空","result":null}`

### A3. recentOrderList response 样本

- `requestId: 15992.1986`
- `POST /mangkhut/mms/recentOrderList`
- Response (摘): `{"success":true,"errorCode":0,"errorMsg":"成功","result":{"totalItemNum":9,"pageItems":[{"order_sn":"260422-461944921680776","goods_id":732191698596,"goods_name":"夏季新款男童...","goods_number":1,"goods_price":1213,"order_amount":1213,...}]}}`
