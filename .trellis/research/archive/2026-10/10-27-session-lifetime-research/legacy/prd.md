# 巡航改走请求库（会话存活轻量探测）

> 本任务原为"会话短寿根因调研"。根因调研的证据承接已完成，结论是**离线无法区分 H1/H3/H4、真机多天对照 ROI 低**，记录在 `research/cross-ref-pinduoduo-findings.md`，不在本任务继续。本任务收窄为该调研得出的、可落地的一项改动：把巡航的会话检查改走请求库。

## Goal

巡航每轮对每个账号做一次**轻量存活探测**：只用请求库（`node:https` 直连 `checkLogin`）判断登录态是否还在，不每轮启动 Chromium。只有探测判定 `rejected`（或本地已知 rejected / 凭据缺失）时，才启动浏览器做店铺核验与重登。

动机（见 research 笔记）：
- 日常普通命令本来每次都在 node https 与 Chromium 之间交替；巡航每 30 分钟再拉起一整个浏览器，收益低、开销大。
- 官方工作台按通道分发凭据，H1（同票跨指纹出口触发风控）为合理怀疑；巡航少发一路重型浏览器请求，与该怀疑方向一致。

## 背景与现状

- 现状 `src/services/patrol.js` 的 `checkLive`：每轮 `withBrowser` 启动 Chromium → `verifyStoredMerchant(context, tx.state, …)`，后者内部先 `collectCheckCookies(context)` 从浏览器 cookie jar 取 checkLogin 的 cookie，再 `probeCheckLogin`（node https）+ `probeMerchantShop`（Chromium）。`rejected` 时 `reloginInCommand(runtime, tx, browser, result)`。
- 请求库侧已具备无浏览器能力：`probeCheckLogin(cookies, { signal, deadlineAt })`（`src/adapter/merchant-auth-probe.js`）接受 cookie **列表**、不依赖浏览器。唯一的浏览器依赖是 `collectCheckCookies(context)` 用浏览器 cookie jar 做 URL/域/路径/过期筛选。
- `tx.state` 是 Playwright storageState：`{ cookies: [{name,value,domain,path,expires,secure,…}], origins, merchant_auth }`。原始 cookie 都在里面。

## Requirements

- N1 新增一个从 `tx.state` 原始 cookie 中按固定 URL（`MERCHANT_CHECK_URL`）筛选 checkLogin cookie 的纯函数，复刻浏览器的 RFC 6265 匹配（域匹配含前导点、路径前缀、未过期、https 下 secure 允许），输出交给现有 `buildCheckHeader` 校验。
- N2 巡航 `checkLive` 改为：先无浏览器 `probeCheckLogin`；`verified` 直接结束（保留快照、不启浏览器）；`rejected` 才启动浏览器走现有店铺核验 + `reloginInCommand`；`indeterminate`（网络/TLS/超时/响应异常）本轮跳过并按现有逻辑 `recordMerchantCheck`，不重登。
- N3 保留现有短路：`tx.state.merchant_auth.last_check.verdict === 'rejected'` 时跳过探测，直接进浏览器重登路径；cookie 选不出 PASS_ID（`buildCheckHeader` 抛 `E_AUTH_CANDIDATE_INVALID`）时同样进浏览器重登路径。
- N4 行为边界与现状一致：被占用账号（`E_LOCK_TIMEOUT`）记 `patrol_account_busy` 并跳过；账号预算 `ACCOUNT_BUDGET_MS` 不变；巡航默认关闭不变；fixture 路径（`checkFixture`）不变。
- N5 不记录凭据实值；探测只写时间、verdict、reason，与现有 `recordMerchantCheck` 一致。

## Acceptance Criteria

- [ ] `verified` 轮次不启动 Chromium（可用 fixture/单测断言未调用 `withBrowser`）。
- [ ] `rejected` 轮次启动 Chromium 并走 `reloginInCommand`，重登成功后快照与现状一致。
- [ ] `indeterminate` 轮次不启动浏览器、不重登、按现状记录检查。
- [ ] 已知 rejected 或 PASS_ID 缺失时直接进浏览器重登路径。
- [ ] cookie 选择器对固定 URL 的域/路径/过期匹配有单测覆盖（含前导点域、路径前缀、过期剔除、PASS_ID 缺失）。
- [ ] 请求库探测不记录凭据实值。
- [ ] `npm test` 全量通过；巡航相关测试覆盖上述分支。

## Out of Scope

- H1–H5 的真机对照观察（研究已记录为离线不可闭合、需要时再上真机）。
- H1 可控实验（统一校验与业务出口后观察失效间隔）——留作后续可选任务。
- 修改普通命令、doctor、login 的校验路径；本任务只动巡航。
- 任何保活/续期机制的实现。
