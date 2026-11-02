# 登录挑战前端调研

调研日期：2026-11-02。未登录，只用 curl 拉取 `https://mms.pinduoduo.com/login/` 及其 HTML 直接引用的 JS，文本检索后阅读。未执行这些文件，未提交账号，未调用登录、短信或验证码接口。下载文件在仓库外的临时目录，未入库。

构建版本：`v20261014203114_88da236a`。静态资源前缀：`https://mms-static.pddpic.com/login/static/js/`。

| 简称 | 文件 | 作用 |
| --- | --- | --- |
| `index` | `index.4962c0b2.chunk.v20261014203114_88da236a.js` | 登录页：账密提交、错误分支、手机验证弹窗、各接口响应 schema |
| `c0` | `0.bfe6899f.chunk.v20261014203114_88da236a.js` | 通用请求库、验证码插件、验证码组件 |
| `c10` | `10.4afbde47.chunk.v20261014203114_88da236a.js` | 组件库；登录页用它挂载验证码弹窗并监听 `FLOATING_CAPTCHA` |

runtime 映射表里其余 chunk（`1`、`2`、`99`、`11`、`13`、`ChatBox`、`ServiceCenter`）与登录挑战无关。三个主文件都在登录页 HTML 里直接加载，不需要再进页面点出来。

标记：**已确认** = 有代码证据；**推断** = 结构推出来的，缺直接调用点；**未找到** = 这批静态资源里没有。

## R2 登录接口

### 请求

**已确认**（`index`，`o.loginHandle`、`o.getLoginParams`、`o.publicKeyPromise`）：

- 账密登录是 `POST /janus/api/auth`。外包直播登录（`liveLoginType === 1`）改走 `POST /janus/api/contractor/login`，本项目用不到。
- 提交前 `GET /janus/api/queryPasswordEncrypt`，响应 schema 要求 `passwordEncrypt`、`publicKey`。密码经公钥加密后放进请求体。
- 请求头 `ETag` 带风控指纹 `riskControlFp`，同一值写入 `localStorage['MMS-LOGIN-FP']`。
- 请求体字段名：`username`、`password`、`passwordEncrypt`、`verificationCode`、`mobileVerifyCode`、`sign`、`touchevent`、`fingerprint`，可选 `captchaType`。`verificationCode` 与 `mobileVerifyCode` 都填短信验证码。`touchevent` 含输入框编辑起止时间、键盘事件、登录按钮点击坐标和时间。

### 成功响应

**已确认**（`index` 内嵌 schema `"/janus/api/auth#POST"`，以及 `o.loginPasswordResolveHandle`）：

- `result.passId`：schema 写明浏览器会同时把这个值 set 进 Cookie。前端另写 `localStorage['PASSID']`。
- `result.userInfoVO`：含 `mallOwner`、`forceMobileVerify`、`mobile`、`username` 等。
- `result.maskMobile`、`result.mobileVerification`（是否已做过手机验证）、`result.inMobileWhiteList`（schema 注「现在都是 true」）、`result.identityVerifyURL`、`result.loginLimitStatus`、`result.loginLimitEffectiveTime`。
- 前端读成功时兼容 `pass_id` / `passId`。

### 错误码

前端用 `error_code` 或 `errorCode`，文案用 `error_msg` 或 `errorMsg`（`o.loginPasswordRejectHandle`）。下表「S」来自 schema 的 `errorCode.description`，「F」来自 reject 分支。

