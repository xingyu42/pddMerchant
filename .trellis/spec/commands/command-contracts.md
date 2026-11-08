# Command Contracts

## 1. Scope / Trigger

适用于新增或修改 `bin/pdd.js`、`src/commands/**`、`src/commands/registry/**`、命令 flags、usage validation、写操作确认逻辑。

## 2. Signatures

**命令 handler（实际模式）** — `src/commands/orders/detail.js`：

```js
import { withCommand } from '../_runner.js';
import { getOrderDetailView } from '../../services/orders.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';

export const run = withCommand({
  name: 'orders.detail',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { sn } = ctx.config;
    if (!sn) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: 'pdd orders detail 需要 --sn <order_sn>',
        hint: '示例：pdd orders detail --sn 85',
        exitCode: ExitCodes.USAGE,
      });
    }
    // service 返回完整 v2 data：{ headline, order, mall_id }
    return getOrderDetailView(ctx.page, sn, ctx);
  },
});
```

**域注册器** — `src/commands/registry/orders.js`：

```js
import * as list from '../orders/list.js';
import * as detail from '../orders/detail.js';
import * as stats from '../orders/stats.js';

export function register(program, wireAction) {
  const orders = program.command('orders').description('📦 订单管理');
  wireAction(
    orders.command('list').description('订单列表')
      .option('--page <n>', '页码', (v) => Number(v), 1)
      .option('--size <n>', '每页数量', (v) => Number(v), 20),
    'orders.list',
    list.run
  );
  wireAction(
    orders.command('detail').description('订单详情')
      .requiredOption('--sn <sn>', '订单号'),
    'orders.detail',
    detail.run
  );
}
```

**Runner facade** — `src/commands/_runner.js`：

```js
export { executeSingle } from './runner/single-lifecycle.js';
export { withCommand } from './runner/batch-executor.js';
```

常见路径：

```text
bin/pdd.js                         CLI entry：signal/fatal、global options、wireAction
src/commands/registry/<domain>.js  域注册器：register(program, wireAction)
src/commands/<domain>/<action>.js  命令 handler：withCommand({...}) 薄封装
src/services/<domain>.js           业务逻辑（被 handler 调用）
```

## 3. Contracts

- `withCommand` 选项 `needsBrowser`（默认 `true`）：本地管理命令设为 `false`，同时 `needsAuth:false`，runner 跳过浏览器，输出仍走统一 finalizer 与 data 契约 v2。`needsAccount` 默认 false；仅显式 true 时在无浏览器分支解析本地 merchant 账号，缺账号为 `E_ACCOUNT_REQUIRED` / exit 2。`needsMall:'stored'` 仅显式启用，声明由 service 消费本地店铺键，无页面探测或切店；所有既有命令默认行为保持原样。
- Global flags include `--json`、`--no-color`、`--timeout <ms>`、`--mall <id>`、`--headed`、`--verbose`。
- Command handlers MUST call `withCommand()` indirectly via `wireAction` / runner facade。
- `pdd config show/set/unset/validate` is the maintenance exception: it MUST use `wireAction(..., { runtimeConfigPolicy: 'maintenance' })` so damaged config can still be diagnosed or safely repaired, and MUST NOT enter auth/browser/mall runner lifecycle。
- Required options MUST fail before service execution and map to `ExitCodes.USAGE`。
- Goods write commands (`status`、`price`、`stock`、`title`、`batch`) MUST require `--confirm` for real writes；without it return dry-run data。
- Price input is yuan: `goods update price --price-yuan <元>` (required, string kept as-is — no `Number` coercion in the registrar), `> 0`, at most 2 decimals, parsed exactly by `parseYuanToFen`; invalid → `E_USAGE` exit 2 with hint `单位为元，例如 29.9`. The removed cents option `--price` is rejected by commander (exit 2). Upstream still receives fen。
- `goods update batch` price changes use `field: "price_yuan"` with `value` in yuan (number or string); `field: "price"` → `E_USAGE` exit 2 whose hint shows the new format. All items are validated before the first write; writes run sequentially。
- Write echo (dry-run and confirmed) shape: `{ headline, goods_id(string), field, value, [sku_id], dry_run, [result: { success, failed_count }], mall_id }`. `field` equals the batch field name (`status|price_yuan|stock|title`); price `value` is yuan; status `value` is the Chinese action (`上架|下架`) while the upstream payload keeps `onsale|offline`. Batch: dry-run `{ headline, planned[], count, dry_run, mall_id }`, confirmed `{ headline, succeeded, failed, results[{ goods_id, field, ok, error_code?, message? }], dry_run, mall_id }`; partial exit 7 via `meta.exit_code`。
- Command handlers stay thin: call one service function that returns the full v2 `data` (or `{ data, warnings }`). Option values are parsed and validated in the registrar at commander parse time (`src/commands/option-parsers.js` helpers, `Option.choices`), so usage errors exit 2 before any browser starts; usage checks of CLI options inside services are legacy (`src/services/goods.js`), never a precedent. Projection, unit conversion, labels and headline live in `src/services/` + `src/services/views/`, never in commands。
- Every success `data` MUST include a factual Chinese `headline: string[]` (1–3 sentences). Headlines state counts, states and data availability only — no advice, scores, rankings or good/bad wording。
- Config `set/unset` MUST NOT require `--confirm`; they only edit the reversible project-local sparse override after strict Schema validation and atomic-write checks。
- `withCommand()` domain handlers MUST return plain data for the envelope `data` field; maintenance/raw lifecycle handlers (`account.*`、`config.*`、`init`、`login`) may build and emit exactly one standard envelope through `src/infra/output.js`, and MUST build its `data` with the same v2 views (`src/services/views/account.js|config.js|auth.js`) and set `meta.exit_code`。
- `goods segment`, `promo roi`, and `diagnose` return factual statistics and data-quality hints only. No operating advice, health scores, tiers, or promo quality classifications. `action plan` and `--break-even` are removed and must fail as usage errors.

