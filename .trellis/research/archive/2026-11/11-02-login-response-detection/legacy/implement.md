# 执行计划：登录状态按响应识别

## 顺序

1. **纯分类函数**：在 `src/adapter/password-login.js` 新增并导出 `classifyAuthResponse(raw)`，按 design 表映射；兼容 `errorCode`/`error_code`。缺失或未知码返回 `null`。
2. **响应捕获**：在 `attemptPasswordLogin` 提交前挂 `page.on('response')`，匹配 `/janus/api/auth`（path 匹配，排除 `auto/check/login`）。命中读 `response.json()`，`try/catch` 吞异常，存最新 `{ errorCode }`。在 `finally`/清理处 `page.off`。
3. **接入轮询**：`waitForLogin` 每轮优先 `classifyAuthResponse(captured)`，得确定结果则返回；否则维持现有 PASS_ID cookie 与 DOM 文案兜底顺序。
4. **测试**（`test/adapter/password-login.test.js`）：
   - `classifyAuthResponse` 穷举（402 / 8000000 / 54001 / 2000015 / 2000020 / 2000021 / 未知 / 无 code）。
   - `fakePage` 增加 `on/off('response')` 与一个可触发的响应事件；验证提交后捕获并优先返回。
   - 无响应时回退到 DOM 文案的用例保持通过。
5. **区分测试**：`classifyRateLimit` 无独立测试文件（`54001` 现由 `test/adapter/orders-contract.test.js` 覆盖）。在 `password-login.test.js` 内断言登录分类器对 `54001` 返回 challenge；endpoint 路径语义由既有 orders-contract 测试保证不变。

## 验证命令

```bash
npx vitest run test/adapter/password-login.test.js
npx vitest run test/adapter/orders-contract.test.js   # 确认 endpoint 路径 54001 语义不变
npm test                                               # 契约 v2 + 全量
```

## 风险点 / 回退

- 唯一高风险文件 `src/adapter/password-login.js`。回退 = `git checkout` 该文件 + 新增测试。
- 读 body 的异常处理若不严密会污染登录流程 → 必须全部降级到兜底，不外抛。
- 真机行为（`54001` 是否真的出现在账密登录、题型分布）无法在 fixture 验证，列为已知未验证，遇到时按授权再核。

## 提交前检查

- `git diff` 仅含 `password-login.js` 与测试。
- 无 `console.log`，无敏感值入日志。
- 契约 v2 测试通过。
