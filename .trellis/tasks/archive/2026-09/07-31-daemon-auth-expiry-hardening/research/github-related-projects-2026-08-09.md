# GitHub 商家会话与持久浏览器项目调研（2026-08-09）

## 结论

GitHub 上能找到多个 PDD 商家后台项目，但没有一个项目提供以下完整证据：

1. PDD 商家主会话的官方 refresh/renew endpoint；
2. 主 `PASS_ID` 的 `Set-Cookie` 或到期时间持续后移；
3. persistent profile、页面刷新或业务请求相对空白对照显著延长服务端接受时间；
4. 跨越当前约 10 天 Cookie 属性窗口的可复现实验。

最完整的 PDD 项目也只是：复用 persistent User Data 打开商家首页，页面未跳登录时导出当前 Cookie；收到 `43001` 后再次尝试该流程，失败则重新登录。它把这一动作命名为 Cookie “刷新”，但源码没有调用服务端续期接口，也没有证明 Cookie TTL 被延长。

对当前 `pdd-cli` 最有价值的 GitHub 结果不是一个可直接搬入的“保活项目”，而是四组可以组合的设计：

- PDD 行为参考：`zhinianboke/pdd-auto-reply` 的“持久 Profile -> 验活 -> 明确过期后重登”状态转换。
- daemon 基线：Microsoft Playwright 自己的 detached daemon、命名管道/socket 判活和 persistent profile 占用检查。
- CDP 恢复：`browser-use/browser-use` 把 WebSocket 断线重连与 Chrome 进程崩溃分成不同状态。
- Profile 单写者：`browser-gateway/browser-gateway` 的 token lease、stale TTL、finally release 和原子持久化。

推荐继续执行上一份研究的顺序：**先修 daemon 真实跨周期和 stale-state 确认，再实现隔离 persistent profile 试验底座，最后做长期 A/B/C/D 对照。** GitHub 调研没有提供跳过长期对照的证据。

## 工具与检索边界

- 当前 Codex 工具集中没有 `grok-search`，本轮改用 GitHub 官方 CLI、GraphQL/API、仓库源码和固定 commit permalink。
- 仓库检索式包括：`拼多多 商家后台`、`拼多多 商家`、`pinduoduo merchant`、`mms.pinduoduo.com`、`PASS_ID`、`launchPersistentContext`、persistent browser session、CDP reconnect 和 auth re-login。
- `gh search repos '拼多多 商家后台'` 返回 11 个仓库；`gh search repos '拼多多 商家'` 返回 18 个仓库。只保留实际有认证/Profile/重登代码的候选。
- GitHub code-search 配额在多组检索后耗尽，因此本报告不是 GitHub 全量证明。入选项目均进一步读取固定 commit 源码；“没有发现”只表示本轮范围没有证据，不表示私有代码或未索引代码绝对不存在。
- stars、默认分支、许可证和 commit 日期来自 2026-08-09 的 GitHub GraphQL/API 快照；stars 只用于描述关注度，不作为正确性证据。
- 全程未读取或输出 Cookie、账号、密码、header、`Anti-Content` 或响应正文，也没有运行任何外部项目。

## PDD 专项项目

### 1. `zhinianboke/pdd-auto-reply`

