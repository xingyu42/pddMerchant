# 实施计划：config 配置管理命令

## 当前进度（2026-07-18）

- `show/set/unset/validate`、maintenance 启动策略、分层 inspection、Schema 单字段解析、项目内路径限制和同目录原子写入均已实现。
- 补充了枚举/URL 解析、非对象 JSON 原文件保护、配置文件符号链接逃逸和新进程重载本地配置的验收证据。
- 定向矩阵 9 files / 102 tests 通过；全量主跑 140 files / 1158 tests 通过、1 file skipped，仅 `auth-lock` 因 Windows 沙箱 `tasklist Access denied` 失败，正常权限下单文件复跑 6/6 通过。
- 测试全程使用临时配置根；仓库真实 `config/config.json` 未创建或修改。

## 前置门槛

- 确认父任务 `07-18-config-example-runtime-defaults` 已完成并通过配置、runner、daemon 和完整测试。
- 读取父任务最终 Schema/API，不按本计划中的暂定函数名平行实现第二套逻辑。
- 使用 `trellis-before-dev` 加载 CLI、infra、测试层规范后再启动本子任务。

## 1. 先补配置维护原语

- 从父任务 Schema 导出安全的公开字段枚举/单字段解析入口。
- 增加分层 inspection，记录 baseline/local/env/CLI 的有效性和每字段最终来源。
- 增加本地配置编辑读取器，明确区分不存在、合法对象、Schema 无效、JSON 语法损坏、非对象和不可读。
- 增加项目边界检查以及同目录原子写入 helper。
- 先写 `test/config-management.unit.test.js`，覆盖类型解析、候选整体校验、未知字段、损坏文件、原子失败和路径逃逸。

## 2. 实现命令处理器

- 新增 `src/commands/config.js`，实现 `show/set/unset/validate` 的薄编排。
- config handler 不读取秘密环境变量，不直接拼装错误 envelope，不使用浏览器或鉴权 runner。
- 对 `set` 返回写入值及更高层覆盖提示；对 `unset` 返回删除/no-op 和回退来源。
- 本地候选合法即允许写入；写后重新 inspection，其他层仍无效时返回 `runtime_invalid_after_edit`，但不回滚已成功的本地修复。
- daemon 使用字段发生变化时返回 `restartRequired`/warning，不调用 daemon stop/start。
- 为命令处理器加入定向单元测试，使用临时项目内测试根或可注入路径，禁止写仓库真实 `config/config.json`。

## 3. 注册维护启动策略

- 新增 `src/commands/registry/config.js`，注册四个子命令与参数。
- 扩展 `bin/pdd.js` wiring，使 config 子命令显式采用 `maintenance` 策略；普通命令默认仍为 `required`。
- 保证 `--help/--version` 零配置依赖，config 维护命令使用最小默认 logger。
- 更新 help baseline 和命令 smoke 测试。

## 4. E2E 与故障恢复测试

- 临时配置根下测试 `show` 的 local/env 来源和 overridden 标记。
- 测试 `set` 数字、布尔、枚举、URL/字符串成功与非法值失败。
- 测试 `unset` 已知字段、未知错误字段和不存在字段。
- 测试其他配置层无效时本地合法编辑仍落盘，并准确返回 `runtimeValid: false` 和 warning。
- 测试 daemon 字段变更只报告重启需求，不改变 daemon 状态；普通 CLI 新进程读取新值。
- 测试 `validate` 能报告基线、本地、环境变量层错误且不泄露原始值。
- 测试本地 JSON 语法损坏、根值非对象、不可读时原文件字节不变。
- 测试 config 目录/file 符号链接或目录联接逃逸时，项目外目标不被修改。
- 测试模拟写入/rename 失败时原配置完整、临时文件得到清理。

## 5. 文档与验证

- README 命令表和配置章节增加 `pdd config show/set/unset/validate`，说明只管理项目内公开本地覆盖。
- 明确环境变量优先于本地设置，秘密字段仍只能安全注入，命令不会写 `.env`。
- 运行：
  - `npx vitest run test/config.unit.test.js test/config-management.unit.test.js`
  - `npx vitest run test/config.smoke.test.js test/e2e/config.e2e.test.js test/e2e/help-baseline.e2e.test.js`
  - `npx vitest run test/json-purity.test.js test/error-envelope.unit.test.js`
  - `npm test`
  - `git diff --check`
- 检查 diff 只包含该子任务文件；保留工作区既有无关暂存改动。

## 风险与回滚点

- 最大风险是维护命令被普通配置启动门槛提前阻断；必须先用损坏配置 e2e 验证可达性。
- 路径边界和原子写入属于不可拆分的安全条件，不能先合入非原子 `writeFile(CONFIG_PATH)` 版本。
- config 命令不得扩大父任务公开字段范围；若发现需要新字段，应回到父任务 Schema 评审。
- 不实现 `reset`、批量导入、交互编辑器或跨进程锁；这些若确有需求另建任务。
