# Design — 修复 promo 模块适配新版拼多多报表接口

## 边界与契约

### 影响面
```
src/adapter/endpoints/promo.js          ← R1 网关名 + R3 normalize MoneyVO 拍平
src/adapter/endpoint-client.js          ← R2 route handler merge（公共运行时）
src/services/promo.js                   ← R3 service 层适配器（如有 reportInfo 嵌套）
src/adapter/goods-publish/form-filler.js← 不改（已是 A 方案模式，作为参考样板）
test/fixtures/endpoints/promo.*.json    ← 更新为 MoneyVO 结构
test/promo-roi.unit.test.js             ← 输入数据 MoneyVO 化
test/e2e/promo.e2e.test.js              ← 不改（断言 envelope 形状，不断言金额结构）
test/pbt/boundary.pbt.test.js           ← 不改（只跑命令边界，不深入金额）
```

### 公共运行时改动风险
`endpoint-client.js:285-286` 的 route handler 是所有 fetch-path endpoint 共用。A 方案 `{...orig, ...payload}` 是超集合并：
- `orig` = 页面 JS 构造的请求体（含 `crawlerInfo`、UI 状态字段）
- `payload` = `meta.buildPayload()` 构造的业务字段
- merge 后 `payload` 字段覆盖 `orig` 同名字段，`orig` 的额外字段（如 `crawlerInfo`）自动保留

**6 个 fetch-path endpoint 影响评估**：

| Endpoint | 网关 | 当前 orig 含 crawlerInfo? | merge 后行为 | 回归风险 |
|---|---|---|---|---|
| goods.goodsList (vodka) | 不强校验 | 大概率无 | 等价现状 | 零 |
| goods.queryMmsGoodsListAdStrategy | 不强校验 | 大概率无 | 等价现状 | 零 |
| orders.list (mangkhut) | 不强校验 | 大概率无 | 等价现状 | 零 |
| orders.stats (mars) | 不强校验 | 大概率无 | 等价现状 | 零 |
| promo.entityReport (poseidon) | 强校验 | 有 | 修复 | 修复 |
| promo.hourlyReport (poseidon) | 强校验 | 有 | 修复 | 修复 |

兜底：770 测试 + e2e 套件。

## 核心数据流（修复后）

```
pdd promo roi --json
  ↓ withCommand → executeSingle → executeLive → withBrowser
  ↓ service: getPromoRoi(page, params, ctx)
  ↓ runEndpoint(page, PROMO_ENTITY_REPORT, params, ctx)
  ↓ endpointClient.execute → _attemptFetch
  ↓
  ┌─ page.route(urlPattern, handler) ──────────────────┐
  │  handler:                                          │
  │    origPostData = route.request().postData()       │
  │    origPayload  = JSON.parse(origPostData)         │
  │    payload      = meta.buildPayload(params, ctx)   │
  │    merged       = { ...origPayload, ...payload }   │ ← A 方案
  │    route.continue({ postData: JSON.stringify(merged) })
  └────────────────────────────────────────────────────┘
  ↓ 页面导航 → trigger → 浏览器发请求（postData 被 merged 替换，crawlerInfo 保留）
  ↓ xhr-collector 拦截响应（urlPattern 现在匹配 poseidon）
  ↓ parseBody → isSuccess → normalize
  ↓
  ┌─ normalize (修复后) ───────────────────────────────┐
  │  entities = result.entityReportList.map(e => ({    │
  │    ...拍平 MoneyVO...                              │
  │  }))                                               │
  │  totals = 拍平 totalSumReport 的 MoneyVO 字段      │
  └────────────────────────────────────────────────────┘
  ↓ analyzePromoRoi({entities, totals})  ← 下游零感知，拿到的是裸数字
  ↓ finalizeSuccess → envelope → emit
```

## 关键设计决策

### D1 — 适配器边界放在哪一层？
**决策**：放在 `endpoints/promo.js` 的 `normalize` 里，不放到 service 层。

**理由**：
- `normalize` 是 endpoint 元数据的固有职责（每个 endpoint 自己定义如何标准化响应）
- service 层 `getPromoReport` 只做转发，不应该知道 `MoneyVO` 这种传输层细节
- 下游消费者拿到的 `entities`/`totals` 已经是裸数字，service 层和下游都不需要适配
- 对齐 `endpoint-xhr-contracts.md` spec：raw payload 只在 adapter/service normalizer 边界处理，不泄露到 command

