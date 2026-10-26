# 商家登录状态受控动态观察（2026-08-01）

## 结论

本轮直接证明：本地 auth-state 中存在尚未到浏览器到期时间的持久 Cookie，不代表拼多多服务端仍接受该商家会话。唯一启用账号的 `PASS_ID` 本地到期时间仍在未来，但访问商家首页最终进入 `/login/`；因此“Cookie 未到期”不能作为“主登录状态存活”的最终判据。

本轮没有观察到有效会话，不能据此判断拼多多是否会在有效业务响应中通过 `Set-Cookie` 延长 Cookie，也不能确认专用刷新接口、滑动续期条件或服务端实际 TTL。

## 方法与安全边界

- 观察时间：`2026-08-01 02:21:45`（Asia/Shanghai）。
- daemon 在观察前已确认未运行，避免后台刷新并发写回。
- 当前注册表只有一个启用商家账号；报告使用匿名标签，不记录账号 slug、显示名、mall ID 或 auth-state 路径。
- 使用当前项目的 fresh headless non-persistent Context 加载现有 storageState。
- 请求最多为一次 `/home` 和一次 Janus heartbeat；首页已经进入登录页时跳过 heartbeat。
- 只记录拼多多域 Cookie 的名称、域、路径、到期时间和安全属性，以及值是否变化的布尔结果；不记录 Cookie 值或其指纹。
- 不记录响应正文、`error_msg`、请求头、`Set-Cookie` 值、二维码或其他凭据。
- 不调用 `saveAuthState()`；运行前后比较 auth-state revision、大小和 mtime，确认文件未变化。
- 请求本身仍可能影响服务端会话；“不落盘”只表示不把临时 Context 状态写回本地 auth-state。

探针脚本：`research/live-auth-observation.mjs`。

## 直接观察

| 项目 | 结果 |
| --- | --- |
| auth-state 是否存在 | 是 |
| 初始拼多多域 Cookie 数 | 14 |
| `PASS_ID` 类型 | `HttpOnly`、`Secure`、持久 Cookie |
| `PASS_ID` 本地到期时间 | `2026-08-04T08:13:10.169Z` |
| 其他 Cookie 本地到期时间 | 部分延伸至 2026-11 和 2027-08 |
| `/home` HTTP 状态 | 200 |
| `/home` 最终路径 | `/login/` |
| 会话分类 | `auth_expired_login_redirect` |
| heartbeat | 跳过；首页已确认进入登录页 |
| 本轮 `Set-Cookie` | 未观察到 |
| 首页前后 Cookie 变化 | 无 |
| auth-state 文件变化 | 无 |

## 证据强度

- **高可信直接证据**：本地 Cookie 到期时间在未来，同时服务端将 `/home` 导向登录页。
- **高可信直接证据**：本轮没有修改 auth-state，结果不是探针写回造成的。
- **本轮未获得证据**：有效会话是否在 `/home` 或 Janus heartbeat 响应中更新 Cookie。
- **本轮未获得证据**：官方工作台的 CEF persistent User Data 是否比 pdd-cli storageState 保存更多恢复材料，并因此呈现不同存活时间。
- **不能推断**：固定 headless、单一请求轨迹或 daemon 周期导致服务端缩短会话；本轮没有对照组。

## 下一步动态验证

要研究真正的“存活机制”，需要一个刚完成登录的隔离商家账号，并在不输出凭据值的前提下做时间序列观察：

1. 登录后立即记录 Cookie 名称、属性和到期时间基线。
2. 分别观察 `/home`、Janus heartbeat 和一次正常只读商家请求前后的 Cookie 元数据变化。
3. 关闭 Context，不写回 auth-state；另设一组按项目正常逻辑写回，比较下次启动恢复结果。
4. 在多个时间点重复，区分固定到期、响应触发更新和滑动到期。
5. 若要比较官方工作台，必须另行观察其已签名 3.6.7.6 样本的 User Data/Cookie 元数据变化，不能把 CEF Profile 与 pdd-cli storageState 视为等价。
