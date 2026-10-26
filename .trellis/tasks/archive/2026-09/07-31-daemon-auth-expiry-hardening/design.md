# Design: daemon 自然认证验活

## 1. Boundary

变更限制在商家 daemon 认证链路：

```text
pdd-daemon
  -> refreshAuth()
  -> install natural checkLogin observer
  -> navigate /home
  -> result.login classification
  -> auth_valid: save browser state snapshot
  -> auth_expired / inconclusive: do not save
```

不修改消费者登录、普通业务命令的 revision-safe auth-state 保存，也不增加平台业务请求。`/janus/api/heartbeat/v2` 是注入检测，不进入此链路。

## 2. Observer Lifecycle

observer 必须先于 `/home` 导航安装，匹配条件同时包含：

- hostname 严格等于 `mms.pinduoduo.com`；
- pathname 严格等于 `/janus/api/checkLogin`；
- request method 严格等于 `POST`。

observer 只解析目标响应的 JSON 并读取布尔 `result.login`。首个畸形目标响应不应提前产生成功；允许在 deadline 内继续等待后续合法目标响应。主 frame 进入 `/login` 可立即产生明确过期结果，避免失效响应触发重定向后 body 已不可读的竞态。

成功、过期、超时、中断、导航异常和显式 dispose 都必须移除 `response`、`framenavigated`、AbortSignal listener 并清理 timer。observer 从安装时开始使用 `TIMEOUTS.XHR_COLLECTOR`，避免 `/home` 导航后再叠加一个无界等待。

## 3. Result Contract

`refreshAuth()` 返回稳定、非敏感结果：

| 观察结果 | 返回值 | 保存快照 | 人工登录 |
| --- | --- | --- | --- |
| HTTP 2xx + `result.login === true` | `{ success:true, reason:'auth_valid' }` | 是 | 否 |
| HTTP 2xx + `result.login === false` | `auth_expired` | 否 | 是 |
| 主 frame 最终进入 `/login` | `auth_expired` | 否 | 是 |
| 缺失、超时、非 JSON、非布尔、非 2xx | `auth_check_inconclusive` | 否 | 否，后续重试 |
| 已中断 | `aborted` | 否 | 否 |
| 浏览器/导航异常 | `network_error` | 否 | 否 |

`success`、`errorCode` 与 `error_code` 只属于响应外壳，不能作为 `checkLogin` 的通用成功判据。有效和失效实测都可能是 HTTP 200、`success:true`、`errorCode:1000000`。

## 4. Snapshot And Compatibility

只有 `auth_valid` 分支在现有 auth-state 锁内调用 `saveAuthState(..., { skipLock:true })`。保存内容仍是 Patchright `storageState`，用于保留页面运行产生的 Cookie/origin/localStorage 变化；它不等于服务端延长 `PASS_ID` 或 Merchant Session Renewal。

现有 `refreshAuth()` 函数名以及 `refreshIntervalMs`、`lastRefreshAt`、`refreshCount` 状态字段为兼容保留。新的成功 reason 为 `auth_valid`，多账号聚合结果为 `multi_account_check`，日志和文档不再使用 `refreshed`、`heartbeat_rejected` 或“自动续期”。

## 5. Daemon Observability

- `auth_expired` / `auth_missing`：需要人工重新登录。
- `auth_check_inconclusive` / `network_error` / `lock_timeout` / `aborted`：本轮检查失败或不可判定，可重试，不宣称登录一定失效。
- daemon 状态文件只保存稳定 reason、时间和计数，不保存响应正文或身份材料。

## 6. Risk Decision

默认调度继续使用 8–12 分钟抖动。自然 `checkLogin` 已由当前首页代码生成正确 method、body 和 `Anti-Content`；项目只旁路观察响应，不重放、补签或伪造业务流量。

若后续要研究服务端滑动续期、官方工作台 persistent Profile 或长期时间序列，应另立任务。当前实现只证明检查时刻的 Merchant Session Validity。
