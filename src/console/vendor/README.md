# Vendored frontend modules

控制台前端不经构建、不走 npm 运行时依赖，以下文件原样取自 npm 发布包（`npm pack`），仅 `hooks.mjs` 改了一处导入路径。

| 文件 | 来源 | 修改 | sha256 |
| --- | --- | --- | --- |
| `preact.mjs` | `preact@11.1.0` `dist/preact.mjs` | 无 | `25288b8d9d60f7885df6c487a813a495e98c9addbeaf7c0e8f59683c71d426b5` |
| `hooks.mjs` | `preact@11.1.0` `hooks/dist/hooks.mjs`（原 sha256 `24231102dc3e509c9c657bca591524e348eb8a5272c9d40538faef9beeeb654c`） | `from"preact"` → `from"./preact.mjs"` | `e3c0fa7f4f35d345440663cd3835f7f46ac920110d9d44da2c8869dd11e3de2a` |
| `htm.mjs` | `htm@3.1.1` `dist/htm.mjs` | 无 | `ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4` |
| `panzoom.mjs` | `@panzoom/panzoom@4.6.2` `dist/panzoom.es.js` | 无 | `3fb2efbf08b085fc0e7b0ba7f2900142f76a762d62b6e8e37ccb7af0f5d2fe78` |

许可证：`LICENSE-preact`、`LICENSE-htm`、`LICENSE-panzoom`（均为 MIT）。

改导入路径的原因：控制台 CSP 为 `script-src 'self'`，内联 import map 会被拦截，改为相对路径后无需 import map。

升级方式：`npm pack preact@<v> htm@<v> @panzoom/panzoom@<v>` 解包到临时目录，替换上述文件，重做 `hooks.mjs` 的路径修改，更新本表的版本与 sha256。
