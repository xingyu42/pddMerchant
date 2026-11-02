# 技术设计：统一项目运行配置与默认值

## 架构边界

`src/infra/config.js` 是唯一配置装配器，只负责读取、类型转换、分层校验、合并和冻结。业务含义仍由各 service/adapter 所有，但通过显式 `runtimeConfig` 使用值，不再读取纳入范围的 `process.env`。

## 配置数据流

```text
config/config.example.json (required)
          ↓
config/config.json (optional sparse override)
          ↓
mapped PDD_* environment variables
          ↓
explicit CLI overrides
          ↓
validated frozen runtimeConfig
       ↙                         ↘
bin/pdd.js → runner → ctx          bin/pdd-daemon.js
```

每一文件层先独立使用严格 Schema 校验，再参与合并。最终结果使用完整运行 Schema 校验，确保所有基线字段存在。

## Schema 与环境变量

- `BaseConfigSchema`：允许本地配置覆盖的公开字段，拒绝未知字段。
- `RuntimeBaselineSchema`：在 Base Schema 上要求 PRD 列出的 14 个默认字段齐全。
- 数字环境变量必须是有限数并满足正数/非负数边界；布尔变量只接受明确的 `1/0` 或 `true/false`；URL 使用 Zod URL 校验。
- 安全、测试和秘密环境变量不进入文件 Schema，继续由原有受限入口读取。

## CLI 注入

1. Commander action 先得到命令参数，并提取明确提供的运行覆盖项。
2. 调用 `loadRuntimeConfig()`；失败由现有 command envelope 路径输出 `E_CONFIG_INVALID`。
3. 使用有效配置创建 logger。
4. 将 `timeoutMs/defaultMall/authStatePath` 作为命令缺省值合并，但不覆盖显式 CLI 参数。
5. 将冻结对象作为独立 runner 输入；`buildCommandCtx()` 同时提供原有 `ctx.config` 与新增 `ctx.runtimeConfig`。
6. batch 为所有账号复用同一快照；不得每个账号重新读取文件。

`--help`/`--version` 不进入 action，因此不会因为运行配置损坏而阻断查看帮助。

## 模块迁移

- `rate-limiter-singleton.js`：由 `ctx.runtimeConfig` 构造 limiter/cooldown；保留 reset 接口，删除模块级 env 读取和重复默认值。
- `rate-control.js`：共享写节流器接收 `writeRateTokensPerMinute`；burst/jitter 继续作为内部算法常量。
- `scrape-cooldown.js`：调用方显式传入阈值/时长；状态路径保持原项目内路径。
- `category-resolver.js`：API base 由调用方传入；重试与熔断内部常量不开放。
- `consumer-qr-login.js`/`services/auth.js`：消费者登录 URL 沿调用链显式传递。
- `mall-id.js`/mall 切换路径：显式传入 `mallIdStrictParse`。
- `goods-publish.js`：标题改写、源抓取冷却、写节流、类目 API 均取自 `ctx.runtimeConfig`。
- logger 与 runner：普通 CLI 开始真正使用现有 log/timeout/mall/auth 配置字段。

## 错误契约

- 配置错误统一使用 `PddCliError(code="E_CONFIG_INVALID", exitCode=GENERAL)`。
- 普通 CLI 走现有 envelope；daemon 保持 stderr fatal 与退出 1。
- detail 只包含 `source`、脱敏/项目相对路径、Zod issue path/code；不包含配置值。

## 兼容与迁移

- 所有纳入默认值保持当前数值或布尔行为，未提供本地配置时结果不变。
- 合法环境变量仍可覆盖；变化仅是非法值从静默回退改为明确失败。
- 本地 `config.json` 可以只写差异，不需要复制基线。
- 未生效配置不借此次重构获得新功能，避免把配置整理变成商品发布功能扩张。

## 回滚

回滚可恢复各模块原默认值与直接 env 读取，同时移除 CLI 配置注入；没有数据格式迁移，也不修改认证状态或账号文件。

