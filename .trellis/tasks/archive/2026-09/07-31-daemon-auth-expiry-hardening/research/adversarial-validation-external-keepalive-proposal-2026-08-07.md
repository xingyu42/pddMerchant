# 外部商家登录保活方案对抗性验证（2026-08-07）

## 结论

外部文档 `E:\Administrator\Downloads\__cold coffee, warm LO, I can'.md` **不能作为生产方案采用**。

它把以下四件不同的事混成了“保活成功”：

1. 浏览器能恢复本地 Cookie/localStorage；
2. 某个接口返回 HTTP 200；
3. 检查时刻服务端仍接受会话；
4. 服务端延长了主商家会话有效期。

当前证据只直接支持第 1 项的有限子集，以及通过自然 `POST /janus/api/checkLogin` 判断第 3 项。没有证据证明文档推荐的 `/janus/api/shop/simpleInfo`、页面访问、点击弹窗或写回 `storageState` 会完成第 4 项。文档宣称“可维持数周/月”属于无时间序列、无对照组、无服务端续期证据的过度承诺。

更紧急的当前事实是：本机 daemon 首轮对两个匿名账号都记录了 `auth_valid`，但进程没有存活到计划的第二轮。因此当前“没有持续保活/验活”首先是 daemon 生命周期事实，而不是 `simpleInfo` 选错与否。停止原因尚未证明，不能把它直接归因于拼多多风控或当前 `checkLogin` 实现。

## 验证边界

- 只读取外部文档、当前源码、测试、Trellis 研究材料、已安装 Patchright 类型定义和脱敏 daemon 状态。
- 没有执行外部 Python 脚本，没有调用未知 `simpleInfo` 请求，没有增加点击、订单请求、代理轮换或伪造业务流量。
- 没有输出 Cookie/Anti-Content/header/响应正文、账号 slug、显示名、mall ID、auth-state 路径或 PID。
- 当前运行观察只证明本机这一轮的进程和状态，不自动代表其他部署环境。

## 主张审计

| 外部文档主张 | 判定 | 证据与反证 |
| --- | --- | --- |
| `/janus/api/shop/simpleInfo` 是已确认的主 keep-alive | 未证实 | 文档 `:7,45-58,86-103` 没有给出自然请求样本、请求契约、业务成功字段、`Set-Cookie` 或 TTL 前后对照。当前仓库和任务动态观察没有该 endpoint。 |
| HTTP 200 表示 keep-alive 成功 | 已反证 | 文档 `:87-92` 只看状态码。当前实测旧 Janus GET 对有效新会话为 HTTP 200 + `40010`；`checkLogin` 的有效与失效结果也都可为 HTTP 200 + `errorCode:1000000`，必须读取 endpoint 专属字段 `result.login`。 |
| `storage_state` 保存 everything，包括 IndexedDB、指纹和 header | 已反证 | 文档 `:39-41,98-103,120` 使用普通 `storage_state()`。当前 `saveAuthState()` 只调用 `context.storageState({ path })`；已安装 Patchright 类型要求显式 `indexedDB:true` 才包含 IndexedDB。它不保存 sessionStorage、缓存、完整 Profile、请求 header 或浏览器指纹。 |
| 示例使用 persistent browser context | 已反证 | 文档 `:24-40,65-74` 每轮都是 `chromium.launch()` + `browser.new_context(storage_state=...)`，不是 `launchPersistentContext(userDataDir)`。文档自己的描述与代码冲突。 |
| `page.request.fetch()` 带齐完整网页上下文和 Anti-Content | 部分错误 | Patchright 明确 `page.request` 与 BrowserContext 共享 Cookie jar，因此不能说它完全无会话；但它是 APIRequestContext，不会自动执行页面业务请求封装，也没有证据会从页面 JS/localStorage 生成该 endpoint 所需的 Anti-Content 或其他签名。当前项目用页面自然请求/页面运行时正是为了保留这些字段。 |
| 写回 state 等于 Session refreshed | 已反证 | 文档 `:98-103` 只证明本地文件被重写。当前受控观察中 `checkLogin` 没有下发 Cookie，`/home` 和只读订单也没有延长或替换 `PASS_ID`；本地快照不证明服务端续期。 |
| 登录即将过期弹窗及点击“确认”可续期 | 未证实且实现危险 | 文档 `:79-84` 没有选择器来源、页面样本或点击后 TTL 对照。通用 `text=确认` 可能点击无关业务对话框，不能进入生产自动化。当前动态观察只证明过期后进入登录页。 |
| 指纹变化、IP 跳变、长时间不活跃导致退出 | 风险假设 | 文档 `:7,120` 没有 A/B 对照或服务端证据。它随后建议代理轮换，反而可能增加出口变化。不能据此修改生产行为。 |
| 4 小时调用可维持数周/月 | 未证实 | 文档 `:45,115-122` 没有周/月时间序列、空白对照、persistent Profile 对照或服务端 TTL 证据。当前项目的 8–12 分钟仅是认证检查调度，也不等于续期。 |