| 码 | 含义 | 前端行为 | 来源 |
| --- | --- | --- | --- |
| `402` | 账密不匹配 | 固定文案「账号密码不匹配。子账号请用账号名登录（不支持手机号登录）」，附「忘记账号名」链接 | F |
| `2000015` | 需要手机验证 | 打开手机验证弹窗，类型 0 | S+F |
| `2000020` | 需要手机验证 | 手机验证弹窗，类型 1 | S+F |
| `2000021` | 子账号登录需要手机验证 | 手机验证弹窗，类型 2 | S+F |
| `2000027` | 需要手机验证 | 无专门分支，显示服务端 `errorMsg` | S |
| `2000017` | 验证码错误 | 固定文案「手机验证码错误」 | S+F |
| `2000018` | 用户未绑定手机号 | 绑定手机弹窗 | S+F |
| `2000014` | weak password | 改密页：「密码强度过低，存在盗号风险」 | S+F |
| `2000016` | 需要修改密码 | 改密页：「系统检测到您的账号异常，存在盗号风险」 | S+F |
| `8000000` | 您登录失败过多，请30分钟后重试 | 显示服务端 `errorMsg` | S |
| `8000037` | — | 实人认证弹窗（微信扫码），按钮「已完成认证 / 登录其他账号」 | F |
| `8000040` | — | 「该账号正在认证审核中」 | F |
| `2000009` | 店铺无法登录 | 显示 `errorMsg` | S |
| `2000025` | 请对接开放平台或登录商家后台/APP | 显示 `errorMsg` | S |
| `40029` | 本账号已成功退店 | 显示 `errorMsg` | S |
| `2000026` | 请重新下载最新客户端 | 显示 `errorMsg` | S |
| `8000009` | 仅支持商家登陆 | 显示 `errorMsg` | S |
| `54001` | 打开验证码 | 见 R3。登录包的 schema 码表里没有这个码，它在请求插件里 | `c0` |

**已确认**：响应即使没有上述错误码，只要 `!mobileVerification && inMobileWhiteList && userInfo.mallOwner`，同样进入手机验证弹窗（类型 0）。

**推断**：码表里没有单独的「密码错误」或「账号不存在」。`402` 的固定文案同时覆盖密码错误和子账号用手机号登录。其余失败文案来自服务端 `errorMsg`，前端不内置。

**已确认**（`c0` 请求库，与验证码插件相邻）：HTTP `403` 且 `error_code === 31012e4` 时整页刷新；HTTP `429` 且 `error_code === 40001` 时跳转登录；`errorCode === 40010` 被权限插件当成失败。

登录表单文案（`index` 的 `zh-CN` 字典）：账号页签「账号登录」，占位「请输入账号名/手机号」「请输入密码」，空值提示「请输入账号！」「请输入密码！」，按钮「登录」。

## R3 验证码（官方组件）

### 触发契约

**已确认**（`c0` 模块 `7E57`，`DEBUG_NAME` 为 `fetch-plugin-captcha`）：

- 插件在通用请求链上。响应 `errorCode === 54001` 时读取 `result.verifyAuthToken`，派发 `FLOATING_CAPTCHA`。
- 事件上的字段：`verifyAuthToken`、`captchaRetry`（重放被拦住的请求）、`captchaCallback`（把 token 写入 cookie）。
- cookie 名 `msfe-pc-cookie-captcha-token`，`path=/`，有效期 10 分钟。之后每个请求的 `beforeSend` 把它放进请求头 `VerifyAuthToken`。
- 请求头里已经带了 `VerifyAuthToken` 又收到 `54001`：先清 cookie，再重新弹出。
- 登录页根组件渲染 `c10` 的验证码入口（`index` 里 `Xn.a`）。`c10` 监听 `FLOATING_CAPTCHA`，记下 token 后显示弹窗。

**推断**：`/janus/api/auth` 与发短信接口都走这条请求链（`index` 的请求函数来自模块 `7E57`，插件在默认链上，且不按 URL 过滤）。因此登录提交和发短信都可能弹出验证码。

人在官方组件里通过后，组件自己完成校验；`captchaCallback` 写 cookie，`captchaRetry` 重放原请求。`anti_content`、行为采集和轨迹计算都在这个组件内部。本报告不记录这些参数和算法。

### 题型与 DOM

