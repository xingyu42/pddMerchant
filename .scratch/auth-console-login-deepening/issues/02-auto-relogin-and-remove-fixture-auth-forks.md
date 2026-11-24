# 02: 单入口 `auto-relogin` 与 `reloginForFixture` / `checkFixtureMerchantSession` 双分叉退场

**What to build:** 建立单入口在线自动恢复模块 `auto-relogin`（对外统一提供 `recover`），由双组合根注入 P0-1 最小 `AuthPort`（含 `authoritative` 标志）、`BrowserRuntimePort`、实例级 `seal`、`commit` 与 `clock`，统一服务命令行恢复与巡航流程。保留外层命令预算暂停/恢复、90 秒独立子预算及 20 秒核验预留、继承 `Runtime Browser Profile`、获取 `PASS_ID` 后立即关页再经 `AuthPort` 独立执行 `Merchant Authentication Check` 确立 `Merchant Session Validity` 并作为**已验证重登凭据提交**（仅当 `authoritative` 为真时写入本地 SQLite 核验记录）后原子续期租约。同步在本工单彻底删除 `reloginForFixture` 与 `checkFixtureMerchantSession` 双重夹具分叉，清除巡航与会话刷新中的双轨分叉并迁移相关测试模块打桩。参见 `../spec.md`。

**Blocked by:** 01, runtime-adapter-seams#04

**Status:** resolved

- [x] `auto-relogin`（`recover`）统一承接命令与巡航重登，确保预算暂停/恢复、90 秒独立子预算、关页先于核验与非保留态关闭临时上下文
- [x] 原子提交遵循“经 `Merchant Authentication Check` 确立 `Merchant Session Validity` 后作为已验证重登凭据提交”，且仅当 `authoritative` 为真时写本地 SQLite 核验记录
- [x] 彻底删除 `reloginForFixture` 与 `checkFixtureMerchantSession` 双重夹具分叉，消除会话刷新与巡航模块中对应夹具分支与 `runtime.mode === 'fixture'` 临时过渡读法
- [x] 完成 `merchant-session` 与 `patrol` 单测中 `import * as relogin` 打桩向 `auto-relogin` / 内存 `AuthPort` 注入迁移，且核心 E2E 回归（`password-relogin*.e2e` 4 个、`patrol.e2e`、`merchant-auth.e2e`）及 `npm run check` 全绿

## Comments

- **2026-11-25**（合并提交 `95dc2ad44cb32c8a1c5a5cb9e917d0c52a3a8b4d`）：已合入 `ticket/auth-console-login-deepening-02`（原提交 `cf1010e7ba4e4e7742a27ca8491b236d6c5752e6`，共变更 22 个文件）。建立单入口 `src/services/auto-relogin.js`（`recover`）与 `test/services/auto-relogin.test.js`（6 个用例）；删除 `src/services/password-relogin.js` 及 `reloginForFixture`、`fixtureSessionRecovered`、`checkFixtureMerchantSession` 双重夹具分叉；将 `merchant-session.js`、`patrol.js` 与 `fixture-runtime.js` 统一切至 `auto-relogin`、`AuthPort`（含 `authoritative` 本地 SQLite 核验写控制）与 `BrowserRuntimePort`；完成 `merchant-session.test.js`、`patrol.test.js` 与 `password-relogin.test.js` 打桩迁移，同步更新 `.trellis/spec/` 与 `docs/architecture-overview.md`。合入后执行 `npm run check` 通过：`knip` 无多余导出/文件/依赖，Vitest 全量测试 `162 passed (162)`、`2583 passed | 1 skipped (2584)`（耗时 `124.66s`）。
