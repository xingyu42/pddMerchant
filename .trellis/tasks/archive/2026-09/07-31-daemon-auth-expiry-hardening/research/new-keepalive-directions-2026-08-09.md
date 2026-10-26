# 商家登录保活失败后的替代方向调研（2026-08-09）

## 结论

当前方案不能再作为“商家登录保活”方案继续投入。它最多保留为认证验活器：打开一次全新 BrowserContext，观察首页自然 `POST /janus/api/checkLogin`，明确有效时保存一次 `storageState`，随后关闭浏览器。该链路既没有证明服务端续期，实际 daemon 也没有活到第二轮。

后续应拆成两条独立目标：

1. **可靠运行目标**：daemon 必须真的跨过第二轮及后续调度，状态不能把死进程报成 `running`。
2. **会话寿命目标**：单独验证“隔离的 persistent User Data + 长时间自然页面会话”是否比当前 one-shot `storageState` 延长服务端实际接受时间。

推荐方向是：**先修复并验证 daemon 生命周期实验底座，再做 persistent profile 的 A/B/C/D 长期对照；产品基线同时改成“验活 + 过期通知 + 人工重新登录”**。在长期对照得到阳性证据前，不得把 persistent profile、官方工作台恢复、Cookie 文件写回或任意 HTTP 200 称为服务端续期。

## 调研边界

- 只讨论 merchant 商家端，不混入 consumer 登录。
- 本轮没有运行未知 EXE/DLL，没有调用猜测接口，没有增加点击、订单请求或伪造业务流量。
- 动态状态只保留稳定 reason、计数、时间差和进程是否存活；不记录 Cookie 值、Cookie 指纹、账号身份、auth-state 路径、header、`Anti-Content` 或响应正文。
- 外部资料只采用 Playwright 官方文档、Patchright 官方仓库和本地已安装 Patchright 类型定义；本轮没有找到可直接采用的平台公开商家会话续期契约。

## 当前失败被拆成两个事实

### 1. daemon 没有持续运行

2026-08-09 的脱敏只读复核结果：

- daemon state 自报 `status=running`，但记录的 PID 已死亡，系统中也没有其他 `pdd-daemon.js` 进程。
- state 只有 `refreshCount=1`、`failureCount=0`，包含两个匿名账号；最后一轮约 65 小时前完成，计划的第二轮已逾期约 65 小时。
- 这证明“首轮后没有持续调度”，但没有证明进程退出原因，更不能归因于平台风控或 `checkLogin`。

源码中的确认缺口与该输入条件一致：

- `src/infra/daemon-launcher.js:74-78` 会先检查旧 PID 是否存活。
- spawn 后的确认循环 `src/infra/daemon-launcher.js:98-107` 只要求 state 中 `status === 'running'`，没有同时要求 PID 存活，也没有证明 state 属于本次启动。
- `bin/pdd-daemon.js:236-248` 先写 `running`，执行首轮，再用 `setTimeout` 安排下一轮；fatal 出口 `:251-257` 直接退出，没有外部 supervisor 自动拉起。

因此，修复服务端续期之前必须先建立真实进程级测试，否则任何 8-12 分钟或更长时间序列都没有可信实验载体。

### 2. one-shot `storageState` 没有服务端续期证据

当前浏览器链路是：

- `src/adapter/browser.js:107-126` 使用 `chromium.launch()`。
- `src/adapter/browser.js:160-176` 使用 `browser.newContext({ storageState })`。
- `src/adapter/browser.js:233-258` 每次 callback 结束后关闭 Browser/Context。
- `src/adapter/auth-state.js:32-73` 将 `context.storageState()` 原子写回 JSON。
- `src/adapter/auth-refresher.js:154-189` 只观察自然 `checkLogin`；只有 `result.login === true` 才保存快照。

已有动态对照还证明：

