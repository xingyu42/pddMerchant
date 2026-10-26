# 商家工作台登录保活静态分析

## 范围与方法

- 样本版本：`pinduoduo/3.6.7.6/Version.ini` 显示 `AppVersion=3.6.7`。
- 只读取 PE 字符串、C++ 符号、前端 bundle 和静态配置。
- 未启动目录内任何 EXE/DLL，未抓取真实账号流量，未修改 `pinduoduo/`。

## 结论

该工作台没有证据表明存在一个单独、固定周期的“登录心跳接口”。它把在线状态拆成三层：

1. 原生登录与账户层建立商家账号上下文。
2. CEF 浏览器层用 `mallcsid`、Cookie、PassID、PDDID 和 `windowsAppShopToken` 恢复商家网页会话，并在工作台与浏览器进程之间双向同步 Cookie。
3. 客服消息层另外获取聊天 token，运行消息同步线程并维持 Titan/IM 连接；连接断开、Cookie 过期为空或账号在别处登录时停止同步。

因此，“重启后仍登录”主要依赖长期 Cookie、Chromium User Data 持久化和账号上下文重新注入；“运行中在线”主要依赖正常业务请求与 IM 同步连接。服务端还可能在普通业务响应里通过 `Set-Cookie` 延长有效期，这种续期由 Chromium 自动处理，不要求客户端出现名为 `RefreshToken` 的专用函数。进程守护、服务器时间校准和验证码 token 都不是主登录保活。

## 启动与登录链路

1. `PDDLauncher.exe` 负责启动/更新协调，`PddWorkbench.exe` 是主宿主。
2. `PddWorkbench.exe` 引用 `PDDLoginSDK.dll`、`PDDAccountBusiness.dll`、`PDDRequest.dll`、`PDDCef.dll`、`PDDH5.dll` 和 `MsgSDK.dll`。
3. 主宿主可取得 `IPDDLoginSDKMgr::GetInstance`，并通过 `CAccountFactory::CreateAccount(LoginBizType, ...)` 建立账户对象。
4. `PDDCef.dll` 的 `PddBrowserManager::NewBrowserProc(...)` 参数包含账号标识、商城名、`PddCookie` 向量和附加 token；`SendInitMessage(...)` 将账号和 Cookie 初始化到浏览器子进程。
5. H5 页面通过 CEF/native bridge 工作，商家网页域为 `https://mms.pinduoduo.com/`。

以上 1-4 为符号和依赖关系支持的高可信链路，但没有反汇编到每个调用点，不能声称已证明完整时序。

## Cookie 与账号状态同步

`PDDCef.dll` 包含成对的 IPC 消息：

- 浏览器到工作台：`Notify_Cookie_Pass_ID`、`Get_Latest_Cookies`。
- 工作台到浏览器：`Set_Cookie`、`Get_Cookie_Pass_ID`、`Set_PDDID_Header`。
- 数据对象与处理函数：`PddCookie`、`GetMMSCookieFromString`、`ResetCookie`、`NotifyGetBrowserCookies`、`CookieWorkbenchSet`、`PassIDStorage`。
- 浏览器按 `mallcsid` 隔离账号；新建浏览器进程时传入 Cookie 集合。
- `func_disable_persist_pdd_cookie_324_26` / `disable-persist-pdd-cookie` 表明程序存在可关闭的 PDD Cookie 持久化策略。按命名推断，默认路径会持久化 Cookie，但具体默认值仍需运行时配置确认。
- 浏览器启动参数包含 `--user-data-dir="{}\User Data"`，并存在 `GetBrowserUserDataPath`，证明 CEF 使用可落盘并在重启后复用的 Chromium Profile。
- `PddBrowserManager::CreatePddBrowser` 附近包含 `PASS_ID=...;Max-Age=864000;path=/;Secure;HttpOnly` 模板。`864000` 秒等于 10 天，至少证明该版本设计中存在长期持久 `PASS_ID`，不是仅随进程存在的 Session Cookie。模板中的值仅是样例/常量，不能当作当前账号凭据。

