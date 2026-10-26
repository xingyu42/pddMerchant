# 青果短效代理接入设计

## Architecture Boundary

代理能力位于 adapter 边界。`src/services/goods-publish.js` 继续拥有 Phase A 编排和重试预算；青果模块负责配置校验、调用 `/get`、响应归一化和供应商错误映射；`createConsumerContext()` 接收可选 Playwright proxy 配置。商家端主 context/browser 和后续发布阶段不接触代理配置。

不引入通用 provider 注册表。首版只有青果专用适配器，并向编排层返回稳定的 Source Proxy Lease。

## Configuration

代理启用条件：

```text
PDD_SOURCE_PROXY_PROVIDER=qingguo
```

必需凭据：

```text
PDD_QINGGUO_AUTH_KEY
```

未启用时不读取或校验青果配置。启用后 AuthKey 缺失时在真实网络请求前抛出 `E_USAGE`。AuthKey 不通过 CLI 参数传入。代理节点账号/密码鉴权为可选能力，首版不配置。

## Qingguo Adapter Contract

青果按量接口：

```text
GET https://share.proxy.qg.net/get?key=<redacted>&num=1&distinct=true
```

提取请求超时 10 秒并接收上层 `AbortSignal`。适配器校验 `code === "SUCCESS"`、`data[0].server` 和 `deadline`，将 `server` 按最后一个冒号拆成 host/port，并返回：

```js
{
  provider: 'qingguo',
  server: 'http://host:port',
  expiresAt,
  area,
  isp,
  requestId,
}
```

如果截止时间距离当前不足 30 秒，按临时不可用处理。原始响应不离开 adapter，不写日志。

## Browser Context Contract

`createConsumerContext(browser, options)` 增加可选 `proxy` 输入，并映射到：

```js
browser.newContext({
  ...existingDesktopOptions,
  proxy: {
    server: lease.server,
  },
})
```

每次代理尝试创建、使用并关闭一个桌面 context/page。消费者登录和源商品抓取统一使用 Windows Chromium 桌面 UA 与 `1920x1080` 视口，避免桌面登录态随后切换成 iPhone 环境。仍通过 `storageState` 只读加载 `consumer-auth-state.json`；该函数不调用 `storageState({ path })`，因此不写回公共登录态。

## Retry Data Flow

`publishGoodsFromLink()` 的 scrape 阶段变为单一有界循环：

```text
检查持久冷却与 session health
  -> 如果未启用代理：保留原单次直连路径
  -> 如果启用代理：
       acquire lease
       create fresh consumer context with lease
       scrape source product
       close context
       classify result
       success -> return source
       proxy infrastructure failure and attempts remain -> backoff/acquire fresh lease
       missing price/SKU -> delete consumer auth snapshot and throw immediately
       hard/non-retryable -> throw immediately
```

代理基础设施失败的总尝试次数为 3，退避为 500ms、1000ms。空壳墙、价格或 SKU 缺失均在首次出现后停止，不再提取新代理。成功后继续调用现有 `recordSuccess()`。

## Retry Classification

可重试：

- 青果临时资源不足、申请失败或接口临时网络错误；
- 代理连接超时、拒绝、提前断开或使用前/过程中失效；

立即失败：

- 价格或 SKU 首次缺失，确认消费者账号降级；
- 空壳墙 `fiberFound=false && appWall=true`；
- captcha、slider、risk modal；
- `E_AUTH_EXPIRED`；
- 青果配置、认证、权限、余额和额度错误；
- 用户中断或命令总超时；
- 未分类程序错误。

消费者账号降级不进入全局 `scrape-cooldown.json`。处理流程为关闭本次消费者 context、永久删除当前消费者登录态文件并返回结构化错误；后续必须使用其他消费者账号重新登录。新账号登录成功后允许立即进行一次源抓取。

消费者重新登录成功保存新 auth snapshot 后调用现有 cooldown 的成功重置语义，清除旧账号遗留的源抓取冷却，避免新账号在发出首次请求前被历史状态短路。

## Doctor Boundary

`pdd doctor` 只回答商家端和消费者端登录态是否在线。它不提取青果代理、不打开源商品页，也不检查价格、SKU、空壳墙或账号降级状态。真实抓取能力由 `goods publish --url` 的 Source Product Fetch 阶段判断。

## Errors and Output

青果错误先映射成 `PddCliError`，不改变 envelope 顶层。供应商 request ID 可作为脱敏 detail/verbose 诊断字段；代理节点和凭据永不进入普通输出。

如果第 2 或第 3 次尝试恢复成功，service 向已有 warnings 数组加入 `source_proxy_retry_recovered`。`src/commands/goods/publish.js` 负责像其他返回 warnings 的命令一样，将 service warnings 放入 runner 的保留 `warnings` 通道，由 envelope finalizer 合并到 `meta.warnings`；普通成功业务数据不增加代理字段。

## Compatibility and Rollback

- 未设置 provider 时走原路径，是兼容性与回滚开关。
- 回滚只需移除/取消 `PDD_SOURCE_PROXY_PROVIDER`，不需要迁移账号或登录态。
- fixture 模式在代理配置检查和真实青果调用之前返回，保持离线行为。
- 不增加依赖，使用 Node 18 原生 `fetch`、`AbortController` 和现有 abort helper。

## Accepted Trade-offs

- 用户确认默认不新增自动测试；实现中发现缺陷或现有测试需要适配时再补。
- 同一消费者登录快照只会在代理基础设施失败时经过后续出口；一旦页面返回价格或 SKU 缺失，立即删除登录快照并停止。
- 不做出口预检，以减少短效租约浪费和额外第三方依赖。