- 自然 `checkLogin` 能区分当前有效与失效，但有效响应没有下发 Cookie。
- `/home` 和一次正常只读订单请求没有延长或替换主 `PASS_ID`。
- 本地 `PASS_ID.expires` 仍在未来时，服务端也可能已经拒绝会话。
- `/janus/api/heartbeat/v2` 属于 `InjectionDetect`，不是登录续期接口。

所以当前方案的准确名称是“认证检查 + 客户端状态快照”，不是保活。

## persistent profile 为什么值得试验

Playwright 官方 `launchPersistentContext(userDataDir)` 文档明确说明：

- `userDataDir` 保存 Cookie、localStorage 等浏览器 session data。
- 返回唯一的 persistent BrowserContext，关闭 Context 会关闭 Browser。
- 同一 User Data Directory 不能被多个浏览器实例同时使用。
- 不能直接自动化日常 Chrome 主 Profile，应使用独立目录。

来源：

- [Playwright BrowserType.launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright Authentication](https://playwright.dev/docs/auth)
- [Patchright 官方仓库](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
- 本地类型定义：`node_modules/patchright-core/types/types.d.ts:15490-15514`

Playwright 认证文档把 Cookie、localStorage 和 IndexedDB 都列为可复用认证状态，但 sessionStorage 没有通用持久化 API。API 类型要求显式启用 `indexedDB:true` 才把 IndexedDB 加入快照，而当前项目只调用 `storageState({ path })`；本地类型定义见 `node_modules/patchright-core/types/types.d.ts:9573-9657`。

官方商家工作台 3.6.7.6 签名样本的既有静态证据也支持不同的客户端模型：CEF 使用 persistent `User Data`，原生层与 CEF 双向同步 Cookie/PASS_ID/PDDID，并能重建浏览器进程。它能解释“重启后仍可恢复登录”，但仍没有证明服务端 TTL 被延长。证据见：

- `research/fresh-login-survival-observation-2026-08-01.md:48-61`
- `.trellis/tasks/archive/2026-07/07-24-analyze-pinduoduo-merchant-login-keepalive/research/login-keepalive-static-analysis.md:29-43`

因此，persistent profile 是当前最值得验证的**客户端连续性**方向，但不是已成立的服务端保活方案。

## 替代路线矩阵

| 路线 | 当前判定 | 能解决什么 | 主要风险/缺口 | 建议 |
| --- | --- | --- | --- | --- |
| 真实 daemon 生命周期加固 | 已证实前置条件 | 保证实验和验活真的跨周期运行 | 本身不延长会话 | 立即作为 Phase 0 |
| 常驻、隔离的 persistent User Data | 最有价值的研究方向 | 保存比 `storageState` 更完整的客户端状态，保持自然页面生命周期 | profile 单写者、崩溃恢复、磁盘敏感信息；仍未证明服务端续期 | 作为主 A/B 实验，不直接生产化 |
| 每次命令按需打开 persistent profile | 次选试验 | 比 one-shot `storageState` 保存更多本地状态，且不长期驻留 | 启动成本、profile 锁、命令间没有自然常驻流量 | 主实验无收益时停止，不提前抽象 |
| 官方工作台受控桥接/导入 | 条件阻塞 | 若存在官方支持接口，可复用官方账号上下文 | 当前只有静态 IPC/Profile 证据，没有公开导出契约；直接复制 profile 有锁、加密、版本和账号串用风险 | 没有官方契约前不实现 |
| 裸 Cookie/API 定时调用 | 当前否决 | 理论上资源低 | 没有自然 endpoint 续期证据，页面签名/`Anti-Content` 契约不完整，极易把 HTTP 200 业务失败当成功 | 不采用 |
| 验活 + 过期通知 + 人工重新登录 | 可立即交付的产品基线 | 不虚构续期，明确告诉用户何时需要重登 | 不能满足“永久免登录” | 与任何实验并行保留 |

## 推荐实验：A/B/C/D 长期对照

### 实验问题

`persistent User Data` 或常驻自然页面会话，是否相对当前 one-shot `storageState` 明显延长服务端接受 merchant 会话的时间？

### 分组

- A 组：当前方式，fresh `browser.newContext(storageState)`，自然 `/home` + `checkLogin` 后关闭。
- B 组：每账号独立 `launchPersistentContext(userDataDir)`，周期重启浏览器以验证 Profile 恢复能力。
- C 组：每账号独立 persistent Context 长时间常驻，只允许页面自身自然请求，不增加点击、订单或伪造流量。
- D 组：不运行 daemon 的空白对照。

如果没有多个可比测试账号，不能把同一账号并行放入多组，因为异地登录、账号切换和共享服务端状态会污染结果。单账号只能做多次重新登录后的交叉实验，并明确样本量不足。

### 预注册观测点

- T0、6 小时、24 小时、72 小时、7 天、10 天、12 天；10 天来自当前 `PASS_ID` 属性的直接观察，不代表服务端承诺。
- 每个观测点只记录：`checkLogin.result.login`、Cookie 名称/属性/到期时间是否后移、`Set-Cookie` 名称、最终页面是否进入登录流程、浏览器/daemon PID 是否存活、Profile 重启后是否恢复。
- 不记录 Cookie 值、header 值、响应正文、账号标识或业务数据。

### 成功判据

以下至少一项需要在 persistent 组相对 A/D 对照中稳定复现：

1. 主身份 Cookie 的有效期真实向后移动，并能追溯到自然响应的 `Set-Cookie`。
2. 在预注册到期窗口后，persistent 组仍被 `checkLogin` 接受，而对照组稳定失效。
3. Profile 重启恢复的状态明显多于 `storageState`，且该差异与更长的服务端接受时间相关。

只有第 1 或第 2 项能支持“服务端续期/更长存活”的结论。仅第 3 项只能支持“客户端恢复更完整”。

### 否决判据

- persistent 组只改善重启恢复，但与 A/D 的服务端接受时间无差异。
- 主 Cookie 到期时间不移动，跨到期窗口后各组同时失效。
- 需要伪造点击、业务读取、代理轮换或未知 endpoint 才能出现差异。
- 同账号 profile 无法可靠单写、异常退出后损坏，或会与普通 CLI/官方工作台互相争锁。

## Phase 0：先做可靠实验底座

长期实验前应先完成一个秒级、可自动清理的真实进程测试：

1. 为 daemon 注入临时 state/log/auth/account 路径、fixture auth refresher 和 1-5 秒测试间隔；不得用该秒级间隔访问真实平台。
2. 启动真实子进程，至少观察两轮 state/`nextRunAt` 推进。
3. 确认 launcher 只接受本次启动写出的 state、活 PID 和匹配的 `startedAt`/token。
4. 模拟旧 `status=running` + 死 PID，证明不会误报启动成功。
5. 测试结束必须终止子进程并删除临时数据，不接触仓库真实 `data/`。

这一步只修复“实验载体和验活可靠性”，不得在命名或文档中重新承诺保活。

## 决策建议

1. 当前 `checkLogin` observer 保留，但从产品概念上降级为 health check，不再承担保活目标。
2. 下一次代码变更只做 daemon 真实跨周期测试和 stale-state 启动确认；不要同时引入 persistent profile。
3. 生命周期通过后，单独建立 persistent profile 研究任务，先做隔离试验工具和 A/B/C/D 观测，不接生产命令。
4. 长期对照没有阳性证据时，停止继续追逐“自动续期”，正式采用“验活 + 通知 + 人工重登”作为可兑现能力。

## 仍未确认

- 主 `PASS_ID` 是否只在接近到期时滑动续期。
- 官方工作台运行期间是否有普通响应更新主 Cookie。
- `windows_app_shop_token_23` 的刷新来源和对网页主会话的作用。
- persistent CEF/User Data 相比 `storageState` 的实际会话寿命增益。
- daemon 首轮后退出的具体根因。
