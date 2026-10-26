# 技术设计：config 配置管理命令

## 依赖与实施边界

本子任务在 `07-18-config-example-runtime-defaults` 完成并通过验证后实施。它复用父任务建立的 `BaseConfigSchema`、完整运行配置 Schema、环境变量映射、项目内配置路径和 `E_CONFIG_INVALID`，不维护第二份字段表、默认值或合并算法。

父任务产出的是“加载配置后运行命令”的正常入口；本子任务额外提供“配置本身有问题时仍能诊断和有限修复”的维护入口。二者共享解析与校验原语，但启动策略不同。

## CLI 结构

```text
pdd config
├── show
├── set <key> <value>
├── unset <key>
└── validate
```

- 在 `src/commands/registry/config.js` 注册命令，在 `bin/pdd.js` 的固定顺序中加入 config 分组。
- 命令实现放在 `src/commands/config.js`，只编排输入、调用 infra 配置 API 并返回统一 envelope 数据。
- 文件解析、字段类型转换、分层诊断、路径约束和原子写入放在 `src/infra/config.js` 或紧邻的单一 infra 模块；命令层不直接操作 JSON 文件。
- config 命令不进入鉴权、店铺切换、浏览器或 endpoint 生命周期。

## 启动策略

父任务会让普通 `wireAction()` 在执行命令前加载完整运行配置。如果配置损坏，直接复用普通入口会导致 `config validate/set/unset` 也无法启动，因此 wiring 增加明确策略参数：

```text
runtimeConfigPolicy = required   # 普通命令，默认
runtimeConfigPolicy = maintenance # config 四个子命令
```

`maintenance` 策略只建立最小 logger 和标准错误输出，不先要求完整运行配置有效。具体子命令再调用共享配置 API：

- `show`：要求最终有效配置可构造；失败时返回分层问题。
- `validate`：始终完成分层检查后返回诊断结果，不因第一处错误提前丢失其他层问题。
- `set/unset`：读取原始本地对象，完成受控修改后严格校验本地候选对象；候选合法即可落盘，再检查整体运行配置并报告剩余层错误。

`--help`/`--version` 仍由 Commander 直接处理，不接触任何配置文件。

## 共享配置 API

父任务 Schema 是唯一字段真相，本子任务在其上提供以下窄接口（最终命名可按现有代码风格调整）：

- `inspectConfig({ env, cliFlags, paths })`：返回每层的有效性、最终有效配置、本地覆盖和每字段来源。
- `parseWritableConfigField(key, rawValue)`：从 Schema 获取字段定义并解析 CLI 字符串，不复制字段类型表。
- `readLocalConfigForEdit(path)`：区分不存在、合法对象、JSON 语法损坏、不可读和非对象 JSON。
- `writeLocalConfigAtomic(path, object)`：在项目边界内原子写入格式化 JSON。
- `setLocalConfigValue(...)` / `unsetLocalConfigValue(...)`：构造候选对象、整体校验、写入并返回差异。

分层诊断返回结构化 issue：

```js
{
  layer: 'baseline' | 'local' | 'env' | 'merged',
  path: 'config/config.json',
  field: 'rateLimitQps',
  code: 'invalid_type',
  message: '...'
}
```

不得包含原始值、整份 JSON、秘密环境变量或绝对用户目录信息。

## 字段来源计算

来源按父任务优先级逐层覆盖并记录：

```text
baseline → local → env → explicit CLI
```

`show` 的每个字段返回：

- `effectiveValue`：最终值。
- `source`：`baseline/local/env/cli`。
- `localOverride`：本地文件是否设置及其值。
- `overridden`：本地值是否被更高层覆盖。

只遍历公开文件 Schema 字段。秘密、安全和测试环境变量没有文件 Schema 入口，因此不会出现在 show 结果或 set 候选键中。

## 值解析规则

- 数字：完整字符串转换为有限数，再由字段 Schema 检查整数、正数等边界。
- 布尔：只接受 `true/false/1/0`，不使用 JavaScript 的宽松 truthy 规则。
- 枚举：按 Schema 枚举精确匹配。
- URL/字符串：先保留字符串，再由对应 Schema 校验；不执行代码或 JSON 表达式。
- 未知字段：`set` 拒绝；`unset` 仅在本地原始对象确实存在该键时允许删除，以修复未知字段错误。

本地 JSON 是对象但字段非法时可以通过修改或删除该字段恢复；JSON 语法损坏、根值为数组/null/标量或文件不可读时，不覆盖原文件。

## 项目内路径约束

- 写入目标固定为 `CONFIG_PATH`，CLI 不接受路径参数。
- 写入前以 `PROJECT_ROOT` 为信任边界，检查目标规范化路径仍位于 `config/`。
- 对已存在的 `config/` 和 `config.json` 检查 `lstat/realpath`；符号链接或目录联接解析到项目外时返回配置错误。
- 临时文件创建在同一个已验证目录，文件名包含 pid/随机后缀；不得借系统临时目录写后再跨卷移动。

## 原子写入与失败恢复

1. 读取并保留原始本地对象。
2. 在内存中创建候选副本并严格校验。
3. 确保经过边界检查的项目内 `config/` 存在。
4. 以独占方式创建同目录临时文件，写入两空格缩进、末尾换行的 JSON。
5. flush/close 临时文件后 rename 覆盖目标。
6. 失败时清理本次临时文件；原目标在 rename 前不变。

并发写入采用“最后一次完整原子写入生效”语义，不在本子任务新增跨进程锁。配置编辑是低频本地操作；若未来出现并发需求，再单独设计版本检查或锁。

## 命令结果契约

- `config.show`：`data` 包含 `path`、`fields` 和分层状态。
- `config.validate`：有效时 `ok: true`；无效时使用 `E_CONFIG_INVALID`、GENERAL 退出码，并在安全 detail 中列出 issues。
- `config.set`：返回 `key`、解析后的新值、旧本地值是否存在、当前有效来源以及是否被 env/CLI 覆盖。
- `config.unset`：返回 `key`、`removed`、回退后的有效来源；键不存在时 `ok: true, removed: false`。

`set/unset` 的成功语义是“请求的本地编辑已安全落盘”，不等同于“整体运行配置有效”。若 baseline/env/merged 层仍有问题，命令保持 `ok: true`，同时返回 `data.runtimeValid: false`、安全 issues 和 `meta.warnings: ['runtime_invalid_after_edit']`。普通业务命令仍按父任务要求立即失败。

配置命令不控制 daemon 生命周期。普通 CLI 每次启动重新装配配置；daemon 已在进程内持有快照，因此 daemon 使用的字段发生变化时，`set/unset` 返回 `restartRequired: true` 和 `daemon_restart_required` warning，不自动执行 stop/start，也不因 daemon 未运行而报错。

所有 JSON 输出保持单行 envelope；人类模式由现有输出设施渲染，不使用运行时 `console.log`。

## 兼容性与回滚

- 不改变父任务既定的加载优先级或默认值。
- 不修改 `config/config.example.json`，只修改 gitignored 的本地覆盖文件。
- 不持久化环境变量，也不提供秘密字段参数，避免命令历史泄密。
- 不自动重启 daemon，避免本地配置写入产生隐含进程中断；生效动作由用户显式控制。
- 回滚只需移除 config 注册、命令模块和写入 API；已有 `config.json` 仍是父任务可读取的普通稀疏覆盖。
