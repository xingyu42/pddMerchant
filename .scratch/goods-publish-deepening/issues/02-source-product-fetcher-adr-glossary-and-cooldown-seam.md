# 02: `SourceProductFetcher` 深模块、ADR-0001 / 术语定稿与组合根冷却注入点

**What to build:** 将商品发布消费侧抓取、缓存与代理重试抽离为单一入口 `SourceProductFetcher` 深模块（`prepare` → `SourceAcquisition`）及纯计算 `source-normalizer`（含元转分与 v4 缓存白名单投影）；按 ADR-0003 的 `Amended YYYY-MM-DD` 格式修订 ADR-0001，并在术语表中将矛盾的旧词条 `Retryable Source Degradation` 退役记入 `_Avoid_`、正式定稿启用 **`Retryable Source Proxy Fault`**（明确仅 `E_PROXY_UNAVAILABLE` / `E_PROXY_NETWORK` 至多重试两次，反爬空壳与 `Consumer Account Degradation` 立即中止轮换）；同时在命令运行时组合根建立按实例创建的持久化软封冷却注入点，统一切换商品发布与消费端登录（若 `command-lifecycle-unification#03` 已先落地兜底逻辑则同步切换并撤除兜底），彻底取消全局软封冷却单例导出。参见 `../spec.md`。

**Blocked by:** 01, runtime-adapter-seams#04

**Status:** resolved

- [x] `SourceProductFetcher` 对外仅暴露 `prepare` 与 `SourceAcquisition`，严格执行先查 v4 缓存（命中短路）、未命中再查冷却与校验 `Proxy-Required Fetch` 配置的执行顺序
- [x] 每轮代理抓取从 `BrowserRuntimePort` 派生继承 `Runtime Browser Profile` 的只读 `Proxy Attempt Context`，仅在 `E_PROXY_UNAVAILABLE` / `E_PROXY_NETWORK` 按 `[500, 1000]ms` 至多重试两次（产出 `source_proxy_retry_recovered`），`ERR_TUNNEL_CONNECTION_FAILED` 单次中止，反爬空壳先于缺价/缺 SKU 判定并各自执行对应冷却或删态恢复
- [x] `source-normalizer` 收口消费端观测归一化与 v4 缓存读写/白名单投影，仅在保存校验或确认提交成功后清理缓存（清理失败产出 `source_cache_cleanup_failed` 告警并保持主结果成功）
- [x] 完成 ADR-0001（`Amended YYYY-MM-DD` 节）与 `GLOSSARY.md`（退役 `Retryable Source Degradation` 至 `_Avoid_`，定稿启用 `Retryable Source Proxy Fault`）的规范与术语同步
- [x] 组合根按实例建立持久化软封冷却注入点并消除全局单例导出；`loginConsumer` 同步切至组合根冷却实例（移除共享配置兜底），通过 `source-normalizer` 单测与 `npm run check`

## Comments

- **2026-11-25**（合并提交 `8d680d05d2968c9a2eeb42a7e1c3246a22792d8e`）：已合入 `ticket/goods-publish-deepening-02`（原提交 `dad882caf54fb028ff4f60cbe5a7f479f5728285`，共变更 22 个文件）。拆出 `src/services/goods-publish/source-normalizer.js` 与 `src/services/goods-publish/source-product-fetcher.js`（移除 `src/adapter/goods-publish/source-sku-normalizer.js` 并解耦 `source-scraper.js`）；按 `Amended 2026-11-25` 更新 `docs/adr/0001-scope-qingguo-proxy-to-source-fetch.md` 与 `GLOSSARY.md`（将 `Retryable Source Degradation` 退役至 `_Avoid_`，正式启用 `Retryable Source Proxy Fault`）；在 `composeCommandRuntime` 建立实例级 `scrapeCooldown` 注入点并接入 `SourceProductFetcher` 与 `loginConsumer`（`src/services/auth.js`/`src/commands/login.js`），取消全局单例 `getSharedScrapeCooldown` 导出；新增 5 个测试文件（`source-normalizer`、`source-product-fetcher`、`goods-publish-source-cache`、`scrape-cooldown`、`login-consumer`）。合入后执行 `npm run check` 通过：`knip` 无多余导出/文件/依赖，Vitest 全量测试 `160 passed (160)`、`2556 passed | 1 skipped (2557)`（耗时 `90.09s`）。
