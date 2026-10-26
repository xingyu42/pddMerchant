# 统一项目运行配置与默认值

## Goal

将实际生效、已有公开配置入口的运行参数统一到项目内的 `config/config.example.json`，让普通 CLI 与 daemon 使用同一套默认值、环境变量映射和本地覆盖规则，消除 config、infra、service、adapter 各自读取默认值的分裂状态。

## Background

- 当前仓库没有 `config/` 目录；`loadConfig()` 只尝试读取可选的 `config/config.json`，任何读取或 JSON 错误都会静默变成空对象。
- `loadRuntimeConfig()` 目前只有 daemon 使用，普通 CLI 不读取它。
- daemon 的 `RUNTIME_DEFAULTS` 包含限流四项和刷新两项；限流四项又在 `rate-limiter-singleton.js`、`rate-limiter.js` 重复定义，普通 CLI 实际走 adapter 中的默认值。
- 其他实际生效的公开运行参数仍直接读取 `process.env`，包括写操作 TPM、源抓取软封冷却、类目 API、消费者登录 URL、Mall ID 严格解析和标题改写。
- 全仓核验还发现若干看似公开但没有生产调用边的配置：`PDD_FULL_COUNT_DISCOUNT_RATE` 只有读取函数和测试，`PDD_IMAGE_TRANSFORM` 只改变返回文案而未执行图片变换，`PDD_PUBLISH_COST_TEMPLATE_ID` 仅出现在文档，`apiBase/profileDir` 等 Schema 字段没有消费者。本任务不得把这些字段写入默认文件并误报为有效功能。

## Runtime Defaults In Scope

`config/config.example.json` 必须完整提供以下唯一默认值：

- `logLevel: "warn"`
- `rateLimitQps: 2`
- `rateLimitBurst: 3`
- `cooldownThreshold: 3`
- `cooldownMs: 300000`
- `refreshIntervalMs: 600000`
- `refreshJitterMs: 120000`
- `writeRateTokensPerMinute: 20`
- `scrapeSoftBlockThreshold: 2`
- `scrapeSoftBlockCooldownMs: 7200000`
- `categoryApiBase: "https://api.gj.dangxun.com"`
- `consumerLoginUrl: "https://mobile.yangkeduo.com/login.html"`
- `mallIdStrictParse: true`
- `titleRewrite: true`

以下已有可选项继续受 Schema 支持，但因为没有通用默认值，不要求出现在示例基线：`timeoutMs`、`defaultMall`、`authStatePath`、`logDestination`。

## Requirements

### R1 配置来源与失败边界

- 加载优先级固定为：强制 `config.example.json` → 可选 `config.json` → 环境变量 → 本次 CLI 参数；后者覆盖前者。
- `config.example.json` 缺失、不可读、JSON 损坏、缺少任一基线字段或 Schema 无效时，抛出 `E_CONFIG_INVALID` 并停止实际命令/daemon；`--help` 与 `--version` 不需要加载运行配置。
- `config.json` 不存在时允许运行；存在但不可读、JSON 损坏、未知字段或 Schema 无效时，同样明确失败。
- 文件层、环境变量层和 CLI 覆盖层分别解析与校验，禁止后续层掩盖前一层本身的错误。
- 错误只暴露配置路径、问题字段和原因，不输出原始文件内容或敏感值。

### R2 普通 CLI 与 daemon 统一

- 普通 CLI 在 Commander 完成参数解析后、进入命令 runner 前加载运行配置；daemon 使用同一个 loader。
- `logLevel`、`logDestination` 在创建 logger 时生效；`timeoutMs`、`defaultMall`、`authStatePath` 只在对应 CLI 参数未提供时作为默认值。
- 命令选项仍保存在 `ctx.config`；已校验运行配置通过独立的 `ctx.runtimeConfig` 显式传递，禁止新增可变全局配置单例。
- fixture 与 live 路径获得相同的 `runtimeConfig`，批量账号执行必须继承同一不可变快照。

### R3 迁移实际生效的公开运行参数

- 全局 endpoint 限流与冷却、写操作 TPM、源抓取软封冷却、类目 API 地址、消费者登录 URL、Mall ID 严格解析和标题改写均改为读取 `runtimeConfig` 或显式参数。
- 对应环境变量继续支持，并集中映射到 `ConfigSchema`；业务模块不再直接读取这些环境变量。
- 纳入范围的默认值不得继续在 `RUNTIME_DEFAULTS`、infra、service 或 adapter 中重复硬编码。
- 已存在但未生效的配置不得在本任务中顺便实现；应保持现状并在文档中标明不属于有效运行配置。

### R4 明确排除

- 安全/调试/测试专用开关继续只允许环境变量：`PDD_ALLOW_INSECURE_AUTH_STATE`、`PDD_DEBUG_RAW`、`PDD_TEST_ADAPTER`、fixture 路径/登录失效模拟、`PDD_SCRAPE_SIMULATE`。
- 代理 AuthKey、主密码等敏感值继续只允许安全环境来源，不进入 JSON 配置。
- 类目重试次数、青果租约下限、鉴权锁、导航/XHR 超时、会话健康、浏览器一致性参数等内部常量不新增为用户配置。
- Commander 的分页/诊断窗口/ROI/低库存等命令默认值、业务算法常量以及默认 dry-run/草稿等安全边界继续留在代码中。
- 不新增项目外配置目录或系统用户目录写入。

## Acceptance Criteria

- [x] 无本地 `config.json` 时，普通 CLI 与 daemon 均从同一 `config.example.json` 得到全部基线字段。
- [x] 本地文件、环境变量和 CLI 参数按既定优先级覆盖，且环境变量的数字、布尔和 URL 类型得到严格校验。
- [x] 示例文件缺失/损坏/缺字段/非法，本地文件损坏/未知字段/非法时均稳定返回 `E_CONFIG_INVALID`，不静默降级。
- [x] 普通命令的 `ctx.runtimeConfig` 与 daemon 有效配置一致；fixture、live、单账号和批量路径不分叉。
- [x] endpoint 限流、写操作 TPM、源抓取冷却、类目 API、消费者登录 URL、Mall ID 严格解析和标题改写均使用注入配置，相关模块不再直接读取对应环境变量。
- [x] `PDD_LOG_LEVEL`、`PDD_LOG_DESTINATION`、`PDD_TIMEOUT_MS`、`PDD_DEFAULT_MALL` 和 `PDD_AUTH_STATE_PATH` 对普通 CLI 实际生效，并保持 CLI 参数最高优先级。
- [x] 安全/测试开关和敏感值没有进入 JSON Schema 或示例配置；`--json` 单行输出、日志脱敏、默认 dry-run/草稿行为不变。
- [x] 未生效的折扣、图片变换和文档孤儿字段没有被误列为有效默认配置。
- [x] 定向配置/runner/限流/商品上货测试与完整 `npm test` 通过；现有无关工作区改动不被修改。

## Technical Notes

- `config.example.json` 是运行时基线而非复制模板；`config.json` 只需保存差异，因此新增带默认值字段不会要求用户合并本地文件。
- 为测试提供可注入的基线和本地配置路径，测试不得改写仓库真实配置。
- 运行配置在加载后冻结；共享 rate limiter 等单例必须由该快照构造并保留现有 reset 测试接口。
