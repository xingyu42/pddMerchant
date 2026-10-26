# Standards Spec Index

本层记录跨目录通用开发标准：JavaScript/ESM 写法、测试选择、依赖策略与最终验证。它补充各层 code-spec，不替代具体层的契约。

## 文件

| 文件                                 | 内容                                            | 使用场景                     |
| ------------------------------------ | ----------------------------------------------- | ---------------------------- |
| [coding-style.md](./coding-style.md) | Node.js ESM、函数复杂度、异步风格、日志禁忌     | 任意源码改动                 |
| [testing.md](./testing.md)           | Vitest、fixture adapter、e2e、契约守卫、验证范围选择 | 新增/修改测试或验证改动      |
| [dependencies.md](./dependencies.md) | 新依赖准入、Playwright 生态、禁用依赖           | 修改 `package.json` 或引入库 |

## Pre-Development Checklist

- [ ] 代码保持纯 JavaScript ESM；不要引入 TypeScript 或 build step。
- [ ] 使用 `async/await`，避免 `.then()` 链式流程。
- [ ] 找已有 helper/normalizer/config owner，避免复制契约。
- [ ] 根据改动选择 targeted Vitest；跨层/runner/infra 改动扩大到 `npm test`。
- [ ] 新依赖先评估体积、维护、替代方案、安全状态。

## Quality Check

- [ ] 函数尽量 < 50 行、嵌套 ≤ 3 层。
- [ ] 除 loop index 外避免单字母变量。
- [ ] 无运行时 `console.log`。
- [ ] 测试不依赖真实商家账号、真实浏览器网络或 `data/` secrets，除非是明确的人工 smoke。