高可信解释：原生层保存一份账号/Cookie 上下文，CEF Profile 也持久化网页 Cookie；启动、切换账号或浏览器崩溃重建时，工作台重新把 Cookie 和身份头注入浏览器。浏览器拿到更新后的 Cookie 后，再通知工作台同步最新值。`PASS_ID` 是当前静态证据中最接近主身份凭据的字段；`mallcsid` 更像账号/浏览器实例索引，`windowsAppShopToken`、`authToken` 和 `verifyAuthToken` 不能直接等同于主登录 Cookie。

安装目录内未发现实际 Chromium Profile、Cookies、Local Storage 或认证数据库，说明 `User Data` 根路径由运行时参数指向安装目录外。`WorkBenchDB.dll` 中的 `Msg.db` 和 SQL 表是按账号保存聊天记录、会话、序列号，不是登录凭据库。本机常见 AppData 目录也未定位到可确定属于该样本版本的运行时 Profile，因此实际凭据文件路径尚未确认。

## 消息在线与连接保活

`XiaoerChatControl.dll` 有以下强证据：

- `CXiaoerSyncThread::Start`、`CXiaoerSyncThread::SyncMessageThread`。
- `/chats/getToken?`、`/janus/api/auth`、`/space/user/login`。
- `%s GetToken Failed.`、`Cannot request, titan disconnected`、`SyncMessage network Failed.`。
- `func_xiaoer_other_login_stop_sync_33820`、`overdue_with_empty_cookie`、`cookie is empty`、`loginStatus`。

这说明客服消息模块先取得聊天 token/认证，再运行同步线程；Titan 连接断开、取 token 失败、Cookie 过期为空或检测到异地/其他端登录时会停止同步。`MsgSDK.dll` 的 `CMChatImpl::GetConnect`、会话管理和异步定时任务符号进一步支持独立 IM 连接的存在。

没有找到明确的产品级 `heartbeat`、`ping/pong`、固定重连间隔或主登录 token 刷新函数。因此可以确认“有持续同步连接和断线检测”，但不能仅凭当前静态证据断言具体心跳包、发送周期或自动重连次数。

## 失效与恢复

已确认的失效信号：

- Cookie 为空或过期：`overdue_with_empty_cookie`。
- 账号在别处登录：`other_login_stop_sync`。
- IM/Titan 连接断开：`titan disconnected`。
- 聊天 token 获取失败：`GetToken Failed`。
- CEF 网络服务或 WebView 崩溃：浏览器管理器具有 `NeedRecoverBrowser`、`ReCreateWebView`、`NewBrowserProc` 等恢复能力。

恢复分两类：

- 浏览器进程/WebView 故障：工作台可用现存账号和 Cookie 重建浏览器，这属于会话恢复，不是重新登录。
- 服务端认证真的失效：当前样本没有找到明确命名的 `RefreshToken`、`AutoLogin` 或静默重新登录函数，但这不能排除服务端在普通业务响应里更新 `PASS_ID` 等 HttpOnly Cookie。只有当长期 Cookie 不再被接受且普通响应也没有续期时，才会停止相关同步并进入登录 SDK/UI。

## 容易误判的线索

- 前端 `verifyauthtoken` 在风控错误后写入 `localStorage.__VerifyAuthToken__` 和 `sessionStorage.mms-pc-captcha-storage-token`，再随 MMS 请求重试；它是验证码/风控 token，不是主登录 token。
- 前端 `refreshServerTime()` 每 31 分钟校准服务器时间，不是登录保活。
- `PDDAccountBusiness.dll` 的 `OpenProcessToken` / `GetTokenInformation` 是 Windows 进程权限 API，不是服务端登录 token 刷新。
- `PDDWBGd.exe` 通过 `\\.\\pipe\\PddWorkbenchPipe` 监测主进程，它是进程守护，不是账号会话保活。
- `TKInfo.ini` 的固定 `Token2` 更像安装、渠道或完整性配置，不能当作账号 token。

## 关键证据位置

