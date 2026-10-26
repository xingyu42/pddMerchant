# daemon 周期验活与浏览器状态快照边界

## 关闭结论（2026-09-05）

用户反馈实际运行未能保持登录状态，决定停止本方案并清理相关未提交修改后归档。本任务按放弃方案关闭，不作为保登录能力交付。

本次撤回任务涉及的代码、测试、帮助文案和新增 ADR，恢复到现有 HEAD；不删除已提交的 daemon 功能，不清除账号凭据，不处理其他研究工作。下方验收勾选仅保留历史记录，不代表当前实现或长期保登录验证。历史材料中关于固定期限、唯一可行方案等推断不应视为本次确认的事实。

## Goal

让 merchant daemon 使用当前商家首页自然发出的 `POST /janus/api/checkLogin` 判断会话是否仍被服务端接受；仅在 `result.login === true` 时保存浏览器状态快照，不主动调用伪 heartbeat，也不把本地写回描述为服务端续期。

## Background

### 行为观察（2026-07-31 ~ 2026-08-01）

- 新登录 Context 中，`/home` 自然触发 `POST /janus/api/checkLogin`，响应为 HTTP 200、`success:true`、`errorCode:1000000`、`result.login:true`。
- 只在临时 Context 删除必要身份 Cookie `PASS_ID` 后，同一请求仍返回相同 HTTP/业务外壳与错误码，但 `result.login:false`，页面进入登录流程。
- 旧 daemon 主动裸 GET `/janus/api/informSeller/queryInformSellerTabList`：有效新会话返回 `40010`，空 Context 返回 `43001`，无法产生真实成功分支。
- 当前网页的 `/janus/api/heartbeat/v2` 属于 `InjectionDetect` 注入检测，不是登录续期接口。
- `/home`、正常只读业务请求和 `checkLogin` 均未观察到 `PASS_ID` 延长；周期请求只能称为验活和本地快照，不能承诺 Merchant Session Renewal。

### 深度研究验证（2026-08-10）

98 个并行 agent、528 万 token 的深度研究（详见 `research/deep-research-session-renewal-impossibility-2026-08-10.md`）证实：

- **固定 TTL 模型**：PDD 商家后台采用绝对过期（约 10 天硬上限），客户端无法通过协议手段延长服务端会话有效期
- **无续期协议特征**：checkLogin / 业务请求均不下发 PASS_ID 刷新的 Set-Cookie，对比 ASP.NET SlidingExpiration 等标准续期机制，PDD 缺少所有可观察特征
- **开源项目一致性**：5 个 GitHub 商家自动化项目均采用"持久化 Cookie + 定期验活 + 过期重登"模式，无一实现服务端续期逻辑
- **提前失效现象**：实测存在空闲超时（约 24-48h）和风控踢出（IP 变化、设备指纹不匹配）

**结论**：当前"周期验活 + 状态快照"设计是正确且唯一可行的方案，与所有第三方项目的最佳实践一致。

## Requirements

- R1：`refreshAuth()` 必须在 `/home` 导航前安装 response observer，只匹配 `mms.pinduoduo.com` 的 `POST /janus/api/checkLogin`。
- R2：HTTP 2xx JSON 中只有布尔 `result.login` 可决定认证状态；`true` 为 `auth_valid`，`false` 为 `auth_expired`。`success` 或非零 `errorCode/error_code` 不得覆盖该 endpoint 的 `result.login`。
- R3：首页最终进入 `/login` 是独立的明确过期信号；必须停止 observer、禁止写回并进入现有人工登录/二维码路径。
- R4：响应缺失、超时、非 JSON、非 2xx、`result.login` 缺失或非布尔时返回 `auth_check_inconclusive`，不得调用 `saveAuthState()`，也不得冒充认证过期。
- R5：仅 `auth_valid` 可在持有 auth-state 锁时保存当前 Context 的 `storageState`；该动作称为浏览器状态快照，不称为 Cookie 刷新或服务端续期。
- R6：observer 在成功、过期、超时、中断、导航失败和异常出口都必须释放 response/navigation/abort listener 与 timer。
- R7：不得返回或记录原始响应体、`error_msg`、Cookie、header、`Anti-Content` 或账号身份；日志只使用稳定 reason 和固定文本。
- R8：保留现有 8–12 分钟默认抖动，不新增伪造点击、随机业务页面、订单查询，也不主动调用或重构 `/janus/api/heartbeat/v2`。
- R9：README、CLI help、doctor、skill、`.env.example`、Trellis spec 与 ADR 必须统一使用“周期认证检查/浏览器状态快照”，不得承诺自动续期。

## Acceptance Criteria

- [x] AC1：测试证明 observer 先于 `/home` 导航安装，并且只接受同域 POST `checkLogin`。
- [x] AC2：测试覆盖 `result.login:true` + `errorCode:1000000`，结果为 `auth_valid` 且只保存一次快照。
- [x] AC3：测试覆盖同一外壳下 `result.login:false`，结果为 `auth_expired`，不保存且不泄露平台消息。
- [x] AC4：测试覆盖登录页、body 读取失败、非 JSON、非布尔、非 2xx、超时、中断和导航异常；除明确过期外均不写回。
- [x] AC5：daemon reason、日志、状态、doctor、help、README 和 skill 不再把周期检查称为自动续期或 heartbeat。
- [x] AC6：相关目标测试、帮助基线、全量测试和 `git diff --check` 通过；真实单轮验活返回 `auth_valid` 且不输出凭据。

## Notes

- 商家和消费者认证保持完全分离；本任务只修改 merchant daemon refresh 路径。
- `refreshAuth()`、`refreshIntervalMs`、`refreshJitterMs`、`lastRefreshAt` 和 `refreshCount` 暂保留为兼容字段/符号；它们在该链路中表示检查调度与最近检查时间，不构成续期承诺。
- 动态证据见 `research/fresh-login-survival-observation-2026-08-01.md`；长期决策见 `docs/adr/0003-use-natural-checklogin-for-merchant-auth-checks.md`。
