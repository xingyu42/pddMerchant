# 登录状态按响应识别（修正 402/8000000/54001 误判）

## Goal

让密码登录流程从接口响应判断结果，修正现有按 DOM 文案识别造成的误判，在该交人工时准确地交人工。本任务只做识别与分类，不新增任何验证码处理机制，不改动界面。

## Background

依据调研报告 `.trellis/tasks/11-02-login-challenge-research/research/login-challenge-frontend.md`（代码证据均在其中，本 PRD 不复述验证码内部机制）。

现状问题（`src/adapter/password-login.js`、`src/adapter/classify-rate-limit.js`）：

- 登录结果只靠 DOM 选择器和文案正则识别，不读接口响应。
- `402`（账密不匹配/子账号用手机号登录）的页面文案匹配不上 `wrong_password`，被误判为「未识别的验证」转人工（N27a 实证）。
- `8000000`（登录失败过多，30 分钟后重试）匹配不上 `account_locked`。
- `54001` 在登录流程里表示打开人机验证码，而 `classify-rate-limit.js` 把它当成限流。
- 滑块选择器基于 geetest 猜测，与实际 DOM 对不上，滑块会落成 `unknown`。

登录结果经 `attemptPasswordLogin`（`src/adapter/password-login.js`）→ `recordReloginOutcome`（`OUTCOMES` 状态机，`src/services/password-relogin.js`）落库；人工接管由 daemon console 既有能力承载（ADR 0003），本任务不改接管流程。

## Requirements

- R1 响应识别：登录提交阶段监听 `POST /janus/api/auth` 的响应，读取 `errorCode`/`errorMsg`（兼容 `error_code`/`error_msg`），据此判定结果；DOM 文案降为兜底。
- R2 修正误判：
  - `402` → 账密错误（映射到 `wrong_password`，熔断，不占接管窗口）。
  - `8000000` → 账号锁定（映射到 `account_locked`）。
  - `54001` → 等待人工完成官方验证码（视为 challenge，不记为限流、不记为 `unknown`）。
  - 需要手机验证类（`2000015`/`2000020`/`2000021`，以及响应满足「未手机验证的店主」）→ 等待人工（短信），维持现有 `awaiting_human` 语义。
- R3 `54001` 归类：登录路径不把 `54001` 交给 `classifyRateLimit` 当限流处理；不改动商品/订单端点对同一码的既有限流语义。

## Constraints

- 不还原、不驱动、不自行构造验证码 SDK 请求；不合成操作；不跨会话转移令牌。
- 遵循分层 `commands → services → adapter → infra` 与 envelope/错误契约。
- 不打印 cookie、令牌、密码等敏感值（`REDACT_KEYS`）；错误 detail 不含 PII。
- 响应监听复用现有 `page.on('response')` / xhr 机制，不引入新依赖。
- 不改 daemon console、接管流程、前端。

## Acceptance Criteria

- [x] `402`、`8000000`、`54001` 在登录流程里分别落为账密错误、账号锁定、等待人工（challenge），有针对性 fixture 测试覆盖。
- [x] 需要手机验证类错误码识别为 `awaiting_human`，不再因文案匹配失败落成 `unknown`。
- [x] 登录路径对 `54001` 的处理与商品/订单端点的限流语义互不影响，有测试区分两者。
- [x] 响应识别失败时仍走现有 DOM 文案兜底，行为不回退。
- [x] 契约 v2 测试与相关单元/e2e 通过；`git diff` 范围限于登录响应识别与 `54001` 归类。

## Out of Scope

- 短信、图形字符码的人工中转（另开任务）。
- 滑块/手势验证码的任何处理；界面与接管流程改动。
- 驱动或重实现官方验证码组件、`/api/phantom/*`。
- 商品/订单等非登录路径的 `54001` 限流语义变更。
