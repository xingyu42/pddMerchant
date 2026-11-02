# Implement — 修复 promo 模块适配新版拼多多报表接口

## 执行顺序

### Step 1 — 网关名修正（R1）
**文件**：`src/adapter/endpoints/promo.js`
- `PROMO_ENTITY_REPORT.urlPattern`：`apollo` → `poseidon`
- `PROMO_ENTITY_REPORT.apiUrl`：`/apollo/api/report/queryEntityReport` → `/mms-gateway/poseidon/api/report/queryEntityReport`
- `PROMO_HOURLY_REPORT.urlPattern`：`apollo` → `poseidon`
- `PROMO_HOURLY_REPORT.apiUrl`：`/apollo/api/report/queryHourlyRangeReport` → `/mms-gateway/poseidon/api/report/queryHourlyRangeReport`

**验证**：`npx vitest run test/promo-roi.unit.test.js` 应仍通过（单测不依赖网关名）

---

### Step 2 — moneyToNumber helper + normalize 拍平（R3, D1, D2, D4）
**文件**：`src/adapter/endpoints/promo.js`
- 顶部新增 `moneyToNumber(v)` helper（D2 实现）
- 顶部新增 `flattenEntity(e)` helper（D4 实现，兼容 reportInfo 嵌套）
- 重写 `PROMO_ENTITY_REPORT.normalize`：
  ```js
  normalize: (raw) => {
    const totals = raw?.result?.totalSumReport ?? {};
    const entities = (raw?.result?.entityReportList ?? []).map(flattenEntity);
    return {
      entities,
      totals: {
        ...totals,
        impression: Number(totals.impression ?? 0),
        click: Number(totals.click ?? 0),
        gmv: moneyToNumber(totals.gmv),
        spend: moneyToNumber(totals.spend ?? totals.cost),
        netGmv: moneyToNumber(totals.netGmv),
        ctr: moneyToNumber(totals.ctr),
        costPerOrder: moneyToNumber(totals.costPerOrder),
      },
      impression: Number(totals.impression ?? 0),
      click: Number(totals.click ?? 0),
      ctr: moneyToNumber(totals.ctr),
      gmv: moneyToNumber(totals.gmv),
      netGmv: moneyToNumber(totals.netGmv),
      costPerOrder: moneyToNumber(totals.costPerOrder),
      raw,
    };
  }
  ```
- `PROMO_HOURLY_REPORT.normalize` 同样拍平 MoneyVO（`totals.sumReport` 等）

**验证**：`npx vitest run test/promo-roi.unit.test.js`（先更新 fixture 后跑）

---

### Step 3 — route handler merge（R2, D3）
**文件**：`src/adapter/endpoint-client.js:283-287`
- 当前：
  ```js
  const payload = meta.buildPayload(params, ctx);
  const routeHandler = async (route) => {
    await route.continue({ postData: JSON.stringify(payload) });
  };
  ```
- 改为（D3 实现，含容错）：
  ```js
  const payload = meta.buildPayload(params, ctx);
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

**验证**：`npx vitest run test/command-runner.unit.test.js` + `test/adapter-new.unit.test.js`

---

### Step 4 — 测试 fixture 更新（R3 配套）
**文件**：
- `test/fixtures/endpoints/promo.entityReport.json`
- `test/fixtures/endpoints/promo.entityReport.multi-plan.json`
- `test/fixtures/endpoints/promo.entityReport.waste.json`

将 `entities[i].spend/gmv/ctr` 和 `totals.spend/cost/gmv/ctr/netGmv/costPerOrder` 改为 `MoneyVO` 结构：
```json
"spend": { "unit": "YUAN", "value": "500", "unitCode": 1 }
```
注意：fixture 是 `normalize` **输出**形状（已拍平的裸数字），不是原始响应。需确认 fixture 是输入还是输出——见 Step 4 验证。

**验证**：`grep -n "normalize" test/fixtures/endpoint.js` 确认 fixture 喂给 `normalize` 还是直接当 normalize 输出。如果是直接当输出，fixture 应保持裸数字（不改）；如果是原始响应输入，改为 MoneyVO。

---

### Step 5 — moneyToNumber 单测（AC #4）
**文件**：新增 `test/promo-normalize.unit.test.js` 或追加到 `test/promo-roi.unit.test.js`
- 测 `moneyToNumber`：MoneyVO / 裸数字 / null / 非对象 四种输入
- 测 `normalize`：给定 MoneyVO 响应，输出裸数字
- 测 route handler merge：origPayload 含 crawlerInfo 时被保留（mock route）

**验证**：`npx vitest run test/promo-normalize.unit.test.js`

---

### Step 6 — 全量回归
**命令**：
```bash
npm test
```
**通过门**：
- 全量 ~770 测试通过
- `test/layering-guard.unit.test.js` 通过（依赖方向未破坏）
- `test/e2e/promo.e2e.test.js` 通过
- `test/pbt/boundary.pbt.test.js` 通过

**若 orders/goods e2e 失败**：说明 A 方案 merge 引入回归，定位是哪个 endpoint 的 origPayload 多带字段导致后端拒绝。回退方案：加 `meta.replacePayloadOnly` 标志，对该 endpoint 关闭 merge（design D3 的 Plan B）。

---

### Step 7 — 实跑验证（Phase 1b, AC #1-2）
**前置**：本地 `data/auth-state.json` 有效登录态
**命令**：
```bash
node bin/pdd.js promo roi --json --headed
node bin/pdd.js promo search --json
node bin/pdd.js promo scene --json
```
**通过门**：
- 不报 `E_NETWORK` 超时
- `promo roi` 返回 `data.rows` 数组（有数据时非空，无数据时空数组但 `summary` 有值）
- 若 `entityReportList[i]` 结构是 `reportInfo` 嵌套（OQ1），校正 `flattenEntity` 后重跑

**若实跑失败**：
- 检查 `crawlerInfo` 是否真的被保留（`PDD_DEBUG_RAW=1` 看请求体）
- 检查 `urlPattern` 是否匹配 poseidon 路径
- 校正 `flattenEntity` 嵌套结构

## Review Gates

- **Gate 1（Step 3 后）**：route handler merge 是公共运行时改动，self-review 一遍容错逻辑（D3）
- **Gate 2（Step 6 后）**：全量测试通过才进 Step 7 实跑
- **Gate 3（Step 7 后）**：实跑非空才标记任务完成

## Rollback Points

- Step 1-2 出错：`git checkout src/adapter/endpoints/promo.js`
- Step 3 出错：`git checkout src/adapter/endpoint-client.js`
- Step 6 回归：加 `meta.replacePayloadOnly` 标志对回归 endpoint 关 merge，不回退整个改动
