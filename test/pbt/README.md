# PBT（Property-Based Testing）说明

## 当前实现

PBT 用例由 Vitest 自动发现，目录内同时存在两种实现：

- 项目 `_harness.js`：零依赖的 mulberry32 PRNG、生成器和 `property()` runner，适合简单、需要统一环境变量复现的属性测试。
- `fast-check`：项目的 devDependency，适合 shrinking、组合生成器或已使用 fast-check 的现有测试。

选择以现有测试和问题复杂度为准，不要把其中一种描述成项目唯一 PBT 框架，也不要仅为统一形式批量迁移现有用例。

## 运行与复现

```bash
npm test                                      # 全量测试，包含全部 PBT
npx vitest run test/pbt/<file>.pbt.test.js    # 单个 PBT 文件
PBT_SEED=12345 npm test                       # 指定项目 harness 的 seed
PBT_RUNS=1000 npm test                        # 指定项目 harness 的样本量
```

`_harness.js` 默认 `seed=42`、`runs=100`，失败信息包含 seed 和 sample。`PBT_SEED` / `PBT_RUNS` 只控制项目 harness；fast-check 用例通过各自 `fc.assert(..., { seed, numRuns })` 配置和失败信息复现，不能假设它们读取这两个环境变量。

## 使用 `_harness.js`

```js
import { test } from 'vitest';
import { property, gen } from './_harness.js';

test('pbt: addition is commutative', async () => {
  await property(
    'addition_is_commutative',
    gen.record({ x: gen.int(0, 100), y: gen.int(0, 100) }),
    ({ x, y }) => x + y === y + x,
  );
});
```

生成器包括 `gen.int / float / bool / oneOf / arrayOf / record / tuple / string`。predicate 可以是 sync 或 async；返回 `false` 或抛出异常即判为反例。

## 使用 fast-check

```js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';

test('pbt: addition is commutative', () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (x, y) => {
      assert.equal(x + y, y + x);
    }),
    { numRuns: 100 },
  );
});
```

保留 fast-check 失败时给出的 seed/path，使用其 replay 参数复现；不要改用 `PBT_SEED` 假装复现了 fast-check 用例。

## 与 unit test 的边界

- unit test：验证具体输入输出、边界值和回归案例。
- PBT：验证跨样本空间成立的不变量。
- 所有 PBT 文件命名为 `*.pbt.test.js`，仍由 `test/**/*.test.js` 规则发现。

新增测试前先查看相邻文件使用哪套工具；只有 shrinking 或复杂生成确有价值时，才优先使用 fast-check。
