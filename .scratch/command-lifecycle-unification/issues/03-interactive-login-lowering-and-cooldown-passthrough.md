# 03: `init` / `login` 交互授权下沉（独立交互登录适配入口与无阻塞冷却兜底）

**What to build:** 在适配器层建立独立交互登录适配入口（商家有头/扫码登录 `loginMerchantInteractive` 与消费端交互登录 `loginConsumerInteractive`，使 P0-1 的 `AuthPort` 维持最小 3 方法边界），将 `init`、`login` 与 `login.consumer` 的编排与视图投影全面下沉至认证领域模块（`loginMerchant`、`loginConsumer`、`createQrTerminalPresenter`，扫码提示与二维码字符画严格写入注入的 `streams.stderr` 流以守住 `--json` 单行纯净）。两命令接入 `withCommand`（`local` 预设、配置交互式 `defaultTimeoutMs` 与动态命令名区分 `login` / `login.consumer`），修复 `init` 漏传 `--no-color`，保留进程内 `login --consumer --password` 返回 `command: 'login.consumer'` 与 `E_USAGE` 的命令接缝，并让下沉后的 `loginConsumer` 接收可选注入的 `scrapeCooldown` 实例（与 P0-2 无阻塞并行：尚未注入时先沿用既有共享冷却配置兜底，待 `goods-publish-deepening#02` 切换并移除兜底）；同步收回 `login` 的命令层直连适配器例外。参见 `../spec.md`。

**Blocked by:** 01

**Status:** resolved

- [x] 新增 `loginMerchantInteractive` / `loginConsumerInteractive` 适配入口；`init` 与 `login` 命令彻底消除适配器层直接导入与 `isMockEnabled()` / 过渡分岐
- [x] `init`、`login`、`login.consumer` 经统一执行内核发出含 `correlation_id`、真实耗时、`noColor` 与协作式 `Ctrl+C`/超时浏览器清理的标准信封，全部二维码输出严格仅落入 `streams.stderr`
- [x] `loginConsumer` 完整保留 `uid` 校验（`E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH`）、进程内 `--password` 拦截接缝（`E_USAGE` exit 2）及可选注入冷却参数（默认沿用共享冷却兜底，无缝兼容与 P0-2 并行或先后合并）
- [x] 注入内存 `streams`/`clock`/适配器的命令与领域单测、Fixture E2E 及 `npm run check` 全绿

## Comments

- Merged `ticket/command-lifecycle-unification-03` (`20a3d2352e784f1f62be7f6d3e82ece50bd9af0e`) into `feat/phase3-lifecycle-and-cleanup` via `--no-ff` merge commit `69fa263829d7e89a2414556d29608cb220311d66`.
- Verification: `npm run check` passed 100% (`npm run lint` / `knip` exited 0; `npm test` / Vitest passed `178 passed (178)` files, `2780 passed | 1 skipped (2781)` tests in 80.32s).
