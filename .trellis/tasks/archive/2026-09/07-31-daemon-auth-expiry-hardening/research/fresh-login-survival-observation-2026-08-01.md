# 新登录后的商家会话存活机制观察（2026-08-01）

## 结论

当前证据支持一个分层模型，而不是“定时调用某个 heartbeat 即自动续期”：

1. `PASS_ID` 是必要的主商家身份 Cookie。新登录后它是 `HttpOnly`、`Secure` 的 10 天持久 Cookie；当前首页 bundle 直接读取并解析它以取得 mall/user 身份。仅在临时 Context 删除它后，官方 `checkLogin` 立即从 `result.login:true` 变为 `false`，页面进入登录流程。
2. `windows_app_shop_token_23` 是 24 小时持久 Cookie，但当前首页 bundle 未发现其使用点；它更接近工作台集成 token，不能单凭名称当作主网页登录续期凭据。
3. 首页和正常业务流量会更新 `JSESSIONID`、`x-visit-time`、`mms_b84d1838` 等辅助状态。其中 `x-visit-time` 是页面挂载时写入的 100 天访问标记，不是主登录续期证据。
4. 本轮 `/home` 和只读订单请求都没有改变 `PASS_ID` 或工作台 token。尚无动态证据证明普通业务响应会立即延长主登录 Cookie。
5. 服务端仍可在本地 Cookie 到期前撤销会话。旧状态中 `PASS_ID` 到期时间在未来，但 `/home` 已进入 `/login/`，直接证明本地 expires 不是最终存活判据。
6. 当前 daemon 选择的 Janus 裸 GET 不是有效会话的成功 heartbeat：新登录会话返回 `40010`，空 Context 返回 `43001`。它能识别完全无会话，却不能为有效会话产生成功结果。
7. 当前网页真正的认证验活是自然发出的 `POST /janus/api/checkLogin`：有效 Context 返回 HTTP 200、`success:true`、`errorCode:1000000`、`result.login:true`；临时删除 `PASS_ID` 后仍返回业务成功外壳和同一错误码，但 `result.login:false`。必须按该 endpoint 的 `result.login` 判定，不能套用“非零 errorCode 即失败”。
8. `POST /janus/api/heartbeat/v2` 虽然名字含 heartbeat，当前 bundle 却把它放在 `InjectionDetect` 模块：检测页面注入/扩展特征，最多按 1 秒重试 5 次后上报一次。75 秒空闲首页观察只出现一次，因此它不是登录续期心跳。

因此，当前 daemon 的安全描述只能是“周期认证验活与浏览器状态快照”。它不能被描述为已证实的服务端续期机制；在当前真实响应下，其既有 heartbeat 成功并写回 auth-state 的分支对有效会话不可达。

## 安全边界

- 所有动态观察使用匿名账号标签，不记录账号 slug、显示名、mall ID 或 auth-state 路径。
- 不记录 Cookie 值或指纹、请求头值、`Anti-Content`、响应正文、`error_msg`、订单内容或订单数量。
- 只执行自然 `/home` 流量、项目现有 Janus GET、空 Context 对照、一次 `pageSize=1` 的正常只读订单请求，以及只在临时 Context 删除 `PASS_ID` 的失效对照。
- 探针不调用 `saveAuthState()`；每轮都验证原 auth-state revision 未变化。
- 失效对照拦截并原样转发页面自然发出的 `checkLogin`，只记录响应字段名、布尔值和错误码；没有注销服务端会话，也没有写回删 Cookie 后的 Context。
- daemon 在受控观察期间保持停止，避免后台请求和写回混入结果。

## 观察时间线

### T0：新登录与 daemon 首轮

- 新登录完成时间约为 `2026-08-01 02:53`（Asia/Shanghai）。
- 登录成功后 daemon 自动启动并立即执行首轮。
- `/home` 可正常保持在 `/home`，证明新会话被商家首页接受。
- daemon 裸 GET 返回 HTTP 200、`success:false`、`error_code:40010`，记录为 `heartbeat_rejected`，没有保存 auth-state。
- daemon 随后被停止；停止命令最终确认 `running:false`。

### T0 Cookie 基线

| Cookie | 本轮观察 | 解释边界 |
| --- | --- | --- |
| `PASS_ID` | `HttpOnly`、`Secure`，约 10 天 | 必要的主身份 Cookie；到期时间不等于服务端承诺，也不证明它单独充分 |
| `windows_app_shop_token_23` | `Secure`，约 24 小时 | 工作台集成线索；主登录作用未确认 |
| `JSESSIONID` | Session Cookie | 由自然白名单检查更新 |
| `x-visit-time` | 页面访问时更新，约 100 天 | 访问标记，不是登录续期 |
| `mms_b84d1838` | 到期时间随页面运行向后移动 | 首页导航/白名单辅助状态，主认证作用未确认 |
| `_a42`、`_bee`、`_f77`、`rckk`、`ru1k`、`ru2k` | 约一年 | 风控/设备状态候选，不能等同主登录 |

## 官方工作台的持久化边界

