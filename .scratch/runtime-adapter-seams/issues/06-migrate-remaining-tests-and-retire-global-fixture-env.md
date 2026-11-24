# 06: 测试 env 迁移（批次二：剩余领域单测）与全局测试初始化收口（Contract）

**What to build:** 完成剩余全部操纵测试环境变量的非 E2E 领域与命令测试向组合根 `overrides` / `env` 的迁移，随后正式从全局测试初始化配置中撤除 `PDD_TEST_ADAPTER=fixture` 默认环境注入（继续保留每用例隔离临时 SQLite 数据库、`NO_COLOR=1` 与真实浏览器/网络硬拦截），消除测试套件对隐式全局模式变量的依赖，达成所有单元与集成测试零串扰独立通过。参见 `../spec.md`。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] 剩余全部 26 个操作环境变量的非 E2E 测试文件（含全部切换 `PDD_TEST_ADAPTER` 的用例）迁移完毕，零残留跨层 `vi.mock` 与全局复位调用
- [ ] 全局测试初始化脚本撤除 `PDD_TEST_ADAPTER=fixture` 默认环境注入，保留临时 SQLite、`NO_COLOR=1` 与 `patchright` / `fetch` 硬拦截
- [ ] 更新相关本地开发与测试文档中关于无全局单例测试方式与组合根注入的说明（同步通过 `doc-paths` 校验）
- [ ] 运行全量 `npm run check`（`knip` 与全量 Vitest / Fixture E2E）一次通过
