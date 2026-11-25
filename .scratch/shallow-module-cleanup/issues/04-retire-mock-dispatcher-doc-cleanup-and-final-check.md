# 04: `isMockEnabled` / `mock-dispatcher` 最终退役、`mall-switcher` 文档精准清理与全仓收口

**What to build:** 作为协同规格群的最终收口票（在 P0-1 至 P1-4 全部完成分支迁移并消除最后调用方后执行）：彻底移除已零调用方的废弃 `isMockEnabled` 导出与全局模拟分发器模块，清理相关测试技能与鉴权技能中的引用路径；严格将 `mall-switcher` 清理限定在项目架构导航技能第 56 行的已撤除旧模块条目（完整保留店铺读写源码内的页面 DOM 选择器与中文提示文案），并同步刷新架构总览中的最新模块图谱、无全局单例测试方式及完整 ADR 索引；最终全仓运行 `npm run check`（`knip` 零孤立导出/未引用文件、`doc-paths`、`data-contract-v2`、全量 Vitest 与 E2E）一次通过验收。参见 `../spec.md`。

**Blocked by:** 02, 03, goods-publish-deepening#05, command-lifecycle-unification#04, auth-console-login-deepening#04

**Status:** resolved

- [x] 确认全仓源码与测试已无 `isMockEnabled` 或全局模拟分发器残留调用后整文件移除该模块，并清理相关技能文档引用
- [x] 仅移除架构导航技能第 56 行 `mall-switcher` 过时模块引用，核验店铺读取与切换实现中的所有页面 DOM 选择器与中文提示文案原封保留
- [x] 刷新架构总览文档以反映 P0-1 至 P2-5 落地后的最新模块拓扑、无单例测试接缝、完整 ADR 列表与现行存储内接缝原则
- [x] 全仓执行 `npm run check`（`knip`、`doc-paths`、`data-contract-v2`、全部单测与 E2E）100% 绿色通过（零孤立导出、零未列出导入、零死文档路径）

## Comments

- Merged `ticket/shallow-module-cleanup-04` (`5281263561bf71bda33a129b69d3b1cdd47e6637`) into `feat/phase3-lifecycle-and-cleanup` via `--no-ff` merge commit `6f73a0fb3bde273fc9cc9f5e936ee522b3d1c568`.
- Verification: `npm run check` passed 100% (`npm run lint` / `knip` exited 0; `npm test` / Vitest passed `179 passed (179)` files, `2792 passed | 1 skipped (2793)` tests in 81.97s).
