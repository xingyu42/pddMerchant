# Design: 订单 page-api 可靠性收紧

## 1. Architecture Boundary

生产数据流保持单一路线：

```text
orders command
  -> orders service
  -> runEndpoint
  -> PlaywrightEndpointClient(page-api)
  -> executePageApiRequest(main world)
  -> merchant webpack request client.post()
  -> single business envelope
  -> strict order result validation
  -> normalized command data
```

`page-api` 不进入 `executeAttempt`，因此不导航订单页、不注册 `page.route()`、不创建 XHR collector、无按钮 trigger，也无旧路线 fallback。

## 2. Runtime Discovery

### 2.1 Bounded wait

- 在一次 `evaluateInMainWorld()` 中最多检查 15 次，每次间隔 200ms，总等待上限约 3 秒。
- Node 侧同时用 `ctx.signal` 和 `remainingMs(ctx)` 包住整个 main-world evaluate；命令截止时间或主动中断优先终止等待并抛 `E_TIMEOUT`，不允许页面 Promise 无限悬挂。
- 运行时尚未出现时继续扫描；已捕获 `webpackRequire` 后复用页面函数内局部引用，只重复扫描 module cache/definitions，不重复注入探针。
- 等待耗尽返回结构化 `unavailable` 原因，由 Node 侧映射为 `E_NETWORK`，hint 同时说明“可能是加载时序或运行时形态变化”，不直接误导为必须升级 CLI。

### 2.2 Webpack 4

- 发现 `webpackJsonp*` 数组。
- 使用空 chunk-id 列表和临时 module 捕获 `webpackRequire`。
- 捕获后立即删除临时 `webpackRequire.c/m` 条目。
- 不写任何 `window.__pddCli*` 缓存，不在 installedChunks 留探针 chunk id。

### 2.3 Webpack 5

- 发现 `webpackChunk*` 数组。
- 使用标准 runtime callback 第三元组捕获 `webpackRequire`，同样使用空 chunk-id 列表。
- 只支持标准 `webpackChunk*` push 契约；不构建通用 bundler 适配层。

### 2.4 Request client matching

继续用现有最小导出面识别商家请求客户端：`fetch/post/get/put/del/redirectToLogin`。优先扫描已加载 cache；仅对同时包含 `redirectToLogin` 和 `Anti-Content` 的 module factory 做受限加载。

## 3. Response Contract

页面 request client 存在两种合法返回形状：

1. 当前活线：直接返回已拆包 result。
2. 兼容形状：返回完整业务信封，含 `success`、`errorCode/error_code` 或 `result`。

Node 边界规则：

- 完整信封原样作为 `raw`，禁止再次包装。
- 已拆包 result 包装一次为 `{ success: true, errorCode: 0, result }`。
- 页面侧抛错只回传 status、错误码和错误消息，不回传异常对象。
- 页面 request client 拒绝若没有业务错误码且没有有效 HTTP 失败状态，则标记为传输失败；Node 侧统一抛 `E_NETWORK`。Playwright evaluate 自身异常同样在 endpoint client 边界包装为 `E_NETWORK`，已是 `PddCliError` 的超时等语义保持不变。

三个订单端点各自拥有严格 result 断言：

- list：`totalItemNum` 必须是有限数字，`pageItems` 必须是数组。
- stats：`unship/unship12h/delay/unreceive` 必须存在且为有限数字。
- detail：result 必须是非数组对象，并包含订单号字段。

断言失败抛统一 `PddCliError(E_NETWORK)`，说明平台响应结构无法确认；不得用 `?? 0` 或 `?? []` 继续返回成功。

## 4. Endpoint Spec Validation

- `resolveEndpointStrategy()` 仍是策略唯一真相源。
- validator 先解析一次 resolution，再把 resolution 传给 required/transport 校验。
- 显式 `page-api` 缺少有效 `apiUrl` 或 `buildPayload` 是 error，不只是 ambiguous warning。
- `_attemptPageApi()` 保留运行时守卫，防止跳过 validator 的直接调用抛裸 `TypeError`；映射为 `E_USAGE`。

## 5. Error Semantics

- `40002` 保持 `E_BUSINESS`，classification 为 `high-frequency-or-risk-control`，不记录 rate-limit failure，不进入 cooldown。
- 特殊 hint 通过业务错误构造器中的分类表生成，和通用业务错误共用一条构造路径。
- error detail 保持 `errorCode`、classification 和经过输出层脱敏的 raw，避免特殊分支比通用分支更难排障。
- HTTP 429 和确认的 `54001` 行为不变。

## 6. Synthetic Response

`page-api` 合成对象实现当前 client/errorMapper 可安全使用的最小 Response 面：

- `status()`
- `ok()`
- `url()`
- `headers()`
- `json()`
- `text()`

URL 以当前 page URL 为 base 解析 `apiUrl`；headers 至少声明 JSON content type。

## 7. Page Session Cleanup

生产 `createPageSession()` 始终提供 `selectPage/recordNavigation`。`executeAttempt` 删除仅支持旧测试 mock 的 `pageSession.goto` 分支：

- 有 `selectPage` 时先选定 attempt page，再绑定 transport/collector，导航成功后 `recordNavigation`。
- 否则直接在传入 page 导航，不假定第三方半实现 pageSession。

## 8. Fixture Parity Boundary

- 订单 fixture 当前保存的是命令/服务层可直接消费的归一化形状，而不是 live endpoint 原始响应；三个订单 spec 显式声明 `fixtureIsServiceFacing: true`。
- parity diagnostic 只有看到该显式标记时，才把 live normalizer 拒绝降级为兼容性 warning。
- 未标记 spec 的 normalize 异常仍为 error，防止全局吞掉 fixture 漂移。

## 9. Compatibility And Rollback

- CLI envelope、fixture endpoint name、orders command 参数和输出字段保持不变。
- `orderDetail` 请求继续只发活线已证实的 `orderSn`，不双写 `order_sn`。
- 若运行时发现逻辑回归，可回滚本任务的 discovery hardening；不得以恢复旧订单导航/XHR fallback 作为回滚方案。
