# 01: 清零 knip 报告的无用 export，并把 exports 纳入 lint

Status: resolved

## What to build

`npm run lint` 目前只运行 `knip --include files,dependencies,unlisted,binaries`。要把 exports 也纳入检查，先得把现有的无用 export 清零。

基线（2026-11-08，`npx knip --include exports,types,duplicates`）：

- 155 个无用 export，0 个无用 type，30 处重复 export
- 按目录分布：`src/commands` 69、`src/adapter` 67、`src/services` 29、`src/infra` 19、`src/daemon` 1
- 最集中的文件：`src/adapter/goods-publish/form-filler.js`（14）、`src/adapter/mall-reader.js`（8）、`src/adapter/run-endpoint.js`（5）、`src/infra/config.js`（5）、`src/commands/daemon.js`（5）
- `src/commands` 下大部分是命令模块的 `default` export，与同名的具名 export 重复（registry 只用具名 export）

`knip.json` 已把 `test/**/*.test.js` 列为入口，所以报告里的 export 连测试也没有用到。

## 处理规则

- 文件内部还在用、只是多余地导出了：去掉 `export`
- 完全没有用到：删除
- 重复 export：保留 registry 实际导入的那一种
- 有意保留的公开接缝（极少数）：逐项放行，每项用 `//` 注释写明原因；JSON 不支持注释，第一项放行时把 `knip.json` 改名为 `knip.jsonc`（knip 两者都读）
- 每一批改动后跑 `npm run check`

## Acceptance criteria

- [x] `npx knip --include exports,types,duplicates` 输出为空
- [x] `package.json` 的 `lint` 加上 `exports,types,duplicates`
- [x] `npm run check` 通过
- [x] 若有放行：配置已改为 `knip.jsonc`，每一项放行都附有 `//` 原因注释（本次 0 项放行，配置仍为 `knip.json`）

## Comments

- 2026-11-08：已在集成分支 `feat/knip-exports` 完成。清理见 729f26c、da41602、6352107、4632d44：删除 49 项（30 个重复 `default` export、19 个死代码或无人用的转导出），去掉 `export` 108 项，`registry/daemon.js` 由 `daemon[name]` 改为静态引用，`metric-tables` 守卫改为扫描 `const` 声明。code review 修复见 64319a6。worktree 中 knip 需要本地 `node_modules` 的说明见 924464f。
