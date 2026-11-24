# 01: 无环鉴权叶模块与静态断链预重构（`assertAuthTask` + `CandidateSeal`）

**What to build:** 将商家鉴权任务守卫 `assertAuthTask` 与实例级候选凭证冻结签章 `CandidateSeal` 各自下沉为无环纯内存叶模块，打断“商家存储 → 商家鉴权 → 浏览器 → 分发器 → 鉴权夹具”的环形依赖并彻底清除夹具中的运行期动态导入；同步切断商家凭证核验对浏览器启动器、以及登录态存储对全局模拟分发器的静态导入边，使后续轻量重登策略模块能在零浏览器、零夹具依赖下安全加载。契约与不变量参见 `../spec.md`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 任务守卫 `assertAuthTask` 与实例级 `CandidateSeal` 各自独立成 `infra` 无环纯内存叶模块
- [ ] 鉴权夹具消除对商家鉴权存储模块的运行期动态导入，使用统一叶模块校验任务边界与签章材料
- [ ] 实例级 `CandidateSeal` 支持隔离创建，多个实例之间验证材料互不串扰（取代单靠模块级共享集合的耦合）
- [ ] 切断商家凭证核验向浏览器启动器的静态导入，以及登录态存储向全局模拟分发器的静态导入
- [ ] 现有鉴权与存储单元测试保持全部通过且 `npm run check`（含 `knip`）通过
