# 技术设计

## 边界

改动限制在现有职责层：

- `src/adapter/auth-refresher.js`：认证探测和刷新结果判定。
- `src/adapter/auth-state.js`：认证快照版本和条件原子保存。
- `src/commands/runner/single-lifecycle.js`：成功命令结束前触发条件保存并追加 warning。
- `test/`：覆盖 heartbeat、并发冲突、回写失败和 runner envelope。

不修改 command 注册、service、endpoint spec、配置字段或认证文件格式。

## 数据流

```text
auth-state.json
  -> 读取内容 revision
  -> Playwright newContext(storageStatePath)
  -> auth 校验 + 业务请求
  -> 服务端可能 Set-Cookie
  -> pageSession 关闭附加页面
  -> 获取同一路径 auth lock
  -> 当前文件 revision == 启动 revision ?
       yes -> context.storageState() 原子写回
       no  -> 跳过，warning=auth_state_persist_conflict
  -> success envelope
```

## Heartbeat 判定

页面主世界 `fetch()` 返回以下非敏感元数据：

```js
{
  status,
  ok,
  redirected,
  url,
}
```

以下情况判失败：

- 首页导航后最终页面 URL 是登录页。
- `resp.redirected === true`。
- 最终 `resp.url` 是登录页。
- 状态为 401、403，或响应不是成功状态。

失败后继续执行现有 `isAuthValid()` 完整校验。只有 heartbeat 或完整校验确认有效后才能写回快照。

## 条件保存

`auth-state.js` 新增两个窄接口：

```js
getAuthStateRevision(path) -> Promise<string | null>
saveAuthStateIfCurrent(context, path, expectedRevision)
  -> Promise<{ saved: boolean, reason: 'saved' | 'conflict' }>
```

revision 是认证文件原始字节的 SHA-256，仅用于本地并发比较，不写日志、不进入 envelope。

`saveAuthStateIfCurrent()` 获取现有 auth lock 后再次计算 revision：

- 相同：复用 `saveAuthState(..., { skipLock: true })` 的原子临时文件替换。
- 不同：不写文件并返回 `conflict`。

选择“冲突时跳过”而不是合并 Cookie，因为 Cookie 缺失可能代表服务端主动删除；按过期时间合并会错误复活已删除凭据。

## Runner 行为

只有 live 且 `needsAuth: true` 的成功命令尝试回写。

- `conflict`：追加 `auth_state_persist_conflict`。
- 保存异常：记录脱敏 warning，追加 `auth_state_persist_failed`。
- 业务命令失败：不回写，沿用现有错误 envelope。
- 保存失败不推翻业务成功，避免写命令已经生效却向用户报告整体失败。

## 并发与兼容性

- daemon 和 CLI 继续共用 `auth-lock.js`。
- 条件保存只防止较旧快照覆盖较新文件，不尝试合并并发 context。
- 认证 JSON 结构仍为 `{ cookies, origins }`，旧文件无需迁移。
- fixture 路径保持完全绕过真实文件和 browser。
- 不改变 daemon interval 和状态输出。

## 风险与回滚

- 可能出现保守跳过：文件在 context 创建前刚好变化时，命令会产生 conflict warning；这是安全退化，下次命令会加载新文件。
- 条件保存增加一次文件哈希读取；认证文件较小，成本可忽略。
- 回滚只需移除 runner 条件保存调用和两个 auth-state helper；heartbeat 修复可独立保留。