**实现**：`normalize` 内部调 `moneyToNumber` 拍平金额字段。`moneyToNumber` 作为 util 放在 `endpoints/promo.js` 顶部局部定义，或抽到 `infra/` 如果其他 endpoint 也需要。

**边界可上移条件（OQ3）**：当前边界选择服务于 Phase 1 的「下游零改动」目标（实现选择，非硬约束）。若 Phase 2 业务需要下游消费新版额外字段（`waivedRefundRate`/`bidType`/退款豁免率等），可将边界上移到 service 层：`normalize` 只做字段名映射不拍平，service 层透传原始结构（含 `MoneyVO` + `reportInfo` 嵌套 + 新维度字段），下游 7 个消费者同步改读取路径。届时本决策需重写。

### D2 — `moneyToNumber` 放哪里？
**决策**：Phase 1 放在 `src/adapter/endpoints/promo.js` 顶部作为模块内 helper（不导出）。

**理由**：
- 当前只有 promo 两个 endpoint 需要（orders/goods 响应没 MoneyVO）
- YAGNI — 不预先抽到 `infra/`，等第二个 endpoint 需要 MoneyVO 时再抽
- 可测试性：通过 `normalize` 的输入输出间接测试，或后续需要时再导出单测

**实现**：
```js
function moneyToNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'value' in v) return Number(v.value) || 0;
  return Number(v) || 0;
}
```

### D3 — route handler merge 的 origPayload 解析容错
**决策**：`JSON.parse(origPostData)` 失败时回退到整替模式（旧行为）。

**理由**：
- 不是所有请求体都是 JSON（如 goods-publish 的 multipart）
- 解析失败时维持原 `route.continue({ postData: JSON.stringify(payload) })` 行为，避免对非 JSON 请求体引入回归

**实现**：
```js
const routeHandler = async (route) => {
  const origPostData = route.request().postData();
  let merged = payload;
  if (origPostData) {
    try {
      const origPayload = JSON.parse(origPostData);
      if (origPayload && typeof origPayload === 'object' && !Array.isArray(origPayload)) {
        merged = { ...origPayload, ...payload };
      }
    } catch {
      // 非 JSON body，维持整替模式
    }
  }
  await route.continue({ postData: JSON.stringify(merged) });
};
```

### D4 — `entityReportList[i]` 结构未知的容错
**决策**：`normalize` 同时兼容「字段直接在元素上」和「字段嵌套在 `reportInfo` 里」两种结构。

**理由**：OQ1 未实测，不能赌一种结构。两种都兼容成本极低，运行时自动选对。

**实现**：
```js
function flattenEntity(e) {
  const r = e?.reportInfo ?? {};  // 若嵌套则取 reportInfo，否则空对象
  return {
    planId: e?.planId,
    adId: e?.adId,
    adName: e?.adName ?? e?.goodsName,
    goodsId: e?.goodsId,
    goodsName: e?.goodsName,
    scenesType: e?.scenesType,
    promotionType: e?.promotionType,
    isDeleted: e?.isDeleted,
    planDeleted: e?.planDeleted,
    adDeleted: e?.adDeleted,
    impression: Number(e?.impression ?? r.impression ?? 0),
    click: Number(e?.click ?? r.click ?? 0),
    gmv: moneyToNumber(e?.gmv ?? r.gmv),
    spend: moneyToNumber(e?.spend ?? r.spend ?? e?.cost ?? r.cost),
    ctr: moneyToNumber(e?.ctr ?? r.ctr),
  };
}
```
`e?.gmv ?? r.gmv` 的 `??` 链：优先取元素顶层，否则取 reportInfo 嵌套，兼容两种结构。

## 兼容性

- **向后兼容**：CLI 接口（`--page/--size/--since/--by/--break-even/--include-inactive`）全部不变
- **下游兼容（Phase 1 实现选择）**：service 层输出形状不变，7 个消费者零改动。此为 Phase 1 选择，非永久约束——若 Phase 2 上移边界让下游消费新版字段（OQ3），下游兼容性会打破
- **测试兼容**：e2e 断言 envelope 形状不断言金额结构，不受影响；单测 fixture 需更新为 MoneyVO 输入

## Rollout / Rollback

- **Rollout**：直接改 4 文件 + 测试，单分支提交。无灰度需求（CLI 工具，本地运行）
- **Rollback**：`git revert` 单次提交即可。无数据库迁移、无配置变更
- **验证门**：`npm test` 全绿 + `pdd promo roi --json` 实跑非空（Phase 1b）