**已确认**（`c0` 常量 `ce=1, le=2, ue=3, de=11, fe=22, pe=23, he=24, me=61, ve=71, ge=251, ye=81`，以及按 `type` 分发的 switch）：

| `type` | 组件 | 可见特征 |
| --- | --- | --- |
| `1` `3` | `TextCaptcha` | `captcha-wrapper__text`，占位「请输入上图的验证码」 |
| `2` | `TextCaptcha` | 同上，占位「请输入上图计算结果」 |
| `11` | 点选图组件（无 displayName） | `captcha-wrapper__picture` |
| `22` | `SlideCaptcha` | `#slide-captcha-dialog`，`#slide-button`，文案「请向右滑块完成拼图」 |
| `23` `24` | `SlideMoveCaptcha` | `#slidemove-captcha-dialog`，`#slidemove-button`，同一句滑块文案 |
| `61` | 手势组件（变量 `Ke`，无 displayName） | `captcha-wrapper__gesture` |
| `71` | `RotateSlider` | `captcha-wrapper__rotateslider` |
| `81` | 智能检测（变量 `Ze`，无 displayName） | `#SmartCaptcha`，`captcha-wrapper__smart` |
| `251` | `SmsCaptcha` | `captcha-wrapper__sms`，占位「请输入短信验证码」 |

弹窗不在 iframe 里。`c10` 里的 `iframe` 是 PDF 预览和隐藏工具 iframe，与验证码无关。`type === 251` 时弹窗标题为「安全验证」、宽 378；其他题型的弹窗无标题。`zIndex` 为 `2147483647`。

**已确认**（组件内码表 `W`，第二列 `1` 关弹窗、`2` 刷新题目、`3` 警告）：

| `code` | 界面 |
| --- | --- |
| `0` | 通过，关闭弹窗 |
| `1000` `1001` | 「验证时间过长，请重试」，警告 |
| `1002` | 「系统检测到您的行为有风险，请稍后重试」，警告 |
| `1004` | 「验证频繁，请稍后重试」，警告 |
| `1005` | 「验证失败次数过多，请稍后重试」，警告 |
| `3001` | 「系统繁忙，请稍后重试」，警告 |
| `3002` | 「验证失败，请重试」，刷新题目 |
| `4000` | 「网络异常，请重试」，警告 |
| 其他 / 取题失败 | 「验证资源获取失败, 请重试」或「验证码类型错误, 请联系客服」 |

取题与校验的路径在 `c0` 中出现过：`/api/phantom/vc_pre_ck_b`、`/api/phantom/obtain_captcha`、`/api/phantom/vc_mid_render`、`/api/phantom/vc_mid_cip_b`、`/api/phantom/user_verify`。它们由官方组件调用。后续实现监听 `54001` 和 `FLOATING_CAPTCHA` 即可，不需要自己组这些请求。

## R4 短信

登录页自己的手机验证弹窗和验证码组件里的 `type 251` 是两套 UI。账密登录后的短信走前者。

**已确认**（`index`，类名 `verify-phone-container`）：

- 弹窗 `componentDidMount` 直接调用 `getMessageClickHandle()`。这就是「提交账密后自动发短信」：进入弹窗即发送，没有单独的发送按钮点击。
- 发送：`POST /janus/api/user/getLoginVerificationCode`，体字段 `username`。外包登录改走 `/janus/api/contractor/getLoginVerificationCode`。
- 成功：toast「手机验证码已发送」，60 秒倒计时，按钮文案「还剩N秒」，结束后「获取验证码」。倒计时到 0 且输入框仍空时，提示「若长时间未收到验证码, 您可尝试APP扫码登录」。
- `errorCode === 4000005`：先做人机图形码，通过后再发短信。图形码组件请求 `POST /janus/api/getCaptchaCode`，体 `{ sceneId: 15 }`，响应用 `picture`、`sign`、`captchaType`。弹窗文案「请先输入图形验证码」。
- `errorCode === 41012`：toast「图形验证码错误！」，图形码刷新。
- 其他失败：错误区显示 `errorMsg`，缺省「获取验证码失败！」。
- 提交：`o.verifyMessageSubmit` 要求 `verificationCode` 非空，否则「短信验证码不能为空」，然后再次调用 `loginHandle`（仍是 `POST /janus/api/auth`，带上验证码）。错误码 `2000017` 显示「手机验证码错误」。
- DOM：容器 `verify-phone-container`，标题按类型为「为了您的账号安全，请验证手机号后继续登录」等四句之一，输入占位「请输入短信验证码」，确认按钮「确认」。类名里没有 `sms-verify`。

