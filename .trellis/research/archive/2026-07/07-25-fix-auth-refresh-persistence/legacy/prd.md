# 修复登录态续期与 Cookie 持久化

## Goal

延长 `pdd-cli` 商家登录态的实际可用时间：正确识别认证跳转，保存真实业务请求获得的最新 Cookie，并避免并发命令覆盖较新的认证快照。

## Requirements

- `auth-refresher` 不得把跳转到登录页后的最终 HTTP 200 当成刷新成功。
- 已认证业务命令成功完成后，应在关闭 browser context 前尝试保存最新 `storageState`。
- 若认证文件从命令启动后已被 daemon 或其他进程更新，本命令不得覆盖它，应保留业务成功并产生非敏感 warning。
- Cookie 持久化失败不得把已经成功的业务操作改报失败；错误只记录脱敏日志和 warning。
- fixture 模式不得读取或写入真实 auth state，也不得启动浏览器。
- 保持多账号路径、auth lock、原子写入、envelope 和退出码契约不变。
- 不修改 Cookie 值或 `expires`，不新增伪造 token、自动扫码或验证码绕过。
- daemon 刷新周期保持现状；本任务不以提高请求频率换取登录寿命。

## Acceptance Criteria

- [x] heartbeat 返回登录跳转、最终 URL 为 `/login`、401 或 403 时判定失败，并进入完整认证校验。
- [x] heartbeat 同域非跳转成功响应仍可保存最新 auth state。
- [x] 成功的 live、`needsAuth: true` 单命令在认证文件未变化时回写最新 `storageState`。
- [x] 认证文件发生并发变化时跳过回写，返回成功 envelope，并包含稳定 warning。
- [x] 回写 I/O 失败时保留成功 envelope，并包含稳定 warning，日志不含 Cookie、路径内容或凭据。
- [x] 失败命令、`needsAuth: false` 命令和 fixture 命令不执行成功回写。
- [x] daemon stale-state 清理和自动启动现有契约继续通过测试；若无缺陷，不为此新增行为改动。
- [x] 定向 auth/runner/daemon 测试与全量 `npm test` 通过。

## Out Of Scope

- 改为 Chromium persistent context 或迁移认证文件格式。
- 合并两个并发 browser context 的 Cookie 内容。
- 调整 `refreshIntervalMs` / `refreshJitterMs` 默认值。
- 承诺服务端一定通过普通请求延长 `PASS_ID`；本任务只确保收到的新 Cookie 不丢失。

## Evidence

- 官方工作台静态样本存在长期 `PASS_ID`、Chromium User Data 持久化和 Cookie 双向同步。
- 当前 `auth-refresher` 的 `fetch()` 默认跟随跳转，只检查最终状态码，存在登录页 200 误判风险。
- 当前 `single-lifecycle.js` 成功后关闭 context，没有写回业务期间更新的 Cookie。
- 2026-07-25 本机 `doctor --json` 返回 `E_AUTH_EXPIRED`，但认证快照中的 `PASS_ID` 本地到期时间仍在未来，证明本地 `expires` 不能代替服务端有效性判断。
