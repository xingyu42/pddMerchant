# 实施计划：统一项目运行配置与默认值

## 当前进度（2026-07-18）

- 14 个公开默认字段已统一落在 `config/config.example.json`，普通 CLI 与 daemon 共用严格分层 loader。
- endpoint 限流、写节流、源抓取冷却、类目 API、消费者登录 URL、Mall ID 严格解析和标题改写均改为运行配置注入；对应模块不再读取公开环境变量或复制默认值。
- 父子任务联合定向矩阵 19 files / 215 tests 通过；完整测试 140 files / 1158 tests 通过、1 file skipped，仅 `auth-lock` 因 Windows 沙箱 `tasklist Access denied` 失败。本轮较早的正常权限单文件复跑为 6/6 通过，本次再次申请因执行额度限制未获准。
- `git diff --check` 通过；仓库真实 `config/config.json` 未创建或修改，既有无关暂存改动保持不纳入本任务提交。

## 1. 配置契约与基线

- 新增 `config/config.example.json`，写入 PRD 确认的 14 个默认字段。
- 在 `src/infra/paths.js` 导出项目内示例配置路径。
- 重构 `src/infra/config.js`：严格分层读取、类型转换、完整基线校验、`E_CONFIG_INVALID`、不可变运行快照；删除 `RUNTIME_DEFAULTS`。
- 新增 `test/config.unit.test.js`，先覆盖成功优先级与所有文件/Schema失败路径。

## 2. 普通 CLI 与 runner 接入

- 在 `bin/pdd.js` 的 command action 中加载配置、应用 CLI 覆盖并用有效 log 配置初始化 logger。
- 将配置快照作为 runner 独立输入，扩展 `buildCommandCtx()` 为 live/fixture 提供 `ctx.runtimeConfig`。
- 确认 batch 只加载一次并复用快照，直接命令单元测试可显式注入测试配置。
- 覆盖普通 CLI 配置错误 envelope、timeout/default mall/auth path 和日志配置优先级测试。

## 3. 迁移公开运行参数消费者

- endpoint limiter/cooldown：`src/adapter/rate-limiter-singleton.js`、`rate-limiter.js`、`single-lifecycle.js`、`run-endpoint.js`。
- 写节流：`src/infra/rate-control.js` 与 `src/services/goods-publish.js`。
- 源抓取冷却：`src/infra/scrape-cooldown.js`、`src/services/goods-publish.js`、`source-scraper.js`、登录成功重置路径。
- 类目 API：`src/adapter/goods-publish/category-resolver.js` 与 goods-publish 调用处。
- 消费者登录 URL：`consumer-qr-login.js`、`services/auth.js`、`commands/login.js`。
- Mall ID 严格解析：`mall-id.js` 与 mall 切换调用链。
- 标题改写：`goods-publish.js`。
- 每迁移一组即删除对应直接 env 读取和重复默认值，并运行该组定向测试。

## 4. 文档与漂移说明

- 更新 `.env.example`：说明环境变量是 `config.json` 的覆盖层，补齐有效公开映射。
- 不把安全/测试/秘密开关写入 JSON 示例。
- 明确标注折扣、图片变换、`PDD_PUBLISH_COST_TEMPLATE_ID` 等当前没有生产调用边的配置，不把它们伪装成已生效配置。

## 5. 验证

- `npx vitest run test/config.unit.test.js test/command-runner.unit.test.js test/daemon-lifecycle.unit.test.js`
- `npx vitest run test/rate-limiter-jitter.unit.test.js test/infra/rate-control.test.js test/infra/scrape-cooldown.unit.test.js test/goods-publish-softblock-integration.unit.test.js`
- `npx vitest run test/category-resolver.unit.test.js test/consumer-login-timeout.unit.test.js test/goods-publish.unit.test.js`
- 运行相关 CLI fixture e2e，确认配置文件、环境变量与 CLI 参数优先级以及单行 JSON envelope。
- `npm test`
- `git diff --check`
- 检索纳入字段对应的 `process.env` 与重复常量，确认只剩配置装配器中的集中映射。
- 检查 diff 仅包含本任务文件，保留现有无关暂存改动。

## 风险与顺序约束

- CLI 接入必须先于消费者删除默认值，否则会出现未初始化配置窗口。
- 单例按配置快照首次构造；测试必须 reset，禁止跨测试污染。
- module import 阶段不得读取需要运行配置的字段，否则 CLI action 注入太晚。
- 配置错误信息不得输出原始 JSON 或环境变量值。