绑定手机（`2000018`）是另一条路径：发送 `POST /janus/api/mobile/sendVerificationCode/noLogin`（`type: 14`），提交 `POST /janus/api/user/bindMobileByPassword`。图形码 scene 为 `17`，URL `/earth/api/merchant/getCaptchaCode`。

**未找到**：验证码过期、发送过于频繁、次数超限的前端硬编码分支。这些如果存在，会落在「显示 `errorMsg`」。

`o.fetchAuthCode` 也会请求 `getCaptchaCode`（scene 15），但登录包内没有界面调用它。**推断**：登录表单上没有独立的图形验证码输入框；图形码只在发短信返回 `4000005` 时出现。

## R5 其他挑战与 N19 第二次

**已确认**：

- 点选是验证码 `type 11`（`captcha-wrapper__picture`），由 `54001` 打开，不是登录页上的独立页面。包内没有「依次点击 / 点选验证」这句文案。
- 风控确认页选择器对应的类名 `risk-confirm` 未找到。相近的是 `8000037` 实人认证弹窗、`8000040` 认证审核中、`2000014` / `2000016` 改密页。
- `type 251` 的弹窗标题是「安全验证」，会撞上现有 `risk_confirm` 文案正则。该组件同时有「请输入短信验证码」，按现有检测顺序会先落到 `sms`。

**未找到**与 N19 第二次（提交后 90 秒无文案、无挑战元素、未收到短信）一一对应的分支。若当时是滑块，现有滑块文案正则对不上「请向右滑块完成拼图」；`[class*=captcha]` 本应命中 `captcha-wrapper` 并记为 `unknown`。实验没有留下 DOM，不能断定弹窗是否真的出现。待真机再遇时抓响应码。

## R6 与现有识别的对照

对照文件：`src/adapter/password-login.js` 的 `PASSWORD_LOGIN_SELECTORS` / `PASSWORD_LOGIN_TEXTS`，`src/adapter/classify-rate-limit.js` 的 `RISK_CODES`。

### 选择器

| 键 | 结论 |
| --- | --- |
| `passwordTab` | **部分命中**。字典有「账号登录」，`:has-text("账号登录")` 能用。包内没有 `data-testid="login-tab-password"`、`.login-tab-password`，也没有「密码登录」。类名是 `login-tab`。 |
| `loginName` | **命中**。占位「请输入账号名/手机号」，`placeholder*=手机号` 能配上。 |
| `password` | **命中**。占位「请输入密码」。 |
| `agreement` | **未找到**。这批包里没有定位到协议勾选框。 |
| `submit` | **过宽**。按钮文案是「登录」，`button:has-text("登录")` 会连「扫码登录」一类一起命中。包内没有 `data-testid="login-submit"`。 |
| `slider` | **不命中**。没有 geetest 类名。实际是 `#slide-captcha-dialog`、`#slide-button`、`#slidemove-captcha-dialog`。 |
| `click` | **不命中**。没有 `click-captcha` / `geetest_item`。实际是 `captcha-wrapper__picture`。 |
| `sms` | **不命中**。没有 `sms-verify`。登录短信容器是 `verify-phone-container`。 |
| `risk_confirm` | **不命中**。没有 `risk-confirm`。 |
| `unknown` | **会误接滑块**。`[class*=captcha]` 能配上 `captcha-wrapper__slider`。滑块、点选、短信选择器都失败时，滑块被记成 `unknown`。 |

