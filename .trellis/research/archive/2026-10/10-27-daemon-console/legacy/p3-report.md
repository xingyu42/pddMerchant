# P3 控制台服务与鉴权实施报告

## 结果

已完成 HTTP 组件、一次性访问链接与 8 小时会话、账号列表、录入/清除密码、解除熔断及 `pdd console link`。默认 `runDaemon` 组件列表包含 HTTP 服务，保持 `{ start(context), stop() }` 接口；测试可显式传空列表。

分支 `feat/daemon-console`，基于 P2 `e58e4ec`。本轮未提交，未改 `CLAUDE.md`，未增加依赖。`public/index.html` 为最小占位页；P4 接管、会话、扫码及重登接口保留后续阶段。

## 验证

- 最终定向命令：`npx vitest run test/daemon/ test/services/console-auth.test.js test/services/daemon.test.js test/e2e/console.e2e.test.js`，6 个文件、54 项通过。
- 较早的扩大定向运行覆盖 `test/e2e/daemon.e2e.test.js` 与 `test/contract/data-contract-v2.test.js`，其中包含 `console.link` 的真实 CLI 成功路径。
- 最终 `npm test`：57 个文件通过，904 项通过、1 项平台跳过，总计 905 项，退出码 0。
- `git diff --check`：通过。
- 单元覆盖精确过期边界、重放、未知/缺失 Cookie、空账号绑定、仅哈希存储、Secure 标志、会话插入失败回滚；HTTP 覆盖 401/403/413/421、无效 JSON、路径/编码穿越、安全头/CSP、解析失败安全响应、静态 MIME/软链接越界、占用端口释放租约、旧实例停止时保留新实例地址。
- fixture e2e 使用随机空闲端口、临时 `PDD_DB_PATH`、P2 的 3000ms TTL/100ms 心跳接缝。通过 node:http.request 走 start → link → redeem → cookie → accounts → password → replay 410 → stop，并检查响应、stdout/stderr、CLI/daemon 日志、DB 文件及其侧文件中的密码/登录名明文。日志同时检查 token/会话明文。
- 本机 Windows fixture 自动化通过。真实账号、浏览器、TLS 反代及其他操作系统的人工验证保留到后续阶段；项目无构建或类型检查步骤，no-op lint 未计作静态检查。

## 接口与设计调整

- `GET /api/accounts` 返回 `{ items: [...] }`。每项为 `CONSOLE_ACCOUNT_VIEW_FIELDS` 白名单：`slug`、`display_name`、`mall_id`、`session_status`、`has_password`、`password_relogin_status`、`pending_actions`。待办为中文 kind/reason 与本地 `created_at`；账号绑定只选择落地页，会话可操作全部商家账号。
- 鉴权服务的 `createConsoleLink` 返回内部 ISO `expires_at`，命令视图转换为 v2 本地时间；`redeemConsoleToken` 返回 `{ sessionValue, accountSlug }`，HTTP 侧立即把前者解构为 `consoleSession`。
- 为保持函数短小，将 HTTP 防护、路由表、静态读取分别放在 `http.js`、`routes.js`、`static.js`。P4 可在 `CONSOLE_ROUTES` 增加条目并复用会话/写入防护。
- 新增 adapter 的 `getAuthStateMetadata` 只读元数据入口；账号列表无需解密保存的 Cookie，也能展示最新校验结论。
- `daemon start` 清理失效实例的旧地址，并等到有效租约与监听地址同时就绪；正常停止按 ownerTag 保护地址清理，强制停止在原有归属事务中一起清理地址。
- 静态 MIME 表兼容 `.js` 与 `.mjs`，配合并行 P5 的 vendored ESM。`design.md`、`knip.json`、`public/app/**` 和 `vendor/**` 的并行改动保持原样，本报告文件清单仅列本轮负责内容。
- 需求范围保持 P3；未扩展数据表、公开配置或运行时依赖。已同步 P3 的运行生命周期、存储辅助签名和服务接口规范。

## 改动文件

### 新增运行文件

- `src/commands/console.js`
- `src/commands/registry/console.js`
- `src/daemon/server.js`
- `src/daemon/http.js`
- `src/daemon/routes.js`
- `src/daemon/static.js`
- `src/services/console-auth.js`
- `src/services/console-accounts.js`
- `src/services/console-runtime.js`
- `src/services/views/console.js`
- `src/console/public/index.html`

### 修改运行文件

- `bin/pdd.js`
- `src/adapter/auth-state.js`
- `src/commands/daemon.js`
- `src/daemon/run.js`
- `src/infra/daemon-state.js`
- `src/services/daemon-runtime.js`
- `src/services/daemon.js`
- `src/services/views/labels.js`

### 测试文件

- 新增 `test/services/console-auth.test.js`
- 新增 `test/daemon/server.test.js`
- 新增 `test/daemon/static.test.js`
- 新增 `test/e2e/console.e2e.test.js`
- 新增 `test/helpers/console-http.js`
- 修改 `test/services/daemon.test.js`
- 修改 `test/e2e/daemon.e2e.test.js`
- 修改 `test/helpers/daemon-cli.js`
- 修改 `test/contract/data-contract-v2.test.js`

### 规范与任务记录

- `.trellis/spec/architecture/runtime-lifecycle.md`
- `.trellis/spec/infra/sqlite-storage.md`
- `.trellis/spec/services/domain-service-contracts.md`
- `.trellis/tasks/10-27-daemon-console/implement.md`
- `.trellis/tasks/10-27-daemon-console/p3-report.md`
