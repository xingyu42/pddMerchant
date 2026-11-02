# 移除 LoginToken 消费路径

## Goal

LoginToken 消费路径（任务 `10-11-login-token-consumption`）实测无效：服务端会话过期后无法续期，未过期会话也恢复不成功。移除这批未提交改动，为后续 SQLite 存储与密码重登清出干净基线。

父任务：`10-27-password-relogin-console`。本任务是子任务 ①，无前置依赖；子任务 ② 依赖本任务完成。

## Requirements

- N1 丢弃 `10-11` 任务产生的未提交改动：工作区中已修改的 14 个文件（`AGENTS.md`、`src/adapter/browser.js`、`src/adapter/merchant-auth-probe.js`、`src/adapter/merchant-auth-storage.js`、`src/adapter/merchant-auth.js`、`src/commands/doctor.js`、`src/commands/runner/single-lifecycle.js`、`src/infra/logger.js`、`src/services/auth.js` 及 5 个测试/测试辅助文件）和 2 个未跟踪文件（`src/adapter/merchant-token-consumption.js`、`test/adapter/merchant-token-consumption.test.js`）。
- N2 丢弃前逐 hunk 审查，把与 LoginToken 消费无关、且本身有价值的修复单独列出；清单交用户确认后才执行丢弃，被确认保留的 hunk 单独保留。
- N3 保留已提交（HEAD）的 `PASS_ID` 相关代码：`merchant-auth-probe.js` 的请求前有效性检查、`logger.js` 的脱敏键。它们负责判断会话是否失效，后续密码重登依赖它们触发。
- N4 未跟踪的 `.dsh-ops-update-*.lock` 不属于本任务，保持不动。
- N5 将 `10-11-login-token-consumption` 归档为放弃，在其 PRD 写明放弃原因（未过期会话也恢复不了；服务端过期后无法续期），并注明被父任务 `10-27-password-relogin-console` 取代。
- N6 撤销已提交 spec 中的 LoginToken 消费规则：`.trellis/spec/adapter/auth-mall-context.md`（Token 来源、`repair_credential`、消费与恢复相关条款及用例）与 `.trellis/spec/adapter/browser-runtime.md`（内部 storageState 条款改写为通用表述，保留该能力）。`docs/login-token-ck-principles.md` 保留为历史文档，在开头注明消费路径已放弃。

## hunk 审查清单（2026-10-27，待用户确认）

审查时忽略行尾差异（`git diff --ignore-cr-at-eol`）。工作区中多数文件被整体改成了 LF 行尾，这部分随丢弃一并还原。

| 文件 | 改动 | 建议 | 理由 |
|---|---|---|---|
| `AGENTS.md` | 末尾新增两行回答句式约束（“禁止使用‘不是A而是B’……”） | **保留** | 用户个人规则，与 Token 无关 |
| `src/adapter/browser.js` | `launchBrowser` 接受内存中的 `storageState`，并校验与 `storageStatePath` 互斥及结构合法 | **保留** | 与 Token 无关；② 的 N7（从库中读出 auth-state 后直接在内存中交给浏览器）正好需要 |
| `test/adapter/auth-snapshot-context.test.js` | 对应上一项的用例 “accepts internal storageState input …” | **保留** | 随 `browser.js` 一起保留 |
| `src/adapter/merchant-auth-probe.js` | `selectMerchantCookies` / `deriveLoginToken` / `deepFreeze`，把三个目标的 Cookie 选择提前，Cookie 名称增加 `\r\n` 检查 | 丢弃 | 主体服务于派生 LoginToken；`COOKIE_NAME` 正则在 JS 中已无法匹配 `\r\n`，新增检查冗余；HEAD 已有三目标 PASS_ID 一致性校验 |
| `src/adapter/merchant-auth.js` | 候选材料加入 `login_token`，`freeze` 改为引用 `deepFreeze` | 丢弃 | Token 专用 |
| `src/adapter/merchant-auth-storage.js` | `repair_credential` 来源材料的写入与更新 | 丢弃 | Token 专用 |
| `src/adapter/merchant-token-consumption.js`（未跟踪） | 消费路径主体 | 丢弃 | Token 专用 |
| `src/commands/doctor.js` | doctor 改为事务内消费恢复，并让 `PddCliError` 向上抛出 | 丢弃 | Token 专用；② 会重写 doctor 的存储交互 |
| `src/commands/runner/single-lifecycle.js` | 普通命令接入 `prepareMerchantContext` | 丢弃 | Token 专用 |
| `src/services/auth.js` | login 复用时消费来源材料、在材料非法时重置授权 | 丢弃 | Token 专用 |
| `src/infra/logger.js` | `REDACT_KEYS` 新增 `repair_credential` | 丢弃 | 字段随消费路径一起消失 |
| `test/adapter/auth-probe.test.js`、`merchant-auth-lifecycle.test.js`、`merchant-auth-storage.test.js` | 消费路径相关用例 | 丢弃 | 随实现一起丢弃，还原为 HEAD 版本 |
| `test/helpers/error-matchers.js` | `isRedactedCandidateError`（`E_AUTH_CANDIDATE_INVALID`） | 丢弃 | 只被消费路径用例使用 |
| `test/adapter/merchant-token-consumption.test.js`（未跟踪） | 消费路径测试 | 丢弃 | Token 专用 |

用户确认结果（2026-10-27）：按清单执行，保留 3 处，其余丢弃。丢弃通过 `git stash push -u` 完成，在用户明确要求删除前保留该 stash 以便恢复。

## Acceptance Criteria

- [x] hunk 审查清单已交用户确认，确认结果记录在本 PRD。
- [x] `git status` 中不再有 LoginToken 消费相关的已修改或未跟踪文件（用户确认保留的 hunk 除外）。
- [x] `npm test` 全量通过。
- [x] `10-11` 已归档且写明放弃原因与取代关系。
- [x] spec 中无残留的 LoginToken 消费规则。

## Notes

- 丢弃属于不可逆操作，执行前必须拿到用户对清单的确认。
- 本任务只做 git 层面的丢弃与文档归档，不编写新代码，由 Claude 执行。

## 执行记录（2026-10-27）

- 丢弃：`git stash push -u`，stash 名为“10-11 LoginToken consumption (abandoned, 10-27 password-relogin-console)”；随后重新应用保留的 3 处 hunk。
- 剩余工作区改动：`AGENTS.md`、`src/adapter/browser.js`、`test/adapter/auth-snapshot-context.test.js`、`docs/login-token-ck-principles.md`（状态注记），无行尾噪声。
- 测试：`npm test` 30 个文件 / 413 个用例全部通过。
- spec：`auth-mall-context.md` 撤销 Token 来源、`repair_credential`、消费恢复及 doctor 恢复写入条款，签名与 HEAD 代码对齐；`browser-runtime.md` 内部 storageState 条款改为通用表述。`.trellis/` 被 gitignore，spec 修改不进入 git。
- 归档：`10-11-login-token-consumption` → `archive/2026-10/`（`--no-commit`）。
