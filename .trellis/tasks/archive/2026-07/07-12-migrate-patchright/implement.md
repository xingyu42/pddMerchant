# 迁移浏览器运行时到 Patchright：实施计划

## Execution Status (2026-07-12)

- Patchright `1.61.1` 已成为唯一生产 Chromium 运行时；对应 Chromium 149 已安装并完成无网络本地启动验证。
- 固定 Chrome 130 UA、手工 Chromium args、`stealth-scripts.js`、`PDD_FINGERPRINT_SEED` 及其测试/指南已移除。
- 新增 `getBrowserExecutablePath()` 与 `evaluateInMainWorld()` adapter seam；所有依赖页面全局、React fiber 或页面 fetch 的 Page evaluate 已迁移到主上下文。
- 定向测试通过；`npm audit --omit=dev --registry https://registry.npmjs.org` 为 0 vulnerabilities；`git diff --check` 通过。
- `npm test`：126/127 文件、976/977 测试通过。唯一失败为未修改的 `test/pbt/auth-lock.pbt.test.js`，seed=42、sample=30055，Windows sandbox 执行 `tasklist` 返回 `Access denied`。
- `npx vitest run --exclude test/pbt/auth-lock.pbt.test.js`：126/126 文件、971/971 测试通过。
- 代码审查修复后已在沙箱外以 seed=42 复验 auth-lock PBT：6/6 通过；随后完整 `npm test`：128/128 文件、977/977 测试通过，AC8 已完成。
- 审查修复：删除误提交的认证状态测试文件并隔离 doctor 子进程；doctor 校验可执行文件真实存在；空壳页优先映射 `E_RATE_LIMIT` 且保留消费者登录态；ghost-cursor 正确 await 并使用 bounding box；青果 tunnel 失败按 407 鉴权停止重试；详情图逐响应确认并在全失败时停止保存。
- 未经真实表单证明的多 SKU、属性映射、满件折扣不再猜测写入：多 SKU 在任何页面修改前 fail-closed，属性/折扣标记为未实现，对应 Trellis 子任务恢复 `planning`。

## 0. 实施前门禁

- [ ] 运行 `python ./.trellis/scripts/task.py current --source`，确认当前任务仍为 `07-12-migrate-patchright`。
- [ ] 加载 `trellis-before-dev`，读取 adapter、commands、infra、services、architecture、standards 相关规范。
- [ ] 保存并检查 `git status --short` 与以下重叠文件的现有 diff：`package*.json`、`src/adapter/browser.js`、`src/commands/doctor.js`、`src/services/auth.js`、`src/services/goods-publish.js`、README/`.env.example`。
- [ ] 不重置、不覆盖青果代理、消费者登录、doctor 和其他用户未提交改动。

## 1. 先建立失败测试

- [ ] 扩展 browser adapter 测试，约束统一 Patchright 入口、默认不覆盖 UA、不注入手工 stealth script、消费者 proxy 只进入其 fresh Context。
- [ ] 覆盖 `newContext()` 和 `newPage()` 部分初始化失败时的 Context 清理。
- [ ] 为 doctor 的 adapter 可执行文件接口与 Patchright 安装提示补充测试。
- [ ] 调整/删除只验证 `stealth-scripts.js` 与固定 fingerprint seed 的测试，使测试描述迁移后的真实契约而不是实现残留。
- [ ] 运行新增定向测试，确认迁移前按预期失败。

## 2. 替换依赖

- [ ] 使用 npm 安装精确版本 `patchright@1.61.1 --save-exact`，移除顶层 `playwright`/Rebrowser alias，让 npm 生成 lockfile。
- [ ] 运行 `npm ls patchright patchright-core playwright playwright-core --depth=2`，确认主运行时是 Patchright，并解释 ghost-cursor 的传递 `playwright-core`。
- [ ] 检查 `package-lock.json`，确认没有意外的第二个浏览器启动包、来源异常或无关大范围更新。
- [ ] 运行 `npm audit --omit=dev` 并记录结果；若存在新增高危漏洞，停止实现并回到规划。

## 3. 收敛浏览器适配边界