- `pinduoduo/3.6.7.6/PddWorkbench.exe`：登录 SDK、账户工厂、CEF/H5、请求和消息 SDK 依赖及符号。
- `pinduoduo/3.6.7.6/PDDCef.dll`：Cookie/PDDID IPC、账号隔离、浏览器恢复和 Cookie 持久化开关。
- `pinduoduo/3.6.7.6/PDDAccountBusiness.dll`：账户对象、商家请求字段和聊天 token 接口线索。
- `pinduoduo/3.6.7.6/XiaoerChatControl.dll`：聊天认证、同步线程、断线/过期/异地登录停止同步。
- `pinduoduo/3.6.7.6/PDDWBGd.exe`：命名管道守护主进程。
- `pinduoduo/3.6.7.6/Plugins/web/web_19.20.0/view/xiaoerweb/vendor~1774b48a.bundle.82fb92282077e3306b5c.js:10343`：验证码 token 注册、存储、请求头注入和风险重试。
- `pinduoduo/3.6.7.6/Plugins/web/web_19.20.0/view/xiaoerweb/vendor~1774b48a.bundle.82fb92282077e3306b5c.js:10504`：31 分钟服务器时间校准。
- `pinduoduo/3.6.7.6/WorkBenchDB.dll`：`Msg.db` 和聊天会话表，排除其为认证库。

## 尚未确认

- Cookie/Profile 的准确磁盘路径和加密方式。
- 主登录 Cookie 的服务端有效期、续期条件和具体 Cookie 名。
- 服务端是否通过普通业务响应周期性下发新的 `Set-Cookie`，从而形成滑动过期。
- Titan/IM 心跳包格式、周期、退避和重连次数。
- 登录 SDK 在认证失效时是否存在某些无明文符号的静默恢复分支。

若需要把这些盲区变成确定结论，下一步应在隔离测试账号上做受控动态观察：记录进程创建参数和文件访问、比对登录前后 AppData 差异、查看工作台自身日志，并只观察请求时序与状态码，不导出或展示真实 Cookie 值。

## 对当前 pdd-cli 的直接帮助

当前项目已经有一套方向正确的刷新机制：

- `src/adapter/auth-refresher.js` 打开商家首页，请求一个带 Cookie 的 MMS 接口，然后调用 `saveAuthState()` 把浏览器中的最新 Cookie 写回 JSON。
- `bin/pdd-daemon.js` 默认每 `600000ms`、附加 `120000ms` 抖动执行一次刷新；认证命令成功后还会尝试自动启动 daemon。

但代码核验发现两个会缩短或掩盖实际登录寿命的问题：

1. `heartbeat()` 使用默认自动跟随跳转的 `fetch()`，只检查最终 HTTP 状态。若认证接口跳转到登录页并最终返回 200，当前逻辑会把它当成 `heartbeat ok`，跳过 `isAuthValid()`，保存旧状态并记录伪成功。`result.status === 302` 在默认自动跟随跳转时通常无法捕获真正的中间 302。
2. 普通业务命令从 `auth-state.json` 创建临时 browser context，成功后直接关闭。业务请求期间若服务端重新下发了长期 Cookie，更新只存在于该临时 context，当前 `single-lifecycle.js` 没有在关闭前调用 `saveAuthState()`，因此续期结果会丢失。

本机只读验证还显示：daemon 当前未运行，最后状态记录停在 2026-07-19；现存 `PASS_ID` 文件到期时间在 2026-07-28，但实时 `doctor --json` 已被重定向到商家登录页并返回 `E_AUTH_EXPIRED`。这证明本地 Cookie 的 `expires` 尚未到期不等于服务端仍接受该会话，也说明不能靠修改 JSON 中的到期时间延长登录。

推荐修复顺序：

1. 先修 heartbeat 判定：返回并检查 `resp.redirected`、`resp.url`、状态和业务响应，登录跳转必须判失败并进入完整校验。
2. 在成功的认证业务命令结束前，采用带锁且能处理并发快照的方式回写最新 `storageState`，让真实业务流量获得的 `Set-Cookie` 不丢失。
3. 检查 daemon 自动启动和存活恢复，避免状态文件仍写着 `refreshed`、实际进程已经停止。
4. 在确认 Cookie 到期时间确实会向后移动前，不调整 10 分钟刷新周期；更高频请求不一定更有效，反而会增加网络和风控负担。
