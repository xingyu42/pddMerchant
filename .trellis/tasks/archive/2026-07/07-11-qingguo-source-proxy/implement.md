# 实施计划

## 1. 读取规范与确认现状

- 阅读 architecture、adapter、infra、services、standards 相关 spec。
- 核对 `publishGoodsFromLink()`、`createConsumerContext()`、`scrapeSourceGoods()`、scrape cooldown、errors/logger 的当前契约。
- 检查工作区已有未提交改动，避免覆盖前一任务或用户改动。

## 2. 增加青果适配模块

- 在 goods-publish adapter 范围内新增青果专用模块。
- 实现环境变量启用与单项 AuthKey 完整性校验。
- 使用原生 `fetch` 调用按量 `/get`，固定 `num=1&distinct=true`。
- 实现 10 秒超时、上层 abort 传播、响应归一化和 30 秒有效期保护。
- 将青果错误映射为 `E_PROXY_AUTH`、`E_PROXY_QUOTA`、`E_PROXY_RATE_LIMIT`、`E_PROXY_UNAVAILABLE`、`E_PROXY_NETWORK`。
- 确保原始 URL、响应和凭据不进入日志或错误。

## 3. 扩展消费者上下文

- 为 `createConsumerContext()` 增加可选 HTTP proxy 配置。
- 消费者登录和源商品抓取统一使用现有桌面 viewport、Windows UA、locale、timezone、storageState 和 stealth 初始化。
- 确认 context close 覆盖成功、失败和中断路径。

## 4. 实现 Phase A 有界代理重试

- 未启用代理时保留原单次直连路径。
- 启用代理后每次即时获取 lease，创建新 context，完成后关闭。
- 最多 3 次尝试；基础设施失败退避 500ms/1000ms。
- 仅为代理临时故障重试。
- 价格或 SKU 首次缺失即确认消费者账号降级，停止重试并永久删除当前消费者登录态。
- 账号降级不写入全局软封冷却；硬风控、登录失效、配置/认证/额度错误和 abort 同样立即失败。
- 重试恢复成功时加入 `source_proxy_retry_recovered` warning。
- 调整 `src/commands/goods/publish.js` 的结果接线，把 service warnings 交给 runner 的保留 `warnings` 通道，确保最终进入 `meta.warnings` 且不丢失现有发布警告。

## 5. 日志、错误和文档

- verbose日志仅记录供应商、尝试号、地区、运营商、剩余时间、结果分类和脱敏 request ID。
- 保持JSON单行与envelope顶层契约。
- 更新相关环境变量文档和 goods-publish 文档；不记录真实凭据。
- 保持 `pdd doctor` 为登录在线检查，不加入代理或真实商品页探测。
- 若实现暴露了稳定的新项目约束，Phase 3.3 再评估写入 `.trellis/spec/`。

## 6. 验证

- 先运行受影响的现有 targeted tests，至少覆盖 source scraper soft risk、goods publish、browser/config、logger/output相关测试。
- 若实现导致现有测试无法表达新行为，或发现实际缺陷，按用户确认范围补最小测试；否则不新增测试。
- 覆盖账号降级首次停止、登录态永久删除、删除失败关闭、无全局冷却写入和代理基础设施重试。
- 运行 `npm test`。
- 检查 `git diff`，确认商家端及其他命令未获得代理配置。
- 人工配置青果环境变量，执行一次真实商品草稿模式，确认源抓取可继续到后续阶段。
- 用 verbose日志检查重试摘要与凭据脱敏；测试后不保存或提交任何真实凭据。

## Rollback Points

- 青果适配模块可独立回退，不影响直连默认路径。
- 消费者 context proxy 参数可单独撤回。
- Phase A 重试重构若影响现有冷却语义，回退至原单次 `breaker.wrap('scrape')` 路径后重新设计。

## 验证结果（2026-07-11）

- 定向测试通过：青果配置/租约、消费者 context、软封延迟、发布重试、fixture e2e、PBT、JSON purity、warnings 与 layering guard。
- `npm run lint` 执行成功，但脚本实际仅输出 `no-lint`，不代表存在真实 lint 覆盖。
- 初次 `npm test` 通过：126 个测试文件、984 个测试。AuthKey 命名简化后再次全量运行时，唯一失败为无关的 `test/pbt/auth-lock.pbt.test.js` 时序用例（seed=42）；按 `PBT_SEED=42` 单独复现时 6/6 通过。青果相关定向测试 79/79 通过。
- `git diff --check` 无 whitespace error；仅报告仓库现有的 Windows LF/CRLF 转换提示。
- 真实青果草稿 smoke 已执行，但代理 CONNECT 返回 HTTP 407，尚未进入源商品页面或创建草稿；结果见下节。