## 外部示例的工程缺陷

### 1. 会把业务失败误报为成功

文档 `:87-92` 对任何 HTTP 200 打印 `Keepalive successful`，没有检查 endpoint 的 `success`、业务码或登录字段。当前已经实测存在 HTTP 200 的业务失败和 HTTP 200 的认证失效结果，因此该条件不可接受。

### 2. 可能用失效 Context 覆盖原 auth-state

文档在接口返回 200 后继续导航并无条件写回 state（`:94-103`），没有检查最终 URL 是否进入 `/login`。如果响应是 HTTP 200 业务失败或页面已退出登录，它仍可能把失效状态覆盖到唯一 state 文件。

### 3. 写文件没有锁和原子替换

文档 `:98-101` 直接覆盖 JSON 文件。它没有当前项目的 auth-state lock、临时文件和原子 rename，也没有 revision 冲突检查；与 CLI/daemon 并发时可能丢更新或留下截断文件。

### 4. 不符合当前多账号和敏感信息边界

文档只有一个全局 state 文件；打印 `data.info` 和原始异常文本（`:89-109`），可能暴露商家信息、路径或平台原始错误。当前项目要求账号隔离，并只返回稳定 reason。

### 5. “隐蔽性”和“人类行为”没有可验证契约

硬编码 Chrome 128 UA、`playwright-stealth`、固定 viewport、三秒暂停、代理轮换和通用确认点击（`:24-33,65-84,94-97,120`）都没有针对当前 PDD 会话的对照证据。加入这些动作会扩大故障面，不能替代认证结果或续期证据。

## 当前项目复核

### 已证实的正确边界

- `src/adapter/auth-refresher.js:25-30` 只匹配同域 `POST /janus/api/checkLogin`。
- `src/adapter/auth-refresher.js:58-71` 只按 HTTP 2xx + 布尔 `result.login` 分类。
- `src/adapter/auth-refresher.js:154-189` 在导航前安装 observer，仅在 `auth_valid` 保存浏览器状态快照。
- `docs/adr/0003-use-natural-checklogin-for-merchant-auth-checks.md:19-35` 明确禁止把快照描述为 Merchant Session Renewal。
- `research/fresh-login-survival-observation-2026-08-01.md:76-88` 提供有效 Context 与临时删除 `PASS_ID` 的直接对照；同一 HTTP/业务外壳分别得到 `login:true/false`。

### 当前本机运行事实

在 `2026-08-07 05:23`（Asia/Shanghai）做脱敏只读复核：

- daemon state 写着 `running`，但记录的 PID 已不存在；`tasklist` 也没有匹配进程。
- 首轮完成于约 `05:13:32`，两个匿名账号的最后结果均为 `auth_valid`，全局 `refreshCount=1`、`failureCount=0`。
- state 计划的第二轮时间约为 `05:23:44`；越过该时间后 `lastRefreshAt`、`refreshCount` 和 `nextRunAt` 都没有变化。
- 当前日期没有 daemon 日志文件，无法从日志证明退出原因。

