# 02: `SourceProductFetcher` 深模块、ADR-0001 / 术语定稿与组合根冷却注入点

**What to build:** 将商品发布消费侧抓取、缓存与代理重试抽离为单一入口 `SourceProductFetcher` 深模块（`prepare` → `SourceAcquisition`）及纯计算 `source-normalizer`（含元转分与 v4 缓存白名单投影）；按 ADR-0003 的 `Amended YYYY-MM-DD` 格式修订 ADR-0001，并在术语表中将矛盾的旧词条 `Retryable Source Degradation` 退役记入 `_Avoid_`、正式定稿启用 **`Retryable Source Proxy Fault`**（明确仅 `E_PROXY_UNAVAILABLE` / `E_PROXY_NETWORK` 至多重试两次，反爬空壳与 `Consumer Account Degradation` 立即中止轮换）；同时在命令运行时组合根建立按实例创建的持久化软封冷却注入点，统一切换商品发布与消费端登录（若 `command-lifecycle-unification#03` 已先落地兜底逻辑则同步切换并撤除兜底），彻底取消全局软封冷却单例导出。参见 `../spec.md`。

**Blocked by:** 01, runtime-adapter-seams#04

**Status:** ready-for-agent

- [ ] `SourceProductFetcher` 对外仅暴露 `prepare` 与 `SourceAcquisition`，严格执行先查 v4 缓存（命中短路）、未命中再查冷却与校验 `Proxy-Required Fetch` 配置的执行顺序
- [ ] 每轮代理抓取从 `BrowserRuntimePort` 派生继承 `Runtime Browser Profile` 的只读 `Proxy Attempt Context`，仅在 `E_PROXY_UNAVAILABLE` / `E_PROXY_NETWORK` 按 `[500, 1000]ms` 至多重试两次（产出 `source_proxy_retry_recovered`），`ERR_TUNNEL_CONNECTION_FAILED` 单次中止，反爬空壳先于缺价/缺 SKU 判定并各自执行对应冷却或删态恢复
- [ ] `source-normalizer` 收口消费端观测归一化与 v4 缓存读写/白名单投影，仅在保存校验或确认提交成功后清理缓存（清理失败产出 `source_cache_cleanup_failed` 告警并保持主结果成功）
- [ ] 完成 ADR-0001（`Amended YYYY-MM-DD` 节）与 `GLOSSARY.md`（退役 `Retryable Source Degradation` 至 `_Avoid_`，定稿启用 `Retryable Source Proxy Fault`）的规范与术语同步
- [ ] 组合根按实例建立持久化软封冷却注入点并消除全局单例导出；`loginConsumer` 同步切至组合根冷却实例（移除共享配置兜底），通过 `source-normalizer` 单测与 `npm run check`
