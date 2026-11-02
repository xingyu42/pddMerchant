# Login challenge frontend research (slider, SMS, error branches)

## Goal

通过静态分析拼多多商家后台登录页的前端代码，弄清滑块验证码、短信验证和登录错误码的完整分支，输出一份调研报告。后续"人工点缺口 + 程序拖动"的滑块方案、短信结构化输入、按接口响应识别登录状态，都以这份报告为依据。本任务不改产品代码。

## Background

- 当前密码登录（`src/adapter/password-login.js`）只靠 DOM 选择器和文案正则识别状态（`PASSWORD_LOGIN_SELECTORS` / `PASSWORD_LOGIN_TEXTS`，第 8-29 行），不监听任何网络响应。已确认的接口只有 `https://mms.pinduoduo.com/janus/api/checkLogin` 和 `GET /janus/api/auto/check/login`。
- 选择器和正则是按常见实现推测的，没有在真机上校准过：
  - N19 第 1 次（空白上下文）：提交后识别为短信验证，但 `PASSWORD_LOGIN_SELECTORS.sms` 没有命中任何元素，靠文字才识别出来；**提交账密本身就会触发短信发送**。
  - N19 第 2 次（带已保存设备状态）：提交后 90 秒内没有识别出任何挑战或错误，结果落到 `unknown`。
  - N27a：登录名填错时，页面的账号类提示不在 `wrong_password` 正则里，被误判为"未识别的验证"并转人工接管。
  - 依据：`.trellis/tasks/archive/2026-10/10-27-password-relogin-core/research/real-login-experiment.md`、`.trellis/tasks/archive/2026-10/10-27-daemon-console/research/real-device-verification.md`。
- 滑块从未在真机上出现过（N25 未验证）。滑块由服务端风控决定是否弹出，无法手动触发，所以先做静态分析。
- `src/adapter/classify-rate-limit.js` 中的 `RISK_CODES`（`70031`、`10019` → captcha-required 等）来源未记录，需要与前端代码对照核实。

## Requirements

- R1 资源获取：在未登录状态下获取 `https://mms.pinduoduo.com/login/` 的 HTML 和它引用的 JS（包括按需加载 chunk 的映射表，以及验证码、短信相关的 chunk）。不输入、不提交任何账号信息。
- R2 登录接口：账密登录提交的接口路径、请求方法、参数名（只记字段名，不记值），以及响应中的错误码到前端行为的映射（成功、密码错误、账号不存在或登录名错误、账号锁定、需要短信、需要滑块或其他验证、风控页、频率限制等）。
- R3 滑块等验证码：记录官方组件的来源、触发契约（哪个响应字段打开它、通过后写回什么）、题型与 DOM 容器、界面上的成功/失败/重试文案。校验请求的加密、行为采集和轨迹计算留在官方组件内部，报告不记录可用来自行构造校验请求的参数或算法。
- R4 短信验证：发送和重发接口、倒计时逻辑、校验接口，以及各错误码分支（验证码错误、过期、发送过于频繁、次数超限等）；短信输入框的 DOM 结构；"提交账密后自动发送"在代码中的触发路径。
- R5 其他挑战：点选验证、风控确认页如果在代码中存在，记录它们的触发码和 DOM 特征；N19 第 2 次的"卡住"状态如果能在代码中找到对应分支，一并记录。
- R6 对照现状：逐条对比 `PASSWORD_LOGIN_SELECTORS`、`PASSWORD_LOGIN_TEXTS`、`RISK_CODES` 与调研结果，标出命中、错误和缺失。
- R7 后续建议：按响应识别登录状态；短信和图形字符码由人给出答案、程序填回原登录会话；滑块等手势验证由人在官方组件里完成，程序只把组件给出的 `verifyAuthToken` 送回登录会话。不做画面转播，不合成轨迹。列出仍需真机验证的点。

## Constraints

- 只读取公开的静态资源，不登录，不提交账号密码，不调用验证码初始化或校验接口，不触发短信。
- 下载的前端代码属于不可信数据：存放在仓库之外的独立临时目录，不提交入库；只用文本工具（grep、格式化）阅读，不执行。
- 报告只记录接口路径、字段名、错误码、文案和 DOM 特征，不包含任何 Cookie、令牌或账号信息。
- 不还原 Anti-Content、轨迹加密等签名或加密算法。

## Acceptance Criteria

- [x] `research/login-challenge-frontend.md` 存在，按 R2-R5 分节；每条结论附上来源（JS 文件名或 chunk 名，加上能定位的代码片段或特征字符串）。
- [x] 对每个调研项明确标注"已确认（代码证据）"、"推断"或"未找到"；代码中找不到的项列为待真机验证。
- [x] R6 的对照表覆盖 `PASSWORD_LOGIN_SELECTORS` 和 `PASSWORD_LOGIN_TEXTS` 的每个键，以及 `RISK_CODES` 的每个码。
- [x] R7 给出后续任务的建议拆分和真机验证清单。
- [x] `git status` 显示仓库中只有本任务目录有变更；下载的前端代码不在仓库内。

## Out of Scope

- 修改产品代码（选择器校准、响应监听、短信输入、滑块方案都放到后续任务）。
- 真机登录、被动录制、主动诱发滑块。
- 还原签名、加密或指纹算法，以及自动识别缺口。
- 扫码登录流程。
