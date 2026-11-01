# 设计：登录状态按响应识别

## 边界

改动集中在 `src/adapter/password-login.js`。服务层 `recordReloginOutcome`（`src/services/password-relogin.js`）的 `OUTCOMES` 状态机已覆盖 `wrong_password`、`account_locked`、`challenge`，无需改动。登录路径当前不经过 `classifyRateLimit`（仅 `endpoint-client.js:272` 调用它，服务于商品/订单端点），因此 R3 由「不把登录响应接入该分类器」自然满足，endpoint-client 不动。

## 数据流

```
attemptPasswordLogin
  → 提交前 attachAuthResponse(page)：page.on('response') 匹配 /janus/api/auth
      命中时读 body，存最新 { errorCode, errorMsg }（读 body 失败则忽略该次）
  → 点击提交
  → waitForLogin 轮询：
      1. 若捕获到 auth 响应 → classifyAuthResponse(code) 得确定结果则返回
      2. 否则 PASS_ID cookie 命中 → success（现状不变）
      3. 否则 DOM 文案兜底（现状不变）
  → 清理时 detach 监听
```

## classifyAuthResponse（纯函数，便于穷举测试）

输入 `errorCode`（兼容 `error_code`），输出 `{ outcome, challenge? }` 或 `null`（交兜底）：

| code | 返回 | 落库状态（现有 OUTCOMES） |
| --- | --- | --- |
| `402` | `{ outcome: 'wrong_password' }` | blocked / wrong_password（熔断） |
| `8000000` | `{ outcome: 'account_locked' }` | blocked / account_locked（熔断） |
| `54001` | `{ outcome: 'challenge', challenge: 'unknown' }` | awaiting_human（代码无法从响应区分题型，诚实地记为 unknown，交人工） |
| `2000015` / `2000020` / `2000021` | `{ outcome: 'challenge', challenge: 'sms' }` | awaiting_human / sms |
| 其他 / 无 code | `null` | 走 DOM 兜底 |

成功不靠响应 `success` 字段判定，仍以 PASS_ID cookie 为准，避免与现有成功信号冲突。

## 契约与安全

- 监听器只读 `errorCode`/`errorMsg`，不记录 body、cookie、令牌；错误 detail 不含 PII。
- `errorMsg` 仅用于兜底兼容，不入日志。
- 不引入新依赖；`page.on('response')` 为 Playwright 既有能力，与 `xhr-collector.js`、`consumer-identity.js` 用法一致。
- 读 body 用 `response.json()`，对非 JSON、已消费、解析异常一律吞掉并降级到兜底，不抛出到登录流程。

## 兼容与回退

- 响应未捕获或分类返回 `null` 时，`waitForLogin` 行为与现状完全一致（DOM 文案 + PASS_ID cookie）。
- 服务层、daemon console、接管流程、fixture 契约均不变。
- `54001` 在 endpoint-client 路径仍是 `business-54001` 限流语义，登录路径独立分类，互不影响。

## 测试策略

- `classifyAuthResponse` 纯函数穷举：`402`、`8000000`、`54001`、三个手机验证码、未知码、缺失 code。
- 通过 `fakePage` 增加 `page.on('response')` 支持，验证提交后捕获响应并优先于 DOM 文案返回正确结果。
- 回退用例：无响应时仍走 DOM 文案兜底。
- 区分用例：`classifyRateLimit(54001)` 仍返回 `business-54001`（endpoint 路径不变），登录分类器对 `54001` 返回 challenge。
