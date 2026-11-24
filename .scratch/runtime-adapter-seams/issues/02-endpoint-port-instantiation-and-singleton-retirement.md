# 02: `EndpointPort` / `EndpointTransportPort` 实例化与全局客户端单例退役

**What to build:** 建立规范外部端口 `EndpointPort`（挂载于命令上下文 `ctx.client`，对外公开 `call` 与 `execute` 并兼容既有的 `{ execute }` 测试桩）与末端单一接缝 `EndpointTransportPort.send`，完整封装策略解析、`page-api` 载荷与方法校验、实例级限流令牌桶、按端点冷却记账、HTTP 429 `[1000, 2000, 4000]` 指数退避、`interpretResponse` 与 `spec.normalize`。同时将夹具缓存 `FixtureStore` 转为实例级，彻底退役共享端点客户端单例模块及其全局复位后门；保留既有的无状态 `runEndpoint` 透传兼容层（读取上下文 `EndpointPort`，`ctx.page` 作为透传至端口的不透明令牌，缺失客户端时立即抛出 `E_CONFIG_INVALID`）并配套默认工作在 `raw` 上游响应层的 `createTestCtx`，将端点运行入口劫持替换为内存传输注入，并在同次变更内更新因全局限流器退役而受影响的技能路径引用。参见 `../spec.md`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `EndpointPort`（挂载于 `ctx.client`，含 `call` 与 `execute`，兼容 `{ execute }`）与单一内部 `EndpointTransportPort.send` 就位
- [ ] 限流令牌桶、按端点冷却表与 `FixtureStore` 转为按实例持有，共享端点客户端/限流全局单例及复位测试后门彻底移除
- [ ] `runEndpoint` 收窄为无状态转发辅助并保留不透明 `ctx.page` 令牌透传；缺失注入客户端时抛出 `E_CONFIG_INVALID` 杜绝静默回落
- [ ] Fixture 传输实现对齐共享管道（支持 `page: null`、跳过等待、保留分页与变体后缀、合成空页及 `__throws` 注入）
- [ ] 提供默认工作在 `raw` 上游响应层的 `createTestCtx`，原 12 处端点运行入口模块劫持迁移为内存 `EndpointTransportPort` 注入
- [ ] 同步更新受全局限流器模块退役影响的技能文档路径，确保契约守卫与 `npm run check` 通过
