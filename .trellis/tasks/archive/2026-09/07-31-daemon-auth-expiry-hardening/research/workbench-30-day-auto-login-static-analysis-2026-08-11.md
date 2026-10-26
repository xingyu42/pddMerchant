# 商家工作台“30 天内自动登录”静态分析

## 结论

`tmp/pinduoduo/3.7.0.14` 中没有证据支持把“30 天内自动登录”简单理解为“把网页主身份 Cookie `PASS_ID` 直接改成 30 天”。当前最合理的解释是“较长期的自动恢复授权 + 较短期的网页会话”，但服务端换票步骤仍需动态对照确认。

当前证据最支持以下分层模型：

1. 二维码登录 UI 提供一个默认勾选的“30 天自动登录”选项；该控件的具体 SDK 回调被 VMProtect 隐藏。
2. 勾选后，服务端很可能签发或允许客户端保存一个长于普通网页 Cookie 的“自动恢复授权”。该授权的请求字段、返回字段和换票接口被 VMProtect 保护，本轮静态分析尚未恢复。
3. 工作台很可能把账号恢复材料交给受保护的 `LoginDataMgr` 数据层保存；该数据层同时使用 SQLite、OpenSSL 加密入口和设备 GUID。
4. 下次启动时，`PDDCef.dll` 会按 `mallcsid` 向 Workbench delegate 取回店铺名、Cookie 列表和 `window-app-shop-token`，再把这些材料通过 `Attach_To_Browser` 消息附着到浏览器账号上下文；浏览器端会创建对应账号对象并把 Cookie 逐条写入 Chromium CookieManager。
5. 浏览器会反向读取当前 Cookie，筛出商家域名下的 `PASS_ID`，再把 `CookieWorkbenchSet`、`PassIDStorage` 和 `mallcsid` 回传给 Workbench；也能主动请求“最新 Cookie”，网络服务崩溃时还会通知 Workbench 进入恢复路径。
6. 当前版本在静态默认配置下给浏览器加入 `disable-persist-pdd-cookie`；浏览器端处理该标记时不为注入 Cookie 计算持久过期时间。这说明 PDD 专用 Cookie 的主要恢复责任更偏向 Workbench 原生层，而不是单纯依赖 Chromium Cookie 数据库。
7. 浏览器最终仍使用较短期的网页 Cookie 访问 `mms.pinduoduo.com`。若 30 天授权确实能静默换票，换到的新 `PASS_ID` 仍可只有约 10 天属性。

因此，界面里的“30 天”更像“30 天内允许本机静默恢复/重新建会话”，不是“同一枚 `PASS_ID` 必然有效 30 天”，也不是定时心跳把 Cookie 到期时间延长到 30 天。

## 样本可信度与边界

- 样本主版本为 `3.7.0.14`；`Version.ini` 的产品版本为 `3.7.0`。
- `PddWorkbench.exe`、`PDDLoginSDK.dll` 和 `PDDCef.dll` 的 Authenticode 均为 `Valid`，签名主体为上海寻梦信息技术有限公司。
- 本轮只读取资源、PE 元数据、导入/导出、静态字符串，并把样本作为数据加载到 IDA 反编译；未运行任何样本 EXE/DLL，未读取或输出真实 Cookie、账号或 token。
- 安装包内没有实际 `Cookies`、`Local State`、`Login Data`、`Config.ini` 或账号数据库；真实运行时落盘内容不在本样本目录内。

## 直接证据

### 1. 30 天选项只属于二维码登录

`Xml.zip::Login.xml`：

- `Login.xml:26`：`OpQRCode`，文本“扫码登录”，默认选中。
- `Login.xml:28`：`OpPSW`，文本“账号登录”。
- `Login.xml:121-123`：账号密码模式另有 `SavePwd` 和 `AutoLogin`。
- `Login.xml:126`：二维码区域 `QRCodeArea`。
- `Login.xml:149`：`ChkQRAutoLogin30Days`，文本“30天内自动登录”，`selected="true"`。

这证明该选项是二维码登录专用开关，而且默认开启；它不是账号密码模式的普通“记住密码/自动登录”。

`Skin.zip::Login.xml.bak:100-105` 只有旧的 `SavePwd` / `AutoLogin`，没有 30 天二维码开关，说明当前 UI 对二维码登录增加了单独的时限语义。

### 2. 登录 SDK 与本地登录数据层被保护

