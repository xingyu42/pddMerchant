# 01: 无环鉴权叶模块与静态断链预重构（`assertAuthTask` + `CandidateSeal`）

**What to build:** 将商家鉴权任务守卫 `assertAuthTask` 与实例级候选凭证冻结签章 `CandidateSeal` 各自下沉为无环纯内存叶模块，打断“商家存储 → 商家鉴权 → 浏览器 → 分发器 → 鉴权夹具”的环形依赖并彻底清除夹具中的运行期动态导入；同步切断商家凭证核验对浏览器启动器、以及登录态存储对全局模拟分发器的静态导入边，使后续轻量重登策略模块能在零浏览器、零夹具依赖下安全加载。契约与不变量参见 `../spec.md`。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 任务守卫 `assertAuthTask` 与实例级 `CandidateSeal` 各自独立成 `infra` 无环纯内存叶模块
- [x] 鉴权夹具消除对商家鉴权存储模块的运行期动态导入，使用统一叶模块校验任务边界与签章材料
- [x] 实例级 `CandidateSeal` 支持隔离创建，多个实例之间验证材料互不串扰（取代单靠模块级共享集合的耦合）
- [x] 切断商家凭证核验向浏览器启动器的静态导入，以及登录态存储向全局模拟分发器的静态导入
- [x] 现有鉴权与存储单元测试保持全部通过且 `npm run check`（含 `knip`）通过

## Comments

- 2026-11-25: 已合入 `feat/runtime-adapter-seams`（合并提交 `08d46be`）。共变更 23 个文件：新增无环叶模块 `src/infra/auth-task.js`（`assertAuthTask`）、`src/infra/candidate-seal.js`（`createCandidateSeal`）与 `src/adapter/consumer-auth.js`（`isConsumerAuthValid`）及对应 3 个单元测试文件；消除 `src/adapter/fixtures/auth.js` 中的运行期动态导入；切断 `src/adapter/merchant-auth.js -> browser.js` 与 `src/adapter/auth-state.js -> mock-dispatcher.js` 静态导入并同步更新调用方与测试。合入后执行 `npm run check` 全量通过：`npm run lint`（`knip`）退出码 0；`npm test`（`vitest run`）144 个测试文件全部通过（`144 passed (144)`），2388 个用例通过、1 个 Windows 环境用例跳过（`2388 passed | 1 skipped (2389)`，耗时 `73.48s`）。
