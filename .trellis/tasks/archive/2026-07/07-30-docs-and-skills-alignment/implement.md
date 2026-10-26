# Implementation Plan

## 1. Freeze Evidence Matrix

- [x] 汇总命令、配置、路径、日志、测试和技能说明的代码证据。
- [x] 为每个事实列出全部文档落点与反向搜索词。
- [x] 标记确认错误、缺失说明、历史材料和无需修改项。

## 2. Update User-Facing Documentation

- [x] 修正 README 的命令、账号、日志和配置说明。
- [x] 增加简洁文档索引。
- [x] 修正架构总览的命令域与当前结构，隔离历史内容。
- [x] 修正 `.env.example` 的变量用途与安全说明。

## 3. Update Test And Developer Documentation

- [x] 重写 PBT 当前实现说明和复现方式。
- [x] 统一 Patchright 安装与测试/lint/CI 口径。
- [x] 最小修正 `AGENTS.md`、`CLAUDE.md` 中的项目事实，保留用户自定义规则。

## 4. Update Skills

- [x] 修正 `skills/pdd-cli/SKILL.md` 的全局选项、子命令参数和路径说明。
- [x] 修正 `pdd-local-development` 的安装、路径和日志说明。
- [x] 修正 `pdd-adapter-auth-integration` 的账号路径与安全变量说明。
- [x] 抽查其余 pdd skills，确认没有复制的旧事实。
- [x] 同步 `.trellis/spec/standards/testing.md` 与 `dependencies.md` 中的项目事实，不修改 Trellis 工作流。

## 5. Verify Details And Scope

- [x] 用 `pdd --help` 与关键子命令 `--help` 核对最终命令说明。
- [x] 反向搜索失效命令、旧 auth 路径、`playwright install`、可配置日志目的地和错误 PBT 表述。
- [x] 运行最相关的快速测试；共享契约受影响时扩大到 `npm test`。
- [x] 运行 `git diff --check` 并检查最终 diff。
- [x] 确认未回退 `.gitignore` 或用户无关 WIP。

## Review Gates

- [x] Gate A: 用户确认最终 PRD、design 和 implement 后，才可 `task.py start`。
- [x] Gate B: 每类事实至少有一个代码来源和一次反向搜索。
- [x] Gate C: 所有验收标准均有对应证据，不能以“主文档已改”代替 skills/与细节核验。

## Verification Results

- `node bin/pdd.js --help`、`goods segment --help`、`promo roi --help`：与文档选项一致。
- 相关配置/路径/日志/help 测试：6 files，87 tests passed。
- 项目 harness 与 fast-check 抽样：2 files，15 tests passed。
- endpoint 规范测试：1 file，4 tests passed。
- 全量 `npx vitest run`（沙箱外，Windows 进程探测权限正常）：143 files passed，1 skipped；1188 tests passed，1 skipped。
- 沙箱内全量测试唯一失败为 `tasklist` 对当前 PID 返回 `Access denied`；同一 `PBT_SEED=42` 在沙箱外单独运行 `auth-lock` 为 6/6 passed。
- `npm run lint`：仅输出 `no-lint`，按占位命令记录，不计作 lint 覆盖。
- Markdown 本地链接检查、错误表述反向搜索、`git diff --check`：通过。
- 用户原有 `.gitignore` 修改保留；本任务未回退或改写该文件。