### 文案

| 键 | 结论 |
| --- | --- |
| `account_locked` | **漏**。`8000000` 的文案是「您登录失败过多，请30分钟后重试」，正则只认「登录次数过多 / 账号锁定」。 |
| `wrong_password` | **漏**。`402` 的固定文案是「账号密码不匹配。子账号请用账号名登录（不支持手机号登录）」。这与 N27a 的误判一致：登录名错误被当成未识别验证。 |
| `slider` | **漏**。界面文案是「请向右滑块完成拼图」，对不上「拖动…滑块 / 滑动…验证」。 |
| `click` | **未找到**对应硬编码文案。 |
| `sms` | **命中**。「请输入短信验证码」能被 `请输入.{0,8}短信验证码` 配上。 |
| `risk_confirm` | **部分命中，会误伤**。「安全验证」是 `type 251` 弹窗标题，也出现在「拼多多安全验证」。实人认证和审核中的文案对不上这组正则。 |
| `sms_sent` | **命中**。toast「手机验证码已发送」含「已发送」。倒计时「还剩N秒」有机会配上秒数分支。 |

### `RISK_CODES`

| 码 | 现有分类 | 这批登录包 |
| --- | --- | --- |
| `54001` | `classifyRateLimit` 把它当成限流（`business-54001`）。商品、订单端点把同一码当成「操作太过频繁」 | **登录包里它是打开验证码**，不是限流文案。登录流程若沿用现有分类，会把验证码误报成限流 |
| `70031` | `captcha-required` | **未找到** |
| `10019` | `captcha-required` | **未找到** |
| `52101` | `risk-control` | **未找到** |
| `9501` | `account-restricted` | **未找到** |

`70031` / `10019` / `52101` / `9501` 不在登录页这批 JS 里。它们可能属于别的业务包，本次不能证实，也不能当登录错误码用。

## R7 后续实现建议

按本次约定拆，不改本次任务的代码：

1. **按响应识别登录状态。** 监听 `POST /janus/api/auth`（以及发短信接口）的 `errorCode` / `errorMsg`。`402` 视为账密错误并熔断；`8000000` 视为锁定；`2000015` / `2000020` / `2000021` 以及 `mobileVerification === false` 的店主视为等待短信；`54001` 视为等待人完成官方验证码，不再记成限流。DOM 文案降为兜底。
2. **短信与图形字符码。** 人在控制台输入字符，程序填进原登录页的输入框并提交。短信弹窗打开时页面已经自己发过短信，程序不要再点发送。图形码只在发短信返回 `4000005` 时出现，题图用该次响应里的 `picture`。
3. **滑块及其他手势题（22 / 23 / 24 / 61 / 71 / 81）。** 人在官方组件里完成。程序只把组件写出的 `verifyAuthToken` 送回发起登录的那个会话：cookie `msfe-pc-cookie-captcha-token`，请求头 `VerifyAuthToken`，然后重放被 `54001` 拦住的请求。不做画面转播，不合成轨迹，不自己组 `/api/phantom/*` 请求。

### 待真机验证

- 官方组件挂在控制台源站（不是 `mms.pinduoduo.com`）时，拿到 `verifyAuthToken` 后能否完成验证并把 cookie 送回 daemon 里的登录页。
- `54001` 在账密登录上的实际出现条件。静态代码只证明插件认这个码，没有证明每次登录都会返回它。
- `402` 以外的账密失败是否还有别的 `errorMsg`（服务端文案，包内没有）。
- N19 第二次停住时的响应码。现有选择器对滑块会落成 `unknown` 或一直轮询，单凭代码不能还原那次页面。
- 协议勾选框是否仍在页面上。本次包内未找到。
