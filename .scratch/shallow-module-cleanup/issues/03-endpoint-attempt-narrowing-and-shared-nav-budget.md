# 03: 端点单次尝试大参数收窄与共享导航超时裁剪助手

**What to build:** 收窄端点单次尝试辅助接收的 10 字段大参数配置对象为清晰的分组传输钩子与精简选项，并从单次尝试辅助（`fetch` / `legacy`）与 `page-api` 导航准备逻辑之间抽取出模块内聚、单点维护的“带剩余预算裁剪的页面导航执行器”，统一 `navTimeout` 与 `remainingMs` 的裁剪规则、中止信号传播以及 `E_NETWORK` 错误包装契约，消除两处实现随后续维护发生漂移的风险。参见 `../spec.md`。

**Blocked by:** runtime-adapter-seams#06

**Status:** ready-for-agent

- [ ] 端点单次尝试辅助的 10 字段宽参配置收窄为内聚分组结构，内部调用清晰无冗余透传
- [ ] `page-api` 与 `fetch` / `legacy` 共同复用同一份带剩余预算裁剪的页面导航执行器与 `E_NETWORK` 错误包装逻辑
- [ ] 端点导航、预算裁剪、超时中止与响应契约测试全部通过，且 `npm run check` 全绿
