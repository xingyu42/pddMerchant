# Design — 巡航改走请求库

## 1. 边界与分层

- **adapter**（`src/adapter/merchant-auth-probe.js`）：新增纯函数 `selectCheckCookiesFromState(state)`，从 storageState 原始 cookie 中按固定 `MERCHANT_CHECK_URL` 做 RFC 6265 匹配，返回冻结的 cookie 列表（结构与 `collectCheckCookies` 输出一致：`{ name, value, domain?, path?, expires?, secure? }` 的子集，至少含 `name`/`value`）。不发请求、不碰浏览器。
- **service**（`src/services/patrol.js`）：`checkLive` 重写为"先请求库探测、按 verdict 决定是否启浏览器"。浏览器启动、`verifyStoredMerchant`、`reloginInCommand` 全部只在 `rejected`/已知 rejected/PASS_ID 缺失时发生。
- 不改 `merchant-auth.js`、`merchant-auth-storage.js`、普通命令 lifecycle。

## 2. 数据流

```text
checkAccount
  -> withMerchantAuthUpdate(accountId)  // 账号租约，取 tx.state
  -> checkLive(runtime, tx, ownerTag)
       if tx.state.merchant_auth.last_check.verdict === 'rejected'
            -> browserRelogin()                       // 不发探测
       else:
            cookies = selectCheckCookiesFromState(tx.state)   // 无浏览器
               (抛 E_AUTH_CANDIDATE_INVALID / 无 PASS_ID) -> browserRelogin()
            result = probeCheckLogin(cookies, { signal, deadlineAt })   // node https
            switch result.verdict:
              'verified'      -> 结束（保留快照，不启浏览器）
              'rejected'      -> recordMerchantCheck(result, tx); browserRelogin(result)
              'indeterminate' -> recordMerchantCheck(result, tx); 结束（不启浏览器、不重登）

browserRelogin(prior?) =
  withBrowser({ storageState: tx.state, ownerTag }, ({ browser, context }) => {
     result = verifyStoredMerchant(context, tx.state, { signal, deadlineAt, expectedMallId: tx.recoveryMallId })
     if result.verdict !== 'verified' recordMerchantCheck(result, tx)
     if result.verdict === 'rejected' await reloginInCommand(runtime, tx, browser, result)
     else assertMerchantVerified(result)   // indeterminate/failed -> 抛，由 checkAccount 记 warn
  })
```

注：`rejected` 走 `browserRelogin` 时会再经 `verifyStoredMerchant`，其内部对已记 rejected 的 state 会短路返回 rejected（`merchant-auth-storage.js:31`），随后 `reloginInCommand`。即请求库的 rejected 与浏览器路径语义一致，不会漏判。

## 3. `selectCheckCookiesFromState` 契约

输入：`state`（storageState）。读 `state.cookies`（数组，缺失/非数组按空处理）。

对固定 `MERCHANT_CHECK_URL = https://mms.pinduoduo.com/janus/api/checkLogin`（host `mms.pinduoduo.com`，path `/janus/api/checkLogin`，scheme https）逐 cookie 过滤：

| 维度 | 规则 |
| --- | --- |
| 域匹配 | `d = cookie.domain` 去前导点小写；host 小写。命中条件：`host === d` 或 `host.endsWith('.' + d)`。cookie.domain 缺失 → 按 host-only，仅 `host === cookie 来源`，本场景按不匹配处理（原始快照均带 domain） |
| 路径匹配 | RFC 6265 path-match：`cookiePath === reqPath`，或 `reqPath.startsWith(cookiePath)` 且（`cookiePath` 以 `/` 结尾，或 `reqPath[cookiePath.length] === '/'`）。cookie.path 缺失按 `/` |
| 过期 | `cookie.expires` 为正数且 `expires * 1000 <= Date.now()` → 剔除；`-1`/缺失（会话 cookie）保留 |
| secure | 目标 https，secure cookie 允许；非 secure 也允许（与浏览器对 https 的行为一致） |
| 同名去重 | 同名多条取路径更长者（RFC 6265 更具体优先）；交给 `buildCheckHeader` 的列表每名唯一 |

输出：`Object.freeze` 的 cookie 列表（每项至少 `{ name, value }`，冻结）。由调用方 `probeCheckLogin` → `buildCheckHeader` 做最终校验（PASS_ID 必须存在、值合法、header ≤64KiB）。选择器本身不抛业务错误；PASS_ID 的缺失/非法由 `buildCheckHeader` 统一抛 `E_AUTH_CANDIDATE_INVALID`。

## 4. 校验与错误矩阵

| 情况 | 行为 |
| --- | --- |
| state 已知 rejected | 跳过探测，直接浏览器重登 |
| 选不出 PASS_ID / cookie 非法（`buildCheckHeader` 抛 `E_AUTH_CANDIDATE_INVALID`） | 捕获后转浏览器重登路径（而非 warn 退出） |
| 探测 `verified` | 结束，不启浏览器，保留快照 |
| 探测 `rejected` | `recordMerchantCheck` + 浏览器重登 |
| 探测 `indeterminate`（http_status/response_shape/tls_error/network_error/timeout/cancelled/deadline） | `recordMerchantCheck` + 结束，不启浏览器、不重登 |
| 账号被占用（`E_LOCK_TIMEOUT`） | 现状不变：记 `patrol_account_busy` 跳过 |
| 账号预算超时 / 取消 | 现状不变 |

## 5. Good/Base/Bad

- Good：会话健在时整轮零浏览器启动；失效时才启浏览器重登。
- Base：请求库 `verified` 只确认 `result.login===true`，不核验店铺绑定；店铺一致性由下一次真实业务命令保证，巡航作心跳足够。
- Bad：把 `indeterminate` 当 rejected 去重登（会在网络抖动时反复启浏览器）；或把请求库 cookie 选择放宽到全站 cookie（违反 `buildCheckHeader` 固定 URL 约束）。

## 6. 测试要点

- `selectCheckCookiesFromState`：前导点域命中、子域命中、无关域剔除、路径前缀命中/不命中、过期剔除、会话 cookie 保留、同名取更长路径、PASS_ID 缺失时输出不含 PASS_ID（下游抛错）。
- 巡航分支（fixture 或注入假 `probeCheckLogin`/`withBrowser` 探针）：`verified` 不调用 `withBrowser`；`rejected` 调用 `withBrowser` 且触发 `reloginInCommand`；`indeterminate` 不调用 `withBrowser` 且 `recordMerchantCheck` 被调用；已知 rejected / PASS_ID 缺失走浏览器路径。
- 不泄密：断言日志与检查记录不含 cookie 实值。

## 7. 兼容与回滚

- 行为对外无新增命令/配置；巡航默认关闭，影响面限于开启巡航后。
- 回滚点：`checkLive` 单函数改动 + 一个新纯函数；回退即还原 `checkLive` 为 `withBrowser`+`verifyStoredMerchant`，删除选择器。
- 角色分工：后端代码由 Codex 经 `codex:codex-rescue` 落地，Claude 审查并更新 spec/文档。