本机安装的 `PddWorkbench.exe`、`PDDCef.dll` 和 `XiaoerChatControl.dll` 均为文件版本 `3.6.7.6`，产品名为“拼多多商家工作台”，公司为上海寻梦信息技术有限公司，Authenticode 状态均为 `Valid`。因此它们是高可信的官方程序样本，而不是来源不明的第三方工具。

签名样本的静态符号与字符串支持以下重启恢复链路：

- CEF 使用带 `User Data` 目录的持久 Chromium Profile，而不是每次创建完全空的浏览器。
- 原生工作台与 CEF 之间存在 `PASS_ID`、PDDID 和 Cookie 的双向 IPC，同一账号的浏览器重建时可重新注入已保存状态。
- 样本内有 `PASS_ID` 的 10 天 `Max-Age` 模板和可关闭 Cookie 持久化的功能开关。
- 客服模块另外获取聊天 token 并维持 Titan/IM 同步；IM 在线、断线或异地登录信号属于消息层，不能替代主商家认证判定。

这能高可信证明“工作台为什么重启后常常仍登录”：它保存的浏览器 Profile 和原生账号上下文比 pdd-cli 的 Playwright `storageState` 更完整。当前 pdd-cli 只持久化 Cookie 与 origin/localStorage，不保存完整 CEF Profile、sessionStorage、缓存或工作台原生账号上下文。

但静态样本不能证明这些本地材料会延长服务端有效期，也不能证明持久化开关的当前远端默认值、`PASS_ID` 的服务端 TTL 或具体滑动续期条件。工作台恢复能力更强，不等于服务端会话不会提前撤销。

## Janus 对照

目标：`/janus/api/informSeller/queryInformSellerTabList`。

| Context | 请求形状 | 响应 | 结论 |
| --- | --- | --- | --- |
| 新登录会话 | GET、无 body、无 `anti-content` | HTTP 200、`success:false`、`40010` | 有效会话也失败，不能作为成功 heartbeat |
| 完全空 Context | 同一 GET | HTTP 200、`success:false`、`43001` | 可以识别无会话/明确过期 |

当前 endpoint 来源可追溯到提交 `0a211d7`。该提交直接新增 URL 和裸 GET，并把 HTTP 2xx 当成功；提交内容没有附带 endpoint 契约、真实请求样本或 fixture 证据。当前首页自然加载的 33 个脚本中没有发现 `queryInformSellerTabList` 或 `/janus/api/informSeller/` 字符串。

这说明本任务虽然正确修复了“HTTP 200 + 43001 不得写回”的安全缺陷，但保留了一个更早的基础假设：所选接口可以为有效会话返回成功。动态对照已经否定该假设。

### 当前网页的认证验活

首页自然触发 `POST /janus/api/checkLogin`，请求 body 为 `{}`，并带页面请求客户端生成的 `anti-content`。连续三轮新登录 Context 均稳定观察到该请求：

| Context | HTTP/业务外壳 | endpoint 结果 | 页面行为 |
| --- | --- | --- | --- |
| 新登录 Context | 200、`success:true`、`errorCode:1000000` | `result.login:true` | 保持在 `/home` |
| 同一临时 Context 删除 `PASS_ID` | 200、同一业务外壳与错误码 | `result.login:false` | 进入登录流程；其他接口出现 `43001` |
| 完全空 Context | `/home` 最终进入 `/login/` | 首页不会自然触发 `checkLogin` | 登录页 `new/userinfo` 返回 `43001` |

当前 `_app.js` 与动态行为一致：页面启动时执行一次 `checkLogin`，并在 `focus`、`load`、hash 变化及内部监听事件触发时复查，最短间隔 2 秒；只有 `login === false` 才跳转登录页。它是事件驱动的认证验活，不是固定周期续期。

`checkLogin` 的有效和临时失效响应都没有下发 Cookie。它能证明请求时刻的 Merchant Session Validity，但本轮没有任何证据表明该请求会执行 Merchant Session Renewal。

### 名为 heartbeat 的注入检测

首页还自然触发 `POST /janus/api/heartbeat/v2`，但它不属于登录状态逻辑：

- bundle 将它置于 `InjectionDetect` 模块，body 字段 `m`/`p` 来自页面 DOM 和 IPC/注入特征，`t` 是时间，`c` 是随时间生成的校验字段。
- 检测到特征时立即上报；未检测到时每秒重试，最多 5 次后以空特征上报。
- 页面位置变化会重置检测；静置首页 75 秒只观察到一次请求，约在加载后 7.6 秒出现。
- 该请求没有下发 Cookie，不能用来证明或实现主登录续期；daemon 不应重构或伪造其 body。

## 首页自然流量

首页自然触发 `/pluto/whitelist/check`：

- GET，无 body。
- 请求头包含 `anti-content`、Cookie 和浏览器标准头；本报告不记录任何头值。
- 响应 HTTP 200、`success:true`，同时 `errorCode:1000000`。
- 响应下发 `JSESSIONID`。

两个边界由此得到直接证明：