### 真实 smoke 尝试（2026-07-11）

- 商品：`916356966351`。
- 青果提取接口成功返回 3 个不同地区的短效节点，说明 `PDD_QINGGUO_AUTH_KEY` 配置有效。
- 三次 Playwright 访问均在连接阶段得到 `E_PROXY_NETWORK`，未回退直连、未创建草稿。
- 随后使用新租约进行独立 `curl` CONNECT 探测，得到 HTTP 407（归类为 `proxy_auth`）。结论：当前节点仍要求代理鉴权，或本机出口 IP 尚未加入青果白名单；不是 PDD 页面空壳或价格脱敏问题。
- 下一步：在青果控制台启用/补齐本机出口 IP 白名单后重试；若账号必须使用账密模式，则需要重新引入可选的代理用户名/密码配置。

### 白名单生效后重试（2026-07-11）

- 独立 CONNECT 探测已从 HTTP 407 变为 HTTP 200，确认白名单和无节点账密模式可用。
- 真实发布再次提取 3 个不同节点，三次均成功连接 PDD，但源页面全部返回价格缺失、SKU 为空的 `E_RISK_CONTROL_SOFT`。
- 最终按预算停止，未回退直连、未进入类目/表单/保存阶段、未创建草稿；持久软封信号仅在耗尽后记录一次，当前未达到跨命令冷却阈值。
- 该结果说明代理接入链路已真实跑通，但本次三个出口与当前消费者登录快照组合仍被 PDD 价格脱敏。不要在同一命令内继续突破三次预算。

### 账号降级处置变更（2026-07-11）

- 价格或 SKU 首次缺失即返回 `E_RISK_CONTROL_SOFT`，不再提取第二个代理。
- 账号降级后永久删除当前消费者登录态；删除失败返回 `E_AUTH_STATE_DELETE_FAILED` 并保持失败关闭。
- 账号降级不写入全局 `scrape-cooldown.json`；新消费者账号登录成功后清除旧抓取冷却，允许立即进行一次尝试。
- 定向验证通过：7 个测试文件、90 个测试。
- 完整 `npm test`：126 个文件通过、1 个文件失败；989 个测试通过、1 个失败。失败为既有 `test/pbt/auth-lock.pbt.test.js`，`seed=42`，当前 Windows sandbox 返回 `Access denied`，与本次账号降级逻辑无关。
- `npm run lint` 仅输出 `no-lint`；`git diff --check` 无 whitespace error，仅有现存 LF/CRLF 提示。

### 商家端重新登录后的旧消费者状态 smoke（2026-07-12）

- 本轮仅重新登录了商家后台账号。商家 auth cookie 指纹从 `fp:3fdba35f` 更新为 `fp:e629fa65`；消费者 auth cookie 指纹始终为旧的 `fp:4a44dc15`，没有执行新的消费者账号登录。
- 沙箱外 `pdd doctor --json` 只确认商家端和旧消费者登录态当时均可通过首页在线检查。
- 商品 `916356966351` 的首次青果节点提取和连接成功，节点地区为河北唐山、移动，未发生直连回退。
- PDD 将旧消费者登录态对应的页面跳转到 `psnl_identify.html` 验证页；页面价格缺失、SKU 为空，首次尝试返回 `E_RISK_CONTROL_SOFT`。
- 系统未申请第二个代理，立即删除 `data/consumer-auth-state.json`；错误 detail 确认 `consumer_account_degraded=true`、`consumer_auth_removed=true`。
- 失败后磁盘核查：消费者登录态文件不存在；`scrape-cooldown.json` 计数为 0、截止时间为 0，确认账号降级未污染全局冷却。
- 未进入类目填写、表单保存或正式提交阶段，未创建商品草稿。
- 本轮不能证明新消费者账号是否可用；真实成功验收仍需先执行 `pdd login --consumer` 生成全新的消费者登录态，再重新 smoke。

### 消费者环境统一为桌面（2026-07-12）

- `createConsumerContext()` 默认改用与主浏览器一致的 Windows Chromium UA 和 `1920x1080` 视口，不再伪装 iPhone。
- 消费者二维码登录、消费者在线检查和源商品抓取共享同一桌面 context 默认值；代理仍只注入源抓取 context。
- 定向验证通过：6 个测试文件、74 个测试。
- 完整 `npm test`：126 个文件通过、1 个文件失败；991 个测试通过、1 个失败。唯一失败仍为 Windows sandbox `Access denied` 导致的既有 `auth-lock` PBT，`seed=42`。
- `npm run lint` 仅输出 `no-lint`；`git diff --check` 无 whitespace error，仅有现存 LF/CRLF 提示。