- `PDDLoginSDK.dll` 只有 `IPDDLoginSDKMgr::GetInstance()` 等少量接口符号，主体位于 `.vmp0` / `.vmp1`，具体二维码请求和选项处理被 VMProtect 隐藏。
- `PddWorkbench.exe` 延迟导入 `IPDDLoginSDKMgr::GetInstance()`、`CreateLoginDataMgr()`、`IUserCenter::GetInstance()` 和 CEF/账号模块。
- `PDDDataLogic.dll` 导出 `CreateLoginDataMgr()` / `DestroyLoginDataMgr()`，并导入 `sqlite3_prepare_v2`、OpenSSL `EVP_EncryptFinal_ex`、`DeviceSDK::GetAllGUID()`。
- IDA 读取 `IPDDLoginSDKMgr::GetInstance()`（`0x18000DC20`）和 `CreateLoginDataMgr()`（`0x18003BC30`）入口时均得到连续零字节；这不是普通反编译失败，而是保护壳在运行时才重建代码/映射。Workbench 中对应导入名也位于 `.vmp1` 且没有静态代码交叉引用。

这些依赖支持“登录恢复材料被本地数据库保存，并经过加密/设备信息处理”，但不能仅凭导入函数断言具体表结构、密钥派生方式或保存了哪一种 token。若要恢复勾选框字段、服务端接口或本地表结构，继续做普通静态反编译已经没有收益，必须转向运行时脱壳/内存快照或隔离环境动态对照。

### 3. 启动时会把原生账号状态附着到 CEF

`PDDCef.dll`：

- `0xB0080`：`windows-app-shop-token`。
- `0xB00B8`：`browser_cmdline::GenerateEncryptedCmdline`。
- `0xB04F0` 附近宽字符串：浏览器命令模板包含 `--mall-csid`、`--browser-ipc-channel`、`--guid`、`--user-data-dir="{}\User Data"` 和 `--profile-directory`。
- `0xD5178`：浏览器初始化数据字段 `window-app-shop-token`。
- `0xD59C0`：启动结束日志只记录 `windowsAppShopTokenMD5`，说明该 token 会进入浏览器启动链。
- `PddBrowserManager::AttachToBrowserProc`（`0x180030480`）：以 `mallcsid` 调用 delegate，取回 `mallname`、`vector<PddCookie>` 和 `window-app-shop-token`，组装 JSON 后发送消息 `9`。
- Workbench -> Browser 枚举函数（`0x180020760`）：消息 `9` 明确是 `Attach_To_Browser`；消息 `7`、`12`、`13` 分别是 `Set_Cookie`、`Get_Cookie_Pass_ID`、`Set_PDDID_Header`。
- `browser_cmdline::GenerateEncryptedCmdline` 所在函数（`0x1800042E0`）：把 `windows-app-shop-token` 和 `pddid` 放进加密命令数据；配置项 `func_disable_persist_pdd_cookie_324_26` 的静态默认值为开启，开启时加入 `disable-persist-pdd-cookie`。
- `0xDD190` 起：`Config.ini`、`PDD\PDDData`、`PersonalFolderPath`、`SOFTWARE\PddWorkbench` 和公共文档 fallback 路径字符串。

这证明真实账号不是只等 Chromium 自己从 Cookie 数据库恢复。Workbench delegate 会按账号提供恢复材料，再通过 IPC 把原生账号上下文附着到浏览器；持久 Profile 是其中一层，但不是唯一一层。

### 4. 工作台与浏览器双向同步 Cookie

`PDDCef.dll`：

- `0xD03F0`：`BrowserToWorkbenchMessage::Notify_Cookie_Pass_ID`。
- `0xD0428`：`BrowserToWorkbenchMessage::Get_Latest_Cookies`。
- `0xD0AC8`：`WorkbenchToBrowserMessage::Set_Cookie`。
- `0xD0BB8`：`WorkbenchToBrowserMessage::Get_Cookie_Pass_ID`。
- `0xD0BE8`：`WorkbenchToBrowserMessage::Set_PDDID_Header`。
- `0xD61B8` / `0xD61D0`：`CookieWorkbenchSet` / `PassIDStorage`。
- `0xD66B0`：`PddBrowserManager::ResetCookie`。

IDA 反编译进一步确认了消息方向和载荷：

- Browser -> Workbench 枚举函数（`0x1800200B0`）：消息 `8`、`9`、`14` 分别是 `Notify_Cookie_Pass_ID`、`Get_Latest_Cookies`、`Notify_Network_Service_Crashed`。
- `PddBrowserManager::HandleDataWithoutAccount`（`0x180037230`）：收到消息 `8` 时解析 `CookieWorkbenchSet`、`PassIDStorage`、`mallcsid` 并调用 delegate；收到消息 `9` 时仅传入 `mallcsid`，由 delegate 提供最新 Cookie；收到消息 `14` 时调用网络服务崩溃恢复回调。
- `PddBrowserManager::NotifyGetBrowserCookies`（`0x180031CB0`）：携带 `mallcsid` 发送消息 `12`，向浏览器请求 Cookie/PASS_ID。
- `PddBrowserManager::SetPddID`（`0x18003A370`）：发送消息 `13` 和 `pddid`。
- `PddBrowser::ResetCookie`（`0x180028F50`）：序列化 Cookie 的 `domain`、`expires`、`name`、`path`、`scheme`、`value`、`http_only`、`secure`，连同 `mallcsid`、`reason` 发送消息 `7`。