- [ ] 在 `src/adapter/browser.js` 中以唯一生产 import 接入 `patchright`。
- [ ] 保持 `launchBrowser()`、`withBrowser()`、`createConsumerContext()` 的调用接口和清理契约。
- [ ] 新增窄接口 `getBrowserExecutablePath()` 供 doctor 使用。
- [ ] 移除固定 Chrome 130 UA、手工 stealth script 注入及无证据的自定义 Chromium args。
- [ ] 保留当前 viewport、locale、timezone、deviceScaleFactor、storageState 和 consumer proxy 语义。
- [ ] 不引入 persistent context、真实 Chrome channel、userDataDir 或运行时选择开关。

## 4. 清理重复指纹配置

- [ ] 删除不再被使用的 `src/infra/stealth-scripts.js`，或在扫描确认仍有合法消费者时只移除浏览器运行时耦合；不得保留死代码。
- [ ] 删除相应的 fingerprint seed 测试、`.env.example` 配置和失效文档。
- [ ] 搜索 `PDD_FINGERPRINT_SEED`、`buildStealthScript`、`generateFingerprintProfile`、`DEFAULT_USER_AGENT`，确认没有悬空引用。
- [ ] 保留日志脱敏、账号降级、冷却和 breaker 逻辑，不把指纹信息加入输出。

## 5. 更新 doctor 与文档

- [ ] `src/commands/doctor.js` 改为通过 browser adapter 检查可执行文件，不直接导入浏览器包。
- [ ] 保持现有 `data.chromium`、`E_CHROMIUM_MISSING` 和 envelope 兼容，安装提示改为 `npx patchright install chromium`。
- [ ] 更新 README 安装命令与运行时说明。
- [ ] 更新 `docs/architecture-overview.md`、`.env.example` 和 fingerprint 相关文档，使其与实际代码一致。
- [ ] 搜索所有 `npx playwright install`、Rebrowser alias 和 fingerprint seed 文案，逐项处理。

## 6. 定向验证

- [ ] `npx vitest run test/adapter/browser-consumer-context.test.js test/pbt/with-browser.pbt.test.js test/pbt/browser-registry.pbt.test.js`
- [ ] `npx vitest run test/auth-state.unit.test.js test/auth-state-v03.unit.test.js test/auth-refresher-lifecycle.unit.test.js test/pbt/auth-state.pbt.test.js test/pbt/auth-refresher.pbt.test.js`
- [ ] `npx vitest run test/doctor-render.unit.test.js test/json-purity.test.js`
- [ ] `npx vitest run test/endpoint-route-cleanup.unit.test.js test/endpoint-lifecycle-cleanup.unit.test.js test/pbt/xhr-collector.pbt.test.js`
- [ ] `npx vitest run test/goods-publish.unit.test.js test/goods-publish.e2e.test.js test/pbt/goods-publish.pbt.test.js`
- [ ] `npx vitest run test/behavior-simulator.unit.test.js test/layering-guard.unit.test.js`
- [ ] 运行不访问 PDD 的本地导入/可执行路径检查，确认 `patchright.chromium.executablePath()` 可调用；若浏览器未安装，只报告需要运行的安装命令，不在测试中联网下载。

## 7. 完整质量门禁

- [ ] 运行 `npm test`。
- [ ] 若 PBT 失败，使用输出的 `PBT_SEED=<n>` 隔离复现并记录；不得以 Windows sandbox 波动为理由直接忽略。
- [ ] 可运行 `npm run lint` 但报告必须明确其为 no-op；不声称存在 lint 覆盖。
- [ ] 运行 `git diff --check`。
- [ ] 扫描生产源码：只有 browser adapter 导入 `patchright`，无 `from 'playwright'`，无运行时 `console.log`，无敏感数据进入日志/文档。
- [ ] 检查最终 `git diff`，确认迁移改动没有回退工作区既有修改。

## 8. 回滚点与完成条件

- [ ] 依赖替换后若 Patchright 无法加载：停止在步骤 2，不改认证文件，恢复本任务依赖 diff。
- [ ] browser adapter 定向测试失败且无法在当前接口内修复：回到设计，不向 service/command 泄露 Patchright 特有 API。
- [ ] route/XHR/goods publish 契约失败：停止，不以跳过测试或扩大真实网络 smoke 代替修复。
- [ ] 全部门禁通过后运行 `trellis-check`，按需要更新可执行规范，再提交用户审阅。
- [ ] 用户批准规划并明确开始实现后，才运行 `python ./.trellis/scripts/task.py start`；当前规划阶段不得提前启动。