- 仓库：[zhinianboke/pdd-auto-reply](https://github.com/zhinianboke/pdd-auto-reply)
- 固定版本：`61dac37fb6c329ca397c8bb03d274421254b1498`
- 快照：95 stars；默认分支 `main`；最后 commit `2026-06-11`；AGPL-3.0。
- 判定：**最相关，但只有客户端恢复/重新登录，没有服务端续期证据。**

关键实现：

- [`refresh_with_user_data()`](https://github.com/zhinianboke/pdd-auto-reply/blob/61dac37fb6c329ca397c8bb03d274421254b1498/websocket/login/playwright_login.py#L285-L328) 使用账号独立 User Data 启动 persistent context，访问 `/home`，未跳转登录页时调用 `context.cookies()` 导出当前 Cookie。
- [`refresh_pdd_cookies()`](https://github.com/zhinianboke/pdd-auto-reply/blob/61dac37fb6c329ca397c8bb03d274421254b1498/websocket/channel_pdd/pdd_login.py#L167-L198) 将上述结果标成在线或需要重新登录。
- [`relogin_pdd()`](https://github.com/zhinianboke/pdd-auto-reply/blob/61dac37fb6c329ca397c8bb03d274421254b1498/websocket/channel_pdd/pdd_login.py#L247-L289) 先尝试 persistent profile，失败且保存了密码时回退账号密码登录。
- [请求层过期处理](https://github.com/zhinianboke/pdd-auto-reply/blob/61dac37fb6c329ca397c8bb03d274421254b1498/websocket/channel_pdd/core/base_request.py#L254-L299) 在会话过期后调用重登并只重试一次。
- [Cookie 更新路由](https://github.com/zhinianboke/pdd-auto-reply/blob/61dac37fb6c329ca397c8bb03d274421254b1498/websocket/routes/cookies.py#L49-L103) 更新加密存储，不在响应中返回原 Cookie。

可借鉴：账号级状态机、过期后只重试一次、失败转入明确重登、持久 Profile 与导出 Cookie 分层。

不可照搬：

- “页面没有在短超时内跳登录”弱于当前 endpoint-specific `checkLogin.result.login`。
- 函数名和日志把 Cookie 导出称为“刷新”，会继续混淆本地快照与服务端续期。
- 自动保存账号密码和自动密码登录扩大凭据风险，不属于当前已确认需求。
- AGPL-3.0 可能影响项目分发边界，只能研究机制，不能直接复制代码。

### 2. `am-stars/pddshangjiahuotai`

- 仓库：[am-stars/pddshangjiahuotai](https://github.com/am-stars/pddshangjiahuotai)
- 固定版本：`316201afaaa54455035eb4ebfb2dca55a048a419`
- 快照：1 star；默认分支 `feature/pdd-mcp-v1`；最后 commit `2026-07-21`；无许可证。
- 判定：**最接近 persistent profile 试验架构，但认证真值弱于当前实现，且不可复制源码。**

关键实现：

- [BrowserSessionManager](https://github.com/am-stars/pddshangjiahuotai/blob/316201afaaa54455035eb4ebfb2dca55a048a419/src/browser/browser-session-manager.ts#L220-L245) 先取得跨进程 profile lease，再用账号 `userDataDir` 启动 headed `launchPersistentContext()`。
- [会话刷新](https://github.com/am-stars/pddshangjiahuotai/blob/316201afaaa54455035eb4ebfb2dca55a048a419/src/browser/browser-session-manager.ts#L700-L745) 重新执行 DOM/session probe，并对风险状态使用 fail-closed latch。
- [Session probe](https://github.com/am-stars/pddshangjiahuotai/blob/316201afaaa54455035eb4ebfb2dca55a048a419/src/browser/session-probe.ts#L200-L232) 依赖商家 host、可见后台壳和店铺身份。

可借鉴：每账号 persistent profile、跨进程 lease、Profile Registry、风险状态不因一次干净 DOM 自动清除。

不可照搬：DOM shell/店铺身份只能证明页面看起来已加载，不能替代当前自然 `checkLogin`；仓库没有 LICENSE，源码默认保留全部权利。

### 3. `shao-11/PDD-Merchant-Helper`

- 仓库：[shao-11/PDD-Merchant-Helper](https://github.com/shao-11/PDD-Merchant-Helper)
- 固定版本：`e508bccbec85a4671d709b8c1cb31d793f6c771a`
- 快照：1 star；最后 commit `2026-06-15`；无许可证。
- 判定：**明确否决。**

[定时 pulse](https://github.com/shao-11/PDD-Merchant-Helper/blob/e508bccbec85a4671d709b8c1cb31d793f6c771a/src/keep-alive/scheduler.ts#L159-L234) 使用隐藏 tab、reload、mousemove、scroll 和 visibilitychange；[登录恢复](https://github.com/shao-11/PDD-Merchant-Helper/blob/e508bccbec85a4671d709b8c1cb31d793f6c771a/src/keep-alive/scheduler.ts#L259-L319) 读取保存的账号密码并自动填表。

该仓库没有 `checkLogin`、主 Cookie TTL、`Set-Cookie` 或对照组证据。活动模拟增加行为和凭据风险，不能进入当前项目。

### 4. `ximo888ok-netizen/pdd-httpAPI`

- 仓库：[ximo888ok-netizen/pdd-httpAPI](https://github.com/ximo888ok-netizen/pdd-httpAPI)
- 固定版本：`7057fb7a66c286f320feec6aaa3afba62ac90953`
- 快照：6 stars；最后 commit `2026-06-30`；无许可证。
- 判定：**可参考过期 -> QR 重登状态转换，不是续期方案。**

[请求层](https://github.com/ximo888ok-netizen/pdd-httpAPI/blob/7057fb7a66c286f320feec6aaa3afba62ac90953/python/base_request.py#L137-L166) 在业务码 `43001` 后调用 relogin callback；[认证状态](https://github.com/ximo888ok-netizen/pdd-httpAPI/blob/7057fb7a66c286f320feec6aaa3afba62ac90953/python/auth.py#L208-L225) 按店铺保存 Cookie，失败后走新的 QR 登录。它没有服务端 refresh endpoint，且无许可证。

### 5. `YunzhiYike/pdd-merchant`

- 仓库：[YunzhiYike/pdd-merchant](https://github.com/YunzhiYike/pdd-merchant)
- 固定版本：`9d55eb6d9dd69978ded5c7f3b832e71a055b44d2`
- 快照：7 stars；最后 commit `2024-02-23`；MIT。
- 判定：**只作为 `checkLogin` 历史交叉证据。**

[checkLogin 实现](https://github.com/YunzhiYike/pdd-merchant/blob/9d55eb6d9dd69978ded5c7f3b832e71a055b44d2/src/PddMerchant.php#L410-L425) 调用 `/janus/api/checkLogin` 并返回 `login` 字段。仓库没有 daemon、persistent profile 或服务端续期实现。

### 6. 边界反例

- [`15103639079/pdd-mcp-server`](https://github.com/15103639079/pdd-mcp-server) 有真实 `grant_type=refresh_token`，但目标是拼多多开放平台 OAuth，不是 `mms.pinduoduo.com` 的 `PASS_ID`/Cookie 会话，不能混用。
- [`liudali333/pddmms-auto-reply`](https://github.com/liudali333/pddmms-auto-reply) 只导入浏览器 Cookie 并保存到 SQLite，没有自动验活、重登或续期。
- [`81211860/pdd-merchant-kit`](https://github.com/81211860/pdd-merchant-kit) 使用 persistent profile 和人工登录，但没有主会话续期证据且无许可证。

## 通用基础设施项目

### 1. Microsoft Playwright

- 仓库：[microsoft/playwright](https://github.com/microsoft/playwright)
- 固定版本：`c973356ee9e3906260f60da5e3e04442e069a0d4`
- 快照：94,243 stars；最后 commit `2026-08-07`；Apache-2.0。
- 判定：**Phase 0 daemon/profile 生命周期的首选参考。**

关键实现：

- [persistent browser 工厂](https://github.com/microsoft/playwright/blob/c973356ee9e3906260f60da5e3e04442e069a0d4/packages/playwright-core/src/tools/mcp/browserFactory.ts#L158-L194) 在启动前连续检查 profile 占用，处理 `ProcessSingleton`，再调用 `launchPersistentContext()`。
- [Windows/profile lock](https://github.com/microsoft/playwright/blob/c973356ee9e3906260f60da5e3e04442e069a0d4/packages/playwright-core/src/tools/mcp/browserFactory.ts#L215-L248) 在 Windows 使用 `lockfile` 可打开性判断占用，其他平台读取 `SingletonLock` PID。
- [daemon socket 判活](https://github.com/microsoft/playwright/blob/c973356ee9e3906260f60da5e3e04442e069a0d4/packages/playwright-core/src/tools/cli-client/session.ts#L91-L112) 真实连接 named pipe/socket，而不是只信状态文件或 PID。
- [detached daemon readiness](https://github.com/microsoft/playwright/blob/c973356ee9e3906260f60da5e3e04442e069a0d4/packages/playwright-core/src/tools/cli-client/session.ts#L114-L188) 等待子进程输出 listening 标记；子进程提前退出会返回 code 和 error log，确认后才 `unref()`。

直接帮助：当前 `daemon-launcher.js` 应从“看到 `status=running` 即成功”升级为“本次 instance token + 活 PID + 可完成协议握手”；persistent profile 启动前应安全拒绝占用，不能盲删 Chrome lock 文件。

### 2. `browser-use/browser-use`

- 仓库：[browser-use/browser-use](https://github.com/browser-use/browser-use)
- 固定版本：`32601887cfbc9f4f1e3cad3e2b678e56aeaeaae4`
- 快照：108,444 stars；最后 commit `2026-08-06`；MIT。
- 判定：**CDP 重连状态机的首选参考。**

[自动重连](https://github.com/browser-use/browser-use/blob/32601887cfbc9f4f1e3cad3e2b678e56aeaeaae4/browser_use/browser/session.py#L2239-L2326) 使用单一 reconnect lock，最多三次、每次 15 秒、1/2/4 秒退避，并发等待者由 event 唤醒。项目同时把 WebSocket drop 与 Chrome PID/health failure 分开；Chrome 已死亡时不会把 CDP reconnect 冒充崩溃恢复。

可借鉴：`CONNECTED -> RECONNECTING -> RECONNECTED | RECONNECT_FAILED` 独立于 `BROWSER_DEAD`；旧 CDP session/target wrapper 在重连前必须丢弃。

不可照搬：其日志可包含原始 `cdp_url`，当前项目必须只记录稳定 reason 或脱敏 fingerprint。

### 3. `browser-gateway/browser-gateway`

- 仓库：[browser-gateway/browser-gateway](https://github.com/browser-gateway/browser-gateway)
- 固定版本：`e1bfd3e8610279891af2364f5dbe8a06b8b9c878`
- 快照：6 stars；最后 commit `2026-08-04`；MIT。
- 判定：**Profile 单写 lease 的最佳小型参考。**

[FilesystemProfileStore.lock()](https://github.com/browser-gateway/browser-gateway/blob/e1bfd3e8610279891af2364f5dbe8a06b8b9c878/src/server/profile/filesystem-store.ts#L118-L147) 对 profile 目录获取带 stale/update 的锁，返回 token，并在 unlock/finally 中释放；过期锁作为兜底而不是正常控制流。

可借鉴：稳定 profile ID、单写 lease token、周期更新、明确 `LOCK_HELD`、所有异常出口 release、关闭时 bounded drain、坏快照不覆盖旧状态。

边界：该项目持久化的是 profile blob，不是 Chromium User Data；概念可借鉴，不能直接移植存储格式。

### 4. 其他可参考项目

- [apify/crawlee](https://github.com/apify/crawlee)（Apache-2.0，固定 `783951d0fb9e82e84b5da9ac48de203299e7ad09`）：BrowserPool 的 retire/close/临时目录清理成熟，但不负责账号 profile 命名或跨进程 lease。
- [browserless/browserless](https://github.com/browserless/browserless)（SSPL-1.0 或商业许可，固定 `ca834caf19825b4e769921d5d539e33baff2a06b`）：内存 session map、连接计数、并发队列和崩溃清理值得参考；daemon 重启后 Map 丢失，且许可证不适合直接复制实现。
- [browserbase/stagehand](https://github.com/browserbase/stagehand)（MIT，固定 `7566804ed4b97649706782bccdcab5d80f6fe588`）：SessionStore TTL/LRU、session resume 和 parent-lifeline 可参考；`keepAlive` 管理的是本地/云浏览器资源，不是目标网站认证。
- [pedroslopez/whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)（Apache-2.0，固定 `942d236a11ad68807308b058303ba5256915979c`）：`AUTHENTICATION_FAILURE`、QR、`DISCONNECTED` 状态转换适合参考；示例会直接输出 QR，当前项目必须继续保持二维码内容脱敏。
- [home-assistant/core](https://github.com/home-assistant/core)（Apache-2.0，固定 `e4f41540095ef900c132faf202a026f868a570f3`）：账号级 reauth flow、重复 flow 抑制和持久 issue 适合“过期通知 + 人工重登”。

## 采用矩阵

| 需求 | 首选参考 | 采用方式 | 明确边界 |
| --- | --- | --- | --- |
| daemon 启动确认 | Microsoft Playwright CLI daemon | 本次实例 token + 活 PID + named-pipe/socket 握手 + 提前退出错误 | 不再只认 state 字符串 |
| persistent profile 占用 | Playwright + browser-gateway | 每账号独立 User Data，单写 lease，Chrome lock 安全检查 | 不盲删 `SingletonLock`/`lockfile` |
| CDP 断线恢复 | browser-use | 单飞 reconnect、有限重试、退避、旧 session 清理 | 仅 Chrome 仍活时重连 |
| Chrome 崩溃恢复 | Playwright daemon + 独立 supervisor | 标记 `BROWSER_DEAD`，释放旧句柄，再按 policy 重启同 profile | 不是 CDP reconnect，也不是认证续期 |
| PDD 当前认证真值 | 当前 pdd-cli `checkLogin` | 保留 endpoint-specific `result.login` | 不降级为 URL/DOM/HTTP 200 |
| PDD 过期恢复 | pdd-auto-reply / pdd-httpAPI / whatsapp-web.js | 账号级 `NEEDS_LOGIN`、去重通知、QR/人工登录 | 不默认保存密码自动登录 |
| 长期会话实验 | 当前任务 A/B/C/D 设计 | persistent profile 与 one-shot/常驻/空白对照 | 没有对照前不称服务端续期 |

## 明确否决

1. 不接入隐藏 tab、mousemove、scroll、visibilitychange 等“人类活动”模拟。
2. 不把 `page.goto('/home')` 后未立即跳登录、Cookie 文件 mtime、`context.cookies()` 或 HTTP 200 称为刷新成功。
3. 不采用未知 `simpleInfo`、heartbeat 或裸 Cookie/API 定时调用。
4. 不把开放平台 OAuth refresh token 契约套到商家后台 Cookie。
5. 不复制官方工作台或日常 Chrome Profile；persistent profile 必须是账号独立的自动化目录。
6. 不直接复制无许可证仓库源码；AGPL 项目只作机制研究，除非后续明确接受其许可证影响。

## 对下一步的具体建议

### Phase 0：daemon 可靠性

先修现有已证实问题，不同时引入 profile：

1. child 启动时生成本次 instance token，state 必须包含 token、PID、startedAt 和协议版本。
2. launcher 等待真实 named-pipe/socket 或等价轻量握手，且验证返回 token；旧 `running` state 不能完成握手。
3. 添加使用临时路径、fixture auth 和 1-5 秒间隔的真实子进程测试，至少观察两轮推进并完整清理。
4. 区分 `DAEMON_DEAD`、`BROWSER_DEAD`、`CDP_DISCONNECTED`、`AUTH_INCONCLUSIVE` 和 `AUTH_EXPIRED`。

### Phase 1：persistent profile 试验底座

1. 建立稳定映射 `merchant account slug -> browser-profile/`，Profile 与现有 auth-state 分目录管理。
2. 增加 profile lease/token；同账号 CLI、daemon 和试验进程不能同时写同一 User Data。
3. profile 启动使用项目现有 Browser RuntimeProfile 规则，不直接复制外部 stealth/fingerprint 配置。
4. 初期只支持单账号、headed 或严格一致的 headless 试验，不接生产命令。

### Phase 2：长期证据

继续使用 `new-keepalive-directions-2026-08-09.md` 的 A/B/C/D 预注册观测点和成功/否决判据。若 persistent 组只改善本地恢复而没有延长服务端接受时间，则停止把它发展成“保活”，保留“验活 + 通知 + 人工重登”。