`pddbrowser104/chrome.dll` 的自定义 PDD 代码也包含 `SetWindowsAppShopToken`、`SetInterceptorParams`、`PassIDStorage`、`Notify_Cookie_Pass_ID`、`Set_Cookie` 和 `Get_Cookie_Pass_ID`，与原生侧 IPC 成对对应。

#### 4.1 旧版 Chrome 浏览器端闭环

为避免 186 MB 的 Chromium 104 主库扩大分析面，本轮先对较小的 `pddbrowser/chrome.dll` 做了 IDA 反编译。其 PDD 多账号源码路径仍保留为 `chrome/browser/pdd/account_browser_biz.cc` 和 `chrome/browser/pdd/ipc_helper/ipc_helper_multi_account.cc`，并与 `PDDCef.dll` 的消息编号完全对应：

- Workbench 消息分派函数（`0x181D74B8C`）把消息 `7`、`9`、`12`、`13` 分别交给 `HandleSetCookie`（`0x181D73228`）、`HandleAttachToBrowser`（`0x181D73765`）、`HandleGetStorageCookiePassId`（`0x181D727E8`）和 `HandleSetPddIdHeader`（`0x181D729AA`）。
- `HandleAttachToBrowser` 解析 `mallcsid`、店铺信息、URL、Cookie 列表和 `window-app-shop-token`，创建独立账号对象，保存 token 与 Cookie，并把 `profile-directory` 设为该账号标识；无界面启动时还会加入 `silent-launch`。
- 账号初始化回调（`0x181D6B3F0`）调用 `0x181D6B696`，后者把已缓存 Cookie 交给 `0x181D6BB3C`。`0x181D6BB3C` 取得该账号 Profile 的 CookieManager，逐条构造 Cookie 并调用 CookieManager 写入接口，结果回调为 `0x181D6D150`。这证明 `Attach_To_Browser` 携带的 Cookie 最终确实进入浏览器，而不只是留在 IPC JSON 中。
- `0x181D6BB3C` 同时读取命令行解析出的 `disable-persist-pdd-cookie` 标记。标记开启时，Cookie 构造使用零过期参数；未开启时才按当前时间加 Cookie 的 `Max-Age` 计算绝对过期时间。该实现与“禁止浏览器持久化 PDD Cookie、由 Workbench 重启时重新注入”的模型一致。
- `HandleSetCookie` 按 `mallcsid` 找到账号对象并调用同一个逐条写入函数；`reason` 为 `reset` 时使用专门完成回调。空账号、空 Cookie 列表和账号对象不存在都有显式错误分支。
- `HandleGetStorageCookiePassId` 只调用 `0x181D6D232`；该函数取得当前账号的 CookieManager，并注册回调 `0x181D6D2EA`。回调遍历 Cookie，只接受 `mms.pinduoduo.com` / `mms.htj.pdd.net` 下名为 `PASS_ID` 的项，随后把完整 Workbench Cookie 集作为 `CookieWorkbenchSet`、把选中的值作为 `PassIDStorage`，连同 `mallcsid` 通过浏览器消息 `8` 回传。
- token 设置函数（`0x181D64DEA`）把 `window-app-shop-token` 保存到账号对象；请求头构造函数（`0x181D6AE1C`）只对内置 PDD 相关域名集合添加 `windows-app-shop-token`，并在全局 `pddid` 存在时同时添加 `pddid`。因此该 token 是浏览器请求身份材料的一部分，但现有静态证据仍不能证明它本身就是 30 天根授权。

旧版库没有新版 `NetworkServiceCrashed` / `RefreshCookieForNetworkServiceCrashed` 路径。`pddbrowser104/chrome.dll` 中存在 `persist_pdd_cookie`、`RefreshCookieForNetworkServiceCrashed`、`Notify_Network_Service_Crashed`、`SendGlobalIpcToWorkbench` 和对应多账号 IPC 字符串，只能静态确认新版增加了网络服务崩溃后的 Cookie 恢复通道；具体触发时机仍未反编译确认。

### 5. 30 天不是现有 PASS_ID 模板的 Max-Age

`PDDCef.dll:0xD5280` 包含一条内置 `PASS_ID` 示例 Cookie（值已省略），属性为 `Max-Age=864000; Secure; HttpOnly`。`864000` 秒等于 10 天。IDA 交叉引用确认该字符串只用于 `PddBrowserManager::CreatePddBrowser`（`0x1800314C0`）创建名为 `StaticPddBrowser` 的内部引导浏览器；真实账号随后走 `AttachToBrowserProc` 的 delegate 取数路径。因此，这个 10 天模板连“真实账号当前 Cookie TTL”都不能单独证明，更不能拿来反驳或证明 30 天授权。

