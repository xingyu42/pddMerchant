# 02: 单入口 `auto-relogin` 与 `reloginForFixture` / `checkFixtureMerchantSession` 双分叉退场

**What to build:** 建立单入口在线自动恢复模块 `auto-relogin`（对外统一提供 `recover`），由双组合根注入 P0-1 最小 `AuthPort`（含 `authoritative` 标志）、`BrowserRuntimePort`、实例级 `seal`、`commit` 与 `clock`，统一服务命令行恢复与巡航流程。保留外层命令预算暂停/恢复、90 秒独立子预算及 20 秒核验预留、继承 `Runtime Browser Profile`、获取 `PASS_ID` 后立即关页再经 `AuthPort` 独立执行 `Merchant Authentication Check` 确立 `Merchant Session Validity` 并作为**已验证重登凭据提交**（仅当 `authoritative` 为真时写入本地 SQLite 核验记录）后原子续期租约。同步在本工单彻底删除 `reloginForFixture` 与 `checkFixtureMerchantSession` 双重夹具分叉，清除巡航与会话刷新中的双轨分叉并迁移相关测试模块打桩。参见 `../spec.md`。

**Blocked by:** 01, runtime-adapter-seams#04

**Status:** ready-for-agent

- [ ] `auto-relogin`（`recover`）统一承接命令与巡航重登，确保预算暂停/恢复、90 秒独立子预算、关页先于核验与非保留态关闭临时上下文
- [ ] 原子提交遵循“经 `Merchant Authentication Check` 确立 `Merchant Session Validity` 后作为已验证重登凭据提交”，且仅当 `authoritative` 为真时写本地 SQLite 核验记录
- [ ] 彻底删除 `reloginForFixture` 与 `checkFixtureMerchantSession` 双重夹具分叉，消除会话刷新与巡航模块中对应夹具分支与 `runtime.mode === 'fixture'` 临时过渡读法
- [ ] 完成 `merchant-session` 与 `patrol` 单测中 `import * as relogin` 打桩向 `auto-relogin` / 内存 `AuthPort` 注入迁移，且核心 E2E 回归（`password-relogin*.e2e` 4 个、`patrol.e2e`、`merchant-auth.e2e`）及 `npm run check` 全绿