可得结论：**首轮认证检查成功，但 daemon 没有持续运行。** 不可得结论：服务端会话已续期、`checkLogin` 导致进程退出、平台风控杀死进程，或生产部署一定复现相同原因。

## 当前实现风险与测试盲区

### P1：daemon 启动确认可接受陈旧 running 状态

`src/infra/daemon-launcher.js:74-78` 会识别旧 PID 已死亡并尝试启动新进程，但 `:100-105` 的确认循环只检查 `state.status === 'running'`，没有同时检查 PID 存活，也没有证明 token/state 来自本次启动。如果陈旧 state 尚未被新进程覆盖，launcher 可把旧的 `running` 文件误当作启动成功。

当前本机恰好存在“status=running + dead PID”的输入条件，但本轮没有证明启动时命中了该竞态。修复时应要求：状态属于本次启动、daemon PID 存活，并且最好观察新的 token fingerprint/startedAt，而不是只认字符串状态。

### P1：测试没有覆盖真实 daemon 跨周期存活

- `test/daemon-lifecycle.unit.test.js:31-42` 完全 mock `isPidAlive()` 和 `ensureDaemonRunning()`。
- `test/login-daemon-autostart.unit.test.js:25-27` 也 mock launcher。
- `test/pbt/daemon-loop.pbt.test.js:5-74` 复制 delay/flag 模型，没有 import `bin/pdd-daemon.js`。
- `test/pbt/daemon-multi-account.pbt.test.js:8-60` 只操作局部数组/布尔值，不执行真实多账号 daemon 流程。

因此目标测试全绿不能证明 Windows 子进程能跨过第二轮 timer，也不能发现当前“首轮后进程消失”。需要可注入短间隔、临时 state/log/auth 路径的进程级集成测试，并由测试完整清理子进程。

### P2：任务实现计划已经过时

当前 `prd.md`、`design.md`、源码和 ADR 已使用自然 `checkLogin`，但 `implement.md:3-14` 仍描述旧 heartbeat、43001/`heartbeat_rejected` 方案。它不能再作为现行实现依据，后续应同步，避免未来 Agent 回退到已被动态对照否定的 endpoint 规则。

### P2：损坏 auth-state 会被归类为 network_error

`refreshAuth()` 只先检查路径存在；JSON 损坏/shape 错误在浏览器加载时会落入通用 `network_error`，而 `requiresManualLogin()` 不把它归为需要重新登录。当前运行状态不是这个情况，但该分类可能导致真正损坏的凭据被无限重试。

## 推荐顺序

1. **不要部署外部 Python 脚本，也不要把 `simpleInfo` 接入现有 daemon。** 它的成功判据、写回和并发边界不合格。
2. **先定位并修复 daemon 生命周期。** 当前首轮两账号认证有效但进程未活到第二轮；先补启动确认和真实跨周期集成测试，再谈会话续期。
3. **把验活和续期继续分开。** 当前 `checkLogin` 只回答“此刻是否有效”；`storageState` 只保存客户端快照。
4. **若要验证真正续期，做脱敏时间序列 A/B。** 对照 fresh Context + storageState、独立 persistent User Data、完全不运行 daemon 三组；记录 `PASS_ID` 属性是否变化、`checkLogin` 布尔结果和存活时间，不记录值。
5. **任何候选 endpoint 必须先取得自然流量证据。** 至少证明 method/body/header 名称、业务成功字段、有效/失效对照、`Set-Cookie` 名称和 TTL 前后变化；不能因 URL 含 `auth`、`heartbeat` 或 `simpleInfo` 就推断续期。

## 本轮验证

- 目标测试：7 个文件、36 项测试全部通过。
- 这些测试证明当前 observer/分类/命令契约，但不证明真实 daemon 跨周期存活；该限制已经单独列出。
- Web 搜索工具当前不可用，外部文档唯一显式脚注又是第三方 `lobehub.com` skill，不是拼多多或 Playwright 的一手证据。Playwright/Patchright API 语义改用本地已安装 `patchright-core` 类型定义核验。