当前样本的 `PDDLoginSDK.dll`、`PDDDataLogic.dll`、`PddWorkbench.exe`、`PDDAccountBusiness.dll` 和 `PDDWorkbenchData.dll` 中均未找到明文整数 `2592000`（30 天秒数）或 `2592000000`（30 天毫秒数）。

Chromium 库中虽然出现 `max-age=2592000`，但相邻字符串是 `application/dns-message`、`gzip, deflate, br`、`max-age=604800` 等通用网络测试/响应头常量；另一个 `OlderThan30Days` 属于“清除浏览数据”统计。它们与商家登录无关，不能作为 30 天登录证据。

### 6. 既有脱敏动态观察仍只证明短期网页状态

2026-08-01 的项目内脱敏观察记录：

- 新登录 `PASS_ID` 属性约 10 天。
- `windows_app_shop_token_23` Cookie 属性约 24 小时。
- `/home`、`checkLogin` 和一次只读业务请求都没有观察到 `PASS_ID` 延期。

所以 `windows_app_shop_token_23` 这枚网页 Cookie 本身也不像完整的 30 天根凭据。若 30 天能力真实存在，更可能还有受保护的原生恢复材料，或该短期 token 能由更长期授权轮换取得。

## 证据分级

### 已证实

- 当前官方签名样本明确提供默认勾选的二维码专用“30 天内自动登录”。
- 工作台有受保护的登录 SDK、本地登录数据管理器、持久 CEF User Data、每账号上下文和 Cookie/token IPC。
- Workbench 会按账号向 delegate 取回 Cookie/token 并通过 `Attach_To_Browser` 注入；浏览器端已确认会创建账号对象、逐条写入 Cookie、读取并回传 PASS_ID/Cookie 状态，也能接受后续重置。
- 静态默认配置会关闭浏览器侧 PDD Cookie 持久化，浏览器端会相应取消注入 Cookie 的持久过期时间；内置 10 天 `PASS_ID` 模板属于 `StaticPddBrowser` 引导路径，Chromium 中的 30 天常量也与商家登录无关。
- 重启恢复与网页 Cookie 生命周期是两层机制，不能把二者混为一谈。

### 最可能但尚未静态证明

- 勾选框会作为二维码登录参数参与服务端授权。
- 服务端返回一个最多 30 天可用于静默恢复的可信设备/自动登录授权。
- 工作台用该授权在启动时换取或重建短期网页会话，再由已确认的 `Attach_To_Browser` / `Set_Cookie` IPC 注入 CEF。

### 尚未确认

- 勾选框对应的准确请求字段、endpoint 和响应字段。
- 30 天授权的真实载体、磁盘文件、数据库表、加密格式和设备绑定算法。
- 30 天是绝对上限、滑动窗口，还是仅表示客户端在该窗口内尝试自动恢复。
- 自动恢复时是否会重新签发 `PASS_ID`，以及 `windows-app-shop-token` 在换票中的准确角色。
- 取消勾选后，客户端是否完全不落盘长期授权，还是只改变服务端授权期限。

## 对现有 pdd-cli 结论的影响

此前“商家会话只有约 10 天固定 TTL，客户端不存在其他续期/换票通道”的结论需要降级为“网页 `PASS_ID` 当前观察约 10 天，网页自然请求未发现续期”。当前 3.7.0.14 官方客户端明确暴露 30 天自动登录能力，并已静态确认存在网页 `storageState` 不包含的 Workbench delegate 取数、Cookie/PASS_ID 双向同步、网络服务崩溃恢复和启动 token 链路。

这不证明 pdd-cli 现在就能复刻 30 天自动登录，也不支持直接修改 Cookie `expires`。它只说明后续研究重点应从伪 heartbeat 转向“二维码登录 SDK 的长期授权与启动换票链”，同时继续保留 `checkLogin` 作为验活，而不是续期接口。

## 最小动态验证建议

若后续允许在隔离环境、测试账号上运行官方客户端，建议做“勾选/取消勾选”双组对照，只记录字段名、文件名、时间和是否变化，不记录任何凭据值：

1. 对比二维码获取、扫码确认和登录成功请求的 endpoint、字段名与响应字段名。
2. 对比 `PersonalFolderPath` 下新增/变化的文件，以及 `SOFTWARE\PddWorkbench` 的键名变化。
3. 对比登录后浏览器启动参数中 token 是否存在，以及相关 Cookie 名称/到期属性。
4. 在临时副本中重启客户端，观察是否发生静默换票请求和新的 `Set-Cookie` 名称。
5. 只有观察到旧 `PASS_ID` 失效后仍能凭另一授权取得新 `PASS_ID`，才能确认“30 天授权换票”模型。
