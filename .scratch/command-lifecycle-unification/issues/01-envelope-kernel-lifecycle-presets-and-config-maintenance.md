# 01: 统一 `envelope-kernel`、封闭 `lifecycle` 预设与 `config.*` 维护模式收口

**What to build:** 在命令执行器内部收敛出共享的 `envelope-kernel`（支持按选项求值的函数式动态命令名、统一计时与 `correlation_id`、协作式 `defaultTimeoutMs` 超时与两阶段防重复发射守门——进入 `withCommand` 后经 `OutputSink.emit` 精确发射一次，CLI 主入口从处理函数单点读取 `runtimeConfigPolicy` 并仅在 `hasEmitted()` 为假时兜底发射）；引入互斥的三种 `lifecycle` 预设（`merchant` / `local` / `maintenance`）与加载期非法组合校验，保持 `needsAccount: true ≡ 'required'`、缺省或未传预设且含 `needsBrowser: false` 自动归入 `local`、`merchant`/`local` 沿用 `'required'` 配置策略，确保既有 30 个 `merchant` 业务命令零改动。首切片同步将 `config.{show,set,unset,validate}` 下沉为配置维护领域服务并接入 `withCommand` 的 `maintenance` 预设（验证损坏 JSON 配置下仍可诊断/修复并输出含 `correlation_id` 与正确 `noColor` 的 v2 信封）。参见 `../spec.md`。

**Blocked by:** runtime-adapter-seams#04

**Status:** resolved

- [x] `envelope-kernel` 落地动态命令名、`correlation_id`、协作超时、`noColor` 与两阶段防重复发射守门（`hasEmitted()` 精确一次）
- [x] `merchant`、`local`、`maintenance` 三种互斥预设及加载期非法组合断言就位，30 个业务命令与 `console`/`daemon`/`goods.cost.*` 向后兼容且 `local` 拒绝 `--all-accounts`（`E_USAGE`）
- [x] `config.{show,set,unset,validate}` 下沉为配置维护领域入口并声明 `lifecycle: 'maintenance'`（`runtimeConfigPolicy: 'maintenance'`），领域单测可直测 `PddCliError`、命令层产出标准错误信封且配置损坏时依然可达
- [x] 全量命令超时、运行期与配置编辑契约测试及 `npm run check` 通过

## Comments

- Merged `ticket/command-lifecycle-unification-01` (`69b5b2440060749bcc5696fb62daad3c8eb53ad0`) into `feat/phase3-lifecycle-and-cleanup` via `--no-ff` merge commit `5d13247ca655cb61338962006b1ba85bc70634cf`.
- Verification: `npm run check` passed 100% (`npm run lint` / `knip` exited 0; `npm test` / Vitest passed `174 passed (174)` files, `2743 passed | 1 skipped (2744)` tests in 78.56s).
