# Coding Style Guide

> 此文件定义团队编码规范，所有 LLM 工具在修改代码时必须遵守。
> 提交到 Git，团队共享。

## General
- Prefer small, reviewable changes; avoid unrelated refactors.
- Keep functions short (<50 lines); avoid deep nesting (≤3 levels).
- Name things explicitly; no single-letter variables except loop counters.
- Handle errors explicitly; never swallow errors silently.

## Language-Specific

### JavaScript (Node.js, ESM)
- `"type": "module"`：统一使用 ESM (`import`/`export`)，禁止 `require`。
- 优先使用 `const`；仅在需要重赋值时用 `let`，禁用 `var`。
- 异步统一 `async/await`；避免混用 `.then()` 链。
- 错误抛出使用项目自定义 `PddCliError` 并携带 exit code 映射。
- 日志统一走 `src/infra/logger.js`（pino），禁止 `console.log` 落库。

## Git Commits
- Conventional Commits, imperative mood.
- Atomic commits: one logical change per commit.

## Testing
- Every feat/fix MUST include corresponding tests.
- Coverage must not decrease.
- Fix flow: write failing test FIRST, then fix code.
- 测试入口：`node --test test/**/*.test.js`。

## Security
- Never log secrets (tokens/keys/cookies/JWT).
- Validate inputs at trust boundaries.
- `~/.pdd-cli/auth-state.json` 属敏感文件，禁止复制到仓库或日志。