1. 页面请求客户端会为正常请求补充风控头，裸 `fetch()` 不等价。
2. 平台成功响应可以同时包含非零 `errorCode`；“任何非零业务码都失败”不能脱离 endpoint 契约泛化。对 `checkLogin`，最终判据是 `result.login`；`success:false + 43001` 仍是明确过期证据。

## 正常只读业务请求

使用项目现有 `orders.list` adapter 发起一次 `pageSize=1` 请求：

- 实际方法为 POST，JSON body，只记录了字段名和 220 字节长度。
- 请求头包含 `anti-content`，证明它通过页面请求客户端而不是裸 fetch。
- 请求成功；未记录订单、数量或响应正文。
- 临时 Context 中 `JSESSIONID` 值发生变化，`x-visit-time` 和 `mms_b84d1838` 的到期时间向后移动。
- 唯一观察到的 `Set-Cookie` 来自并行的 `/pluto/whitelist/check`，名称为 `JSESSIONID`；订单接口本身没有下发 Cookie。
- `PASS_ID` 与 `windows_app_shop_token_23` 均未变化。
- 原 auth-state 文件保持不变；正常 CLI runner 若成功执行同类命令，会把 Context 的最新 storageState 条件写回。

该结果证明“成功业务命令写回 storageState”确实能保存浏览器运行期间发生的辅助 Cookie 更新，但本轮没有证明这些更新会延长主服务端会话。

## 当前首页 bundle 证据

- `x-visit-time`：`useEffect` 中执行 `document.cookie="x-visit-time="+Date.now()+";max-age=8640000;path=/"`。`8640000` 秒等于 100 天，是访问时间标记。
- `PASS_ID`：请求/运行时工具从 Cookie 读取 `PASS_ID`，按 `_` 分段解析 mallId/userId；日志脱敏规则也单独覆盖 `PASS_ID`。
- `mms_b84d1838`：作为 `whitelistCookie` 和导航配置常量读取；当前片段没有证明它是主登录凭据。
- 当前加载脚本未发现 `windows_app_shop_token` 或专用 `RefreshToken`；已找到 `checkLogin` 的事件驱动验活逻辑和 `heartbeat/v2` 的注入检测逻辑。

## 证据分级

### 高可信直接证据

- 新登录 `/home` 有效，旧登录本地 Cookie 未到期但 `/home` 已进入登录页。
- `PASS_ID` 新登录后的 10 天属性、工作台 token 的 24 小时属性。
- Janus 裸 GET 的新登录 `40010` / 空 Context `43001` 对照。
- 官方 `checkLogin` 的有效 `result.login:true` / 临时删除 `PASS_ID` 后 `result.login:false` 对照，以及页面随即进入登录流程。
- `heartbeat/v2` 的 bundle 调用逻辑与 75 秒单次请求时序。
- 首页白名单检查和订单请求实际方法、请求头名称、业务成功分类与 Cookie 名称变化。
- 33 个当前加载 bundle 的完整响应扫描结果，以及 `x-visit-time`/`PASS_ID` 代码片段。

### 中等可信推断

- `windows_app_shop_token_23` 主要服务于桌面工作台集成。名称和 24 小时属性支持该解释，当前网页调用点未找到。

### 尚未确认

- `PASS_ID` 是否在接近到期时、特定业务响应或官方工作台运行期间滑动续期。
- `windows_app_shop_token_23` 的刷新来源、是否影响网页主会话，以及 24 小时到期后的行为。
- 服务端主动撤销会话的全部条件，包括异地登录、风控和账号安全策略。
- 官方工作台 CEF persistent User Data 相比 pdd-cli storageState 对实际登录寿命的增益。
- Titan/IM 在线是否会间接触发主登录 Cookie 更新；当前只确认它是独立连接层。

## 决策与实现结果

2026-08-01 已接受“自然 `checkLogin` 验活”边界：

- daemon 在 `/home` 导航前安装 observer，只观察页面自然发出的同域 POST `checkLogin`，不再调用旧 Janus 裸 GET，也不调用或重构 `heartbeat/v2`。
- HTTP 2xx 且 `result.login:true` 返回 `auth_valid` 并保存浏览器状态快照；`result.login:false` 或主 frame 进入登录页返回 `auth_expired`。
- 缺失、超时、非 JSON、非布尔或非 2xx 返回 `auth_check_inconclusive`，不写回、不冒充过期。
- 保留 8–12 分钟调度抖动，不增加点击、订单查询或其他业务流量；所有文案明确“快照不等于服务端续期”。

没有选择“只看首页”，因为它不能直接表达 HTTP 200 下的 endpoint 认证结果；没有选择正常业务 endpoint，因为会增加真实业务读取和平台副作用。

实现后的受控生产单轮调用返回 `{"success":true,"reason":"auth_valid"}`。该轮没有输出账号、Cookie、路径、header 或响应正文；daemon 验证后仍保持停止。目标测试、帮助基线和全量测试均通过，长期决策记录于 `docs/adr/0003-use-natural-checklogin-for-merchant-auth-checks.md`。
