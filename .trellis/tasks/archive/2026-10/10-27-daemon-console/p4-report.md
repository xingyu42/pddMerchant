# P4 交互式重登、接管、扫码实施报告

## 结果

实现 password / QR 登录会话、CDP 接管、SSE 最新帧、指针/文字/按键输入、取消/超时/熔断、同账号替换及全局两个账号限制。会话结束统一关闭浏览器并释放账号租约，终态保留五分钟。成功通过共享的 `saveMerchantLogin` 路径校验、提交并处理人工登录状态；人工成功清零连续接管超时计数，保留既有熔断状态语义。

链接 GET 预览仅返回外部脚本页面；`/app/redeem.js` 发起带 JSON/自定义头的公开 POST `/api/redeem`，消费 token 并设置会话 Cookie，然后按 `{ location }` 导航。更新原有 P3 回归测试和规范。

工作基于 `feat/daemon-console` 的 `4e471c3`。本轮未提交，未增加依赖，未改 `CLAUDE.md`、`src/console/public/app/app.js`、`styles.css`、`index.html`。后续 P5 人工走查、P6 巡航和 P7 其余文档保持原阶段安排。

## 验证

- 最终定向：`npx vitest run test/adapter/takeover.test.js test/services/console-login.test.js test/services/password-relogin.test.js test/daemon/ test/e2e/console-login.e2e.test.js test/e2e/console.e2e.test.js test/e2e/password-relogin.e2e.test.js --maxWorkers=2`，11 个文件、164 项通过。
- 追加前端计时起点重置回归后，`npx vitest run test/adapter/takeover.test.js test/daemon/sse.test.js`，2 个文件、9 项通过。
- 最终全量：`npm test -- --maxWorkers=2`，62 个文件通过，944 项通过、1 项平台跳过（共 945 项），退出码 0，耗时 135 秒。
- `git diff --check` 通过；受保护文件的 `git diff --exit-code` 通过，HEAD 仍为 `4e471c3`。
- 定向覆盖 CDP start/ack/最新帧节流/串行输入/坐标/时间间隔/按键白名单/取消清理、SSE 慢连接丢帧与客户端断开、fixture 图片实际解码、兑换脚本的请求/跳转/中文 410 提示。
- 服务测试使用模拟浏览器及现有 HTTPS probe 接缝，实际执行核验和共享提交：覆盖设备延续、70 秒预算、事务外浏览器工作、身份不符/核验拒绝/CAS 冲突时旧材料保留、部分启动失败、QR 同上下文刷新、3/10 分钟精确超时和五分钟终态清理。
- fixture daemon e2e 使用随机端口与临时 DB，验证挑战 → 接管 → SSE/input → 成功 → 待办关闭 → 普通命令复用标记且密码尝试次数不增加；两次超时熔断/解除；QR；同账号替换/第三账号 429；停止时流关闭。响应、SSE、stdout/stderr 和 CLI/daemon 日志均检查合成密码及登录名未泄露。
- 首次有限并发全量发现一条旧 e2e 仍要求人工登录保留超时计数，已按 D5 改为计数清零且保留熔断和待办；定向回归通过。首次默认并发运行被中断，后续以两个 worker 完整复跑。项目没有构建或类型检查步骤；no-op lint 未计作验证。

## 接口与实现说明

- 前端契约保持原样：状态严格使用八个约定值，GET 会话只返回 `{ state, message, remaining_seconds, expires_at, qr_image }`；SSE 为 `event: frame`、`{ jpeg, width, height }`。身份不符的固定错误码放在安全中文 `message` 中，维持五字段响应。
- 为直接复用原有提交逻辑，额外导出了 `saveMerchantLogin` 与 `commitFixtureRelogin`。后者用于 fixture 的同一短事务内标记提交、人工成功及密码成功状态更新。
- `latest-frames.js` 拥有通用最新帧缓冲，真实 CDP 和 fixture 共用；fixture 输入使用真实校验函数。`console-login-browser.js` 收纳浏览器步骤，daemon 仍只导入 service。
- 前端重挂载会重置 `performance.now()` 计时起点，输入通道接受新批次的时间轴重置；批内仍要求时间单调，正向批间间隔继续按原值重放，前端无需修改。
- fixture 控制路由仅在 fixture dispatch 匹配；live 返回 404。二维码刷新保留最初三分钟窗口，等待同一上下文中的刷新完成后再核验。接管窗口从通道就绪后开始，取消和扫码超时保持计数原值。
- 账号租约沿用③的等待规则：普通等待预算 15 秒；最近 `last_attempt_at` 仍可能触发既有的密码重登等待延长（最多到尝试开始后 105 秒，且受调用者截止时间限制）。本轮未扩大租约基础设施范围。

## 改动文件

新增运行文件：

- `src/adapter/takeover.js`
- `src/adapter/latest-frames.js`
- `src/adapter/console-login-fixture.js`
- `src/services/console-login.js`
- `src/services/console-login-browser.js`
- `src/daemon/sse.js`
- `src/console/public/app/redeem.js`

修改运行文件：

- `src/services/password-relogin.js`
- `src/services/auth-account-storage.js`
- `src/services/console-runtime.js`
- `src/daemon/routes.js`
- `src/daemon/http.js`
- `src/daemon/server.js`

新增测试：

- `test/adapter/takeover.test.js`
- `test/services/console-login.test.js`
- `test/daemon/sse.test.js`
- `test/daemon/redeem.test.js`
- `test/e2e/console-login.e2e.test.js`

修改测试：

- `test/services/password-relogin.test.js`
- `test/daemon/server.test.js`
- `test/e2e/console.e2e.test.js`
- `test/e2e/password-relogin.e2e.test.js`

规范与任务：`auth-mall-context.md`、`browser-runtime.md`、`fixture-mode.md`、`domain-service-contracts.md`；本任务 `prd.md`、`design.md`、`implement.md` 与本报告。

## 真机待验

本轮仅执行离线自动化，未访问真实账号或平台。仍需逐项授权验证手机触点转鼠标后的滑块认可、SSE 延迟/拖动精度、真实扫码刷新与相册识别、首次短信接管后的设备信任及后续免短信情况。真实 Patchright/CDP、HTTPS 反代流式转发和 Windows/Linux 浏览器回收也需环境验证；原 N26/N27 验收保持后续阶段。
