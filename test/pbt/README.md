# PBT (Property-Based Testing) 说明

## 框架选型

**结论**：`vitest` + 自研 `_harness.js`（mulberry32 PRNG + 生成器 + property runner）。

**Why**：
- `design.md §非目标`：不引入新的 npm 依赖。排除 `fast-check`。
- `mulberry32` 是一个 32-bit state 的快速确定性 PRNG，6 行可实现，足以覆盖枚举/属性样本的随机性需求；CI 可复现。
- 所有 property 用例在 vitest 的 `test()` block 内调用 `property()`，失败时抛普通 Error，与既有测试文件行为一致。

**不选**：
- `fast-check` — 可选 devDependency，但自研 harness 已够用。
- 纯 `Math.random` 循环 — 不可复现，CI flake 源。

## 运行方式

```bash
npm test                       # 跑全量（含 PBT），默认 seed=42 / runs=100
PBT_SEED=12345 npm test        # 指定 seed（复现失败用例）
PBT_RUNS=1000 npm test         # 加大样本量（CI nightly）
```

失败时 assertion 消息包含 `seed=<N>` 与失败 sample，便于 `PBT_SEED=<N>` 复现。

## 写新 PBT 用例

```js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { property, gen } from './_harness.js';

test('pbt: my_invariant', async () => {
  await property(
    'my_invariant',
    gen.record({
      x: gen.int(0, 100),
      y: gen.int(0, 100),
    }),
    ({ x, y }) => {
      // return false 或抛异常即判反例
      return x + y === y + x;
    },
  );
});
```

- 生成器组合：`gen.int / float / bool / oneOf / arrayOf / record / tuple / string`
- predicate 可以是 `sync | async`，返回 `!== false` 视为通过
- 所有 PBT 文件命名 `*.pbt.test.js`，vitest 自动发现

## 与既有 unit test 的边界

- **unit test**：具体 input/output 断言（golden case）
- **PBT**：不变式断言（跨越 sample space 的结构性质）

示例：
- `test/diagnose-scoring.unit.test.js` 覆盖固定 golden input → 断言具体 score/status
- `test/pbt/inventory.pbt.test.js` 断言"orders 随机 shuffle 后 stale_count 不变"
