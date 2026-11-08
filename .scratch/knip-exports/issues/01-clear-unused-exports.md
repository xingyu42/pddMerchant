# 01: 清零 knip 报告的无用 export，并把 exports 纳入 lint

Status: ready-for-agent

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
- 有意保留的公开接缝（极少数）：在 `knip.json` 里逐项放行，并写明原因
- 每一批改动后跑 `npm run check`

## Acceptance criteria

- [ ] `npx knip --include exports,types,duplicates` 输出为空
- [ ] `package.json` 的 `lint` 加上 `exports,types,duplicates`
- [ ] `npm run check` 通过
- [ ] `knip.json` 里每一项放行都附有原因
