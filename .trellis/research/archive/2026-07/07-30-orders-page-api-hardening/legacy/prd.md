# 修正订单 page-api 可靠性与错误语义

## Goal

让订单 `page-api` 单一路线可靠复用商家后台签名请求客户端，并确保运行时形态变化、加载时序和响应形状变化只能产生明确错误，绝不能静默降级为“0 单 / 0 销”。

## Background

- 当前工作区已将 `orders.list`、`orders.detail`、`orders.stats` 改为显式 `page-api`，不再保留订单页导航、按钮点击和 XHR 捕获回退。
- `src/adapter/page-api-client.js:94-99` 无条件把 `client.post()` 返回值包装为 `{ success: true, result: data }`；若页面客户端返回完整业务信封，会形成双层 `result` 并被订单 normalizer 静默归零。
- `src/adapter/page-api-client.js:36-37` 只发现 `webpackJsonp*`，且当前无运行时就绪等待；异步 chunk 未加载或 Webpack 运行时升级时会立即失败。
- `src/adapter/page-api-client.js:32,52` 把客户端缓存到可枚举字符串全局；这增加了不必要的页面侧持久痕迹。
- `src/adapter/endpoint-client.js:330` 对显式 `page-api` 的 `buildPayload` / `apiUrl` 无运行时守卫；错误 spec 会抛裸 `TypeError`。
- `src/adapter/endpoint-validator.js:88` 直接读取 `spec.strategy` 决定 `urlPattern` 要求，与策略解析器形成双真相源。
- `src/adapter/endpoint-client.js:269-279` 对 `40002` 的特殊分支正确避免了“确认限流”误判，但错误构造与通用业务错误分支重复，且诊断详情不一致。
- `CLAUDE.md:81` 只说明 `orderDetail` 响应错误字段为 snake_case，不能作为请求字段 `order_sn` 的证据；请求字段必须以真实页面调用为准。
- 2026-07-30 已登录商家首页只读探针确认：当前全局为 Webpack 4 风格 `webpackJsonp` 数组；无需进入订单页即可在已加载 module cache 中找到签名请求客户端。
- 同一探针确认 `client.post()` 对 list/stats/detail 均返回已拆包的直接 result：list 直接含 `totalItemNum/pageItems`，stats 直接含四个统计字段，detail 直接返回订单对象；当前实现的单层包装适用于该活线形状，但仍需兼容未来返回完整信封。
- 同一探针使用请求体 `{ orderSn, source: 'MMS' }` 成功取得详情；详情响应字段仍为 `order_sn`。因此请求保持 `orderSn`，不双写未经需要的 `order_sn`。
- 活线验证确认 Webpack 4 可用空 chunk-id 列表捕获 `webpackRequire`，随后删除临时 module/cache 条目；不需要写 `window.__pddCliMmsRequestClient`，也不需要在 installedChunks 留下探针 chunk id。

## Requirements

- R1：页面客户端成功返回完整信封或已拆包 result 时，Node 侧都必须得到统一、单层业务信封；订单 endpoint 必须校验 result 必需字段，未知或畸形形状必须明确失败，不能通过 `?? 0` / `?? []` 伪装成功。
- R2：`page-api` 必须在有限时间内等待页面运行时及请求客户端就绪；等待耗尽时返回可诊断的统一错误，且不得回退旧订单路线。
- R3：运行时发现必须兼容当前真实 Webpack 4 页面形态；Webpack 5 支持属于预防性兼容范围，必须限制为其标准 `webpackChunk*` push 契约并具备独立测试，不扩展成通用模块加载器。
- R4：不向页面写可枚举字符串缓存；若缓存无必要则每次重查，优先最小实现。
- R5：订单详情请求字段以真实页面请求证据为准，不因响应字段命名或猜测而双写。
- R6：显式 `page-api` spec 缺少 `apiUrl` 或 `buildPayload` 时，校验和运行时都返回统一 `PddCliError`，不得抛裸异常。
- R7：`40002` 保持“高频或风控拒绝，原因未定”的业务错误语义，不触发限流冷却；错误详情在脱敏边界内保持可诊断。
- R8：保留 `pageSession` sibling page 修复；仅在确认不会破坏合法兼容调用时清理死分支。
- R9：文档和 adapter spec 必须反映 `page-api` 单一路线、响应形状和失败语义。
- R10：按用户选择执行“完整收紧”范围，包括低风险一致性清理；不采纳无证据的 `order_sn` 双写。
- R11：`page-api` 必须继承命令执行上下文的中断信号与剩余截止时间；页面执行异常、无业务码的请求客户端拒绝等传输失败必须映射为稳定的 `E_NETWORK`，超时或主动中断必须映射为 `E_TIMEOUT`，不得退化为 `E_GENERAL` 或 `E_BUSINESS`。
- R12：fixture parity 只有在 endpoint spec 显式声明 fixture 已是服务层形状时，才允许把 live normalizer 拒绝降级为 warning；未声明的 normalize 异常仍必须使诊断失败。

## Acceptance Criteria

- [x] AC1：测试覆盖 `client.post()` 返回已拆包 result、完整成功信封、完整失败信封和未知形状；任何形状都不会把缺失数据静默解释为 0。
- [x] AC2：测试覆盖运行时延迟出现后成功、等待耗尽明确失败、无导航/无 XHR 回退。
- [x] AC3：真实已登录页面验证并记录 list/detail/stats 的请求字段、客户端返回形状和当前 Webpack runtime 全局形态，不记录订单号、Cookie、Anti-Content 等敏感值。
- [x] AC4：错误 `page-api` spec 在 validator 中无效，并在运行时映射为稳定错误码。
- [x] AC5：`40002` 返回 `E_BUSINESS` 且不写入 cooldown；HTTP 429 和已确认限流码行为不变。
- [x] AC6：订单三个端点仍只有 `page-api` 一条生产路线。
- [x] AC7：相关单元、端点、订单 e2e 与全量测试通过；Windows 沙箱权限型失败已在正常权限下复核通过。
- [x] AC8：测试覆盖 `page-api` 无业务码拒绝、Playwright evaluate 异常、截止时间耗尽和主动中断，错误码分别稳定为 `E_NETWORK` / `E_TIMEOUT`。
- [x] AC9：fixture parity 仅对显式 `fixtureIsServiceFacing: true` 的 spec 降级，并覆盖未标记 spec 的失败测试。

## Out Of Scope

- 恢复订单页导航、按钮触发或 XHR 捕获作为回退。
- 为所有站点或所有 Webpack 版本实现通用模块加载器。
- 根据本次探测推算真实历史订单总量、商品销量或订单商品映射。
