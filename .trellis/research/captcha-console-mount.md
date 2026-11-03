# 官方验证码组件挂到控制台：不可行

调研日期：2026-11-03。结论：**否决**「在 daemon 控制台里挂官方验证码组件，人通过后把 `verifyAuthToken` 送回登录页」这一方案。滑块等验证继续走整页接管。

前置调研：`.trellis/research/archive/2026-11/11-02-login-challenge-research/research/login-challenge-frontend.md`（R3 触发契约、R7 第 3 条「待真机验证」即本题）。

## 方法

- 重新拉取登录页 JS，构建版本仍是 `v20261014203114_88da236a`。只做文本检索阅读，未执行。下载文件放在仓库外的临时目录，用完已删除。
- 向 `https://apiv2.pinduoduo.net/api/phantom/obtain_captcha` 发了 3 个 CORS 预检（OPTIONS），不带请求体、token 和账号。
- 未用真实账号，未触发 `54001`，未调用验证码业务接口。

## 已确认（代码或实测）

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 接口域名 | 写死 `https://apiv2.pinduoduo.net`（测试环境 `apiv2.hutaojie.com`） | `c0` 函数 `k`；模块 `pGHt` 的 `isProduction()` 本构建恒返回 `true` |
| 请求方式 | `fetch(url, { mode: "cors" })`，`Content-Type: application/json`，未设 `credentials`，不带 cookie | `c0` 函数 `b` |
| CORS | 只放行拼多多域名：`Origin: https://mms.pinduoduo.com` 返回 `Access-Control-Allow-Origin` 和 `Allow-Credentials: true`；`http://127.0.0.1:47821` 和任意外部域名不返回 | 预检实测 |
| 预检 | JSON 请求头触发预检；预检拿不到放行头时，浏览器拦截 `/api/phantom/*` 请求 | 同上 |
| `anti_content` | 风控 SDK 打包在 `c0` 里（不从外部加载），采集项包括 `locationInfo`、`referrer`、`fingerprint` | `c0` 函数 `T` / `O` |
| 组件挂载 | `c10` 导出的 React 组件，适配器在 `window` 上监听 `FLOATING_CAPTCHA` 事件，读取事件对象上的 `verifyAuthToken`、`captchaRetry`、`captchaCallback` | `c10` `subscribe` |
| 通过后的 token | `quit(true)` 调用 `callback({ verifyAuthToken })`，传回的是 `54001` 下发的原 token，不换新 | `c0` `quit` |
| 写 cookie | `captchaCallback` 写 `msfe-pc-cookie-captcha-token`（`path=/`，10 分钟），后续请求由 `beforeSend` 放进请求头 `VerifyAuthToken` | `c0` 模块 `7E57` |

## 否决理由

- 挂在控制台域名下，组件的第一个请求（`vc_pre_ck_b`）就被浏览器的 CORS 拦下，界面只会显示「验证资源获取失败」。
- 唯一的绕法是控制台服务端代理 `apiv2.pinduoduo.net`，并改写官方包里写死的接口地址。这违反「不自己组验证码请求」的约定。另外 `anti_content` 会带上控制台的地址，出口 IP 是 daemon 所在机器，浏览器指纹又是另一套。**推断**：三者对不上，容易被判成 `1002`（行为有风险）。

## 可复用

- token 通过验证后不变。daemon 从 `/janus/api/auth` 响应的 `result.verifyAuthToken` 取到它，就能用它关联验证状态。
- 用户确认（2026-11-03）：接管只转播验证码弹窗，不保留整页画面、缩放和工具按钮；短信验证不转播，控制台输入短信码后由 daemon 填进登录页短信弹窗；表单变化、网络错误按结果码结束，不再进入接管。实现与契约见 `.trellis/spec/adapter/browser-runtime.md` 第 10 节和 `.trellis/spec/services/domain-service-contracts.md`。弹窗与短信选择器来自静态调研，待真机确认。