## 4. Validation & Error Matrix

### Goods Cost / Profit

- `goods cost set/list/remove/import` 使用 `needsBrowser:false,needsAuth:false,needsAccount:true,needsMall:'stored',allowAllAccounts:false`；只读本地账号与成本，跳过 auth-state 解密/在线认证/重登/daemon。有效 mall 参数（含运行配置默认）优先，否则账号 identity。
- 成本写命令 `set/remove/import` 缺 confirm 预演，xhr_count 为 0，所有输入先验证；confirm 仅写 SQLite。金额 flags 保持字符串，parseYuanToFen 接受 >=0、最多两位小数；原 price >0 规则不变。goods_id 保留字符串精度。
- import 的 `<file>` 从 config.args[0] 读取，格式为 UTF-8 JSON 数组，整批拒绝/整批事务；E_COST_IMPORT_INVALID / exit 2 的 detail.row_errors 为 1-based 记录序号，语法损坏 row:null，省去物理行号。
- `goods profit` 保留普通 needsAuth + mall switch 生命周期；days 默认 30，仅整数 1–90，非法为 E_USAGE / exit 2。goods-id 只筛列表，summary 始终全店；列表/summary 及 quality 的固定键由 views/goods-profit.js 拥有。
- 验证：`test/commands/goods-cost-runtime.test.js`、`goods-cost-contract.test.js`，`test/e2e/goods-cost.e2e.test.js`、`goods-profit.e2e.test.js`，以及五个命令的 data-contract-v2 用例。共享 runner 改动运行 npm test。

### Goods Receipt

- `goods receipt` 为普通 needsAuth + mall switch 只读命令，允许 `--all-accounts`。`--size` 用 `integerArg(1, GOODS_PRICE_MAX_PAGE_SIZE)`、`--caliber` 用 commander `Option.choices(Object.keys(RECEIPT_CALIBERS))`、`--goods-id` 用 `goodsIdListArg`（可重复 / 逗号分隔、去重、正整数），均在解析阶段拒绝（commander.invalidArgument → E_USAGE / exit 2，`xhr_count` 0，不启动浏览器）。可选值与上限只从 service 导出的 `RECEIPT_CALIBERS` / `GOODS_PRICE_MAX_PAGE_SIZE` 派生。
- 验证：`test/commands/numeric-options.test.js`（解析器）、`test/e2e/goods-receipt.e2e.test.js`、`test/adapter/goods-price-contract.test.js`、`test/services/goods-receipt.test.js` 及两个口径的 data-contract-v2 用例。

| 输入条件                                                   | 结果                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| missing required flag such as `--sn`                       | usage error，exit code 2                              |
| invalid enum such as goods status outside `onsale/offline` | usage/business error by boundary，no platform write   |
| write command without `--confirm`                          | dry-run response，exit code 0 unless validation fails |
| malformed JSON for `--changes`                             | usage error，message names the bad flag               |
| removed `--price` option / `--price-yuan` invalid (0, 负数, >2 位小数) | usage error，exit code 2，no platform write          |
| batch item `field: "price"`                                | usage error，exit code 2，hint shows `price_yuan` format |
| service throws `PddCliError`                               | runner finalizes mapped envelope                      |
| runtime config layer invalid                               | ordinary command fails `E_CONFIG_INVALID`; config maintenance command remains reachable |
| config local JSON damaged                                  | `set/unset` refuse overwrite; `validate` reports safe layer issue |

## 5. Good/Base/Bad Cases

- Good：`orders detail --sn <sn>` validates `sn` in command layer, then calls service。
- Base：`goods list --page --size --status` normalizes option types before service。
- Bad：command handler catches errors and prints human messages itself；runner loses exit code mapping。

## 6. Tests Required

- Command registration/flags: smoke or e2e invoking `node bin/pdd.js ... --json`。
- Usage validation: assert exit code 2 and envelope error shape。
- Write dry-run/confirm: assert no submit endpoint in dry-run and correct write path with confirm fixture。
- Price unit: assert the upstream payload (mock dispatcher call boundary) receives fen, e.g. `--price-yuan 29.9` → `price: 2990`。
- Every registered command MUST be covered by `test/contract/data-contract-v2.test.js` (see `standards/testing.md`)。
- JSON purity: stdout parses as one JSON object; diagnostics stay out of stdout。

## 7. Wrong vs Correct

### Wrong

```js
// ❌ 直接 action + console.log，绕过 runner/envelope
program.command('price').action(async (options) => {
  await updatePrice(options);
  console.log('ok');
});
```

### Correct

```js
// ✅ withCommand 封装，返回纯数据由 runner 包装 envelope
export const run = withCommand({
  name: 'goods.update.price',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { goodsId, priceYuan, confirm, skuId } = ctx.config;
    const data = await executeGoodsWrite(ctx, { field: 'price_yuan', goodsId, value: priceYuan, skuId, confirm });
    return { data, meta: { xhr_count: data.dry_run ? 0 : 1 } };
  },
});
```
