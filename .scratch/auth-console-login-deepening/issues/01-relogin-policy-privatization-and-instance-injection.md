# 01: 零浏览器 `relogin-policy` 深化（私有化底层记账、注入 `seal`/`commit` 与调用方切换）

**What to build:** 基于 P0-1 已切断的静态导入链与无环 `assertAuthTask` / `CandidateSeal` 叶模块，建立严格零浏览器、零 Playwright、零夹具导入的纯本地 `relogin-policy` 策略模块：提供轻量只读摘要（`getReloginSummary`、`getAccountActionWarnings`，在主密钥不配套或密文损坏时依然可读）、凭据与熔断管理写操作、纯设备态提取 `extractDeviceState`（克隆并剔除所有 `PASS_ID`，区别于 `Merchant Cookie Repair`）、门禁决策 `decideRelogin`（可配置默认值 `passwordReloginMinIntervalMs` 控制 30 分钟冷却，放行前零解密）。直接在既有 `beginReloginAttempt` 基础上将 `recordReloginAttempt` 与 `recordReloginOutcome` 私有化并迁移相应单测，为其显式增加组合根注入的实例级 `seal`（`CandidateSeal`）与 `commit` 入参（保持 `credentialUpdatedAt` 版本守卫与失败事务回滚不变）；同步将环境诊断与账号管理中对 `getReloginSummary` 的导入切换至 `relogin-policy`。参见 `../spec.md`。

**Blocked by:** runtime-adapter-seams#01, runtime-adapter-seams#04

**Status:** ready-for-agent

- [ ] `relogin-policy` 实现严格零浏览器、零网络与零夹具导入
- [ ] `recordReloginAttempt` 与 `recordReloginOutcome` 私有化；`beginReloginAttempt` 接收显式注入的实例级 `seal` 与 `commit` 并完成尝试前落库、陈旧版本守卫、签章验证与短事务 CAS 提交
- [ ] 将原直接测试私有底层记账辅助的单测断言迁移至 `beginReloginAttempt` 并覆盖 30 分钟可配置默认节流、版本守卫与回滚保持内存原值
- [ ] 环境诊断与账号管理命令切换从 `relogin-policy` 导入 `getReloginSummary`
- [ ] 全量测试与 `npm run check`（`knip` 无多余导出）通过
