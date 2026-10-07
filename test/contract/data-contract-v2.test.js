import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import { assertDataContractV2 } from '../helpers/data-contract.js';
import { runCli } from '../helpers/isolated-cli.js';
import {
  createAccountRegistry, createFactFixtures, createPublishFixtures, createUpstreamGoods,
} from '../fixtures/test-data.js';
import { ACCOUNT_VIEW_FIELDS } from '../../src/services/views/account.js';
import { CONFIG_FIELD_VIEW_FIELDS } from '../../src/services/views/config.js';
import { SHOP_VIEW_FIELDS } from '../../src/services/views/shops.js';
import { ORDER_DETAIL_VIEW_FIELDS, ORDER_VIEW_FIELDS } from '../../src/services/views/order.js';
import {
  COST_TEMPLATE_VIEW_FIELDS, GOODS_PROMOTION_VIEW_FIELDS, GOODS_VIEW_FIELDS,
} from '../../src/services/views/goods.js';
import { PUBLISH_VIEW_FIELDS } from '../../src/services/views/goods-publish.js';
import { GOODS_SEGMENT_ITEM_FIELDS } from '../../src/services/goods-segmentation.js';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import { PROMO_ROI_ITEM_FIELDS, PROMO_TOTALS_FIELDS } from '../../src/services/views/promo.js';
import { STALE_SAMPLE_FIELDS } from '../../src/services/views/diagnose.js';

// 两件商品：101 有销量，102 有库存但无销量（零销量样本非空，供 stale_sample 白名单校验）
function staleGoodsFixtures() {
  return {
    ...createFactFixtures(),
    'endpoints/goods.list.json': GOODS_LIST.normalize({ success: true, result: { total: 2, goods_list: [
      createUpstreamGoods(),
      createUpstreamGoods({ goods_id: 102, goods_name: 'Cup', quantity: 5 }),
    ] } }),
  };
}

const PROMO_ENTITIES = { 'items[]': PROMO_ROI_ITEM_FIELDS, totals: PROMO_TOTALS_FIELDS };

const GOODS_ENTITIES = { 'items[]': GOODS_VIEW_FIELDS, 'items[].promotion': GOODS_PROMOTION_VIEW_FIELDS };

function lowStockFixtures() {
  return {
    'endpoints/goods.list.json': GOODS_LIST.normalize({ success: true, result: { total: 3, goods_list: [
      createUpstreamGoods({ quantity: 0 }),
      createUpstreamGoods({ goods_id: 102, quantity: 5 }),
      createUpstreamGoods({ goods_id: 103, quantity: 20 }),
    ] } }),
  };
}

// 输出契约 v2 守卫（design.md §6）：全部注册命令的成功路径 data 必须满足 v2 规则。
// 命令清单从 src/commands/registry/ 动态收集 —— 新增命令未覆盖即失败。

const registryDir = new URL('../../src/commands/registry/', import.meta.url);
const projectRoot = new URL('../../', import.meta.url);

// 以桩 wireAction 运行全部域注册器，收集 wireAction 的命令名（即 envelope command）
async function discoverRegisteredCommands() {
  const names = [];
  const program = new Command();
  const wireAction = (_cmd, commandName) => { names.push(commandName); };
  const files = readdirSync(registryDir).filter((file) => file.endsWith('.js')).sort();
  for (const file of files) {
    const registrar = await import(new URL(file, registryDir).href);
    registrar.register(program, wireAction);
  }
  return names;
}

// v2 用例：{ command, envelopeCommand?, args, fixtures?, registry?, authState?, freeKeyPaths?, entityFields? }；
// 同一命令可有多个用例（如 dry-run）。`login --consumer` 的 envelope command 为 'login.consumer'，
// 以 command: 'login' 的附加用例覆盖。
const VALID_AUTH_STATE = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };

const V2_CASES = [
  { command: 'shops.list', args: ['shops', 'list'], entityFields: { 'items[]': SHOP_VIEW_FIELDS } },
  { command: 'shops.current', args: ['shops', 'current'] },
  { command: 'account.add', args: ['account', 'add'] },
  {
    command: 'account.list',
    args: ['account', 'list'],
    registry: createAccountRegistry(),
    entityFields: { 'items[]': ACCOUNT_VIEW_FIELDS },
  },
  { command: 'account.remove', args: ['account', 'remove', '--slug', 'shop-b'], registry: createAccountRegistry() },
  { command: 'account.default', args: ['account', 'default', '--slug', 'shop-b'], registry: createAccountRegistry() },
  {
    command: 'config.show',
    args: ['config', 'show'],
    freeKeyPaths: ['fields'],
    entityFields: { 'fields.*': CONFIG_FIELD_VIEW_FIELDS },
  },
  { command: 'config.validate', args: ['config', 'validate'] },
  { command: 'init', args: ['init', '--qr'] },
  { command: 'login', args: ['login', '--qr'] },
  { command: 'login', envelopeCommand: 'login.consumer', args: ['login', '--consumer', '--qr'] },
  { command: 'doctor', args: ['doctor'], authState: VALID_AUTH_STATE },
  {
    // 批量 envelope：accounts 以账号 slug 为键，各账号 data 为命令自身的 v2 data
    command: 'orders.stats',
    args: ['orders', 'stats', '--all-accounts'],
    fixtures: createFactFixtures(),
    registry: createAccountRegistry(),
    freeKeyPaths: ['accounts', 'accounts.*.data.local.status_distribution'],
  },
  {
    command: 'orders.list',
    args: ['orders', 'list'],
    fixtures: createFactFixtures(),
    entityFields: { 'items[]': ORDER_VIEW_FIELDS },
  },
  {
    command: 'orders.list',
    args: ['orders', 'list', '--status', 'pending_ship'],
    fixtures: createFactFixtures(),
    entityFields: { 'items[]': ORDER_VIEW_FIELDS },
  },
  {
    command: 'orders.detail',
    args: ['orders', 'detail', '--sn', 'SYN-DETAIL'],
    fixtures: createFactFixtures(),
    entityFields: { order: ORDER_DETAIL_VIEW_FIELDS },
  },
  {
    command: 'orders.stats',
    args: ['orders', 'stats'],
    fixtures: createFactFixtures(),
    freeKeyPaths: ['local.status_distribution'],
  },
  { command: 'goods.list', args: ['goods', 'list'], fixtures: createFactFixtures(), entityFields: GOODS_ENTITIES },
  { command: 'goods.stock', args: ['goods', 'stock'], fixtures: lowStockFixtures(), entityFields: GOODS_ENTITIES },
  {
    command: 'goods.segment',
    args: ['goods', 'segment', '--days', '7'],
    fixtures: createFactFixtures(),
    entityFields: { 'items[]': GOODS_SEGMENT_ITEM_FIELDS },
  },
  {
    command: 'goods.templates',
    args: ['goods', 'templates'],
    fixtures: createFactFixtures(),
    entityFields: { 'items[]': COST_TEMPLATE_VIEW_FIELDS },
  },
  {
    command: 'goods.publish',
    args: ['goods', 'publish', '--url', '123456'],
    fixtures: { ...createFactFixtures(), ...createPublishFixtures() },
    entityFields: { '': PUBLISH_VIEW_FIELDS },
  },
  {
    command: 'goods.publish',
    args: ['goods', 'publish', '--url', '123456', '--confirm'],
    fixtures: { ...createFactFixtures(), ...createPublishFixtures() },
    entityFields: { '': PUBLISH_VIEW_FIELDS },
  },
  { command: 'goods.update.status', args: ['goods', 'update', 'status', '--goods-id', '101', '--status', 'offline'] },
  { command: 'goods.update.price', args: ['goods', 'update', 'price', '--goods-id', '101', '--price-yuan', '29.9'] },
  {
    command: 'goods.update.price',
    args: ['goods', 'update', 'price', '--goods-id', '101', '--price-yuan', '29.9', '--confirm'],
    fixtures: { 'endpoints/goods.update.price.json': { success: true, fail_goods_num: 0 } },
  },
  { command: 'goods.update.stock', args: ['goods', 'update', 'stock', '--goods-id', '101', '--quantity', '5'] },
  { command: 'goods.update.title', args: ['goods', 'update', 'title', '--goods-id', '101', '--title', 'Synthetic'] },
  { command: 'promo.roi', args: ['promo', 'roi'], fixtures: createFactFixtures(), entityFields: PROMO_ENTITIES },
  {
    command: 'promo.roi',
    args: ['promo', 'roi', '--by', 'channel'],
    fixtures: createFactFixtures(),
    entityFields: PROMO_ENTITIES,
  },
  { command: 'diagnose.orders', args: ['diagnose', 'orders'], fixtures: createFactFixtures() },
  {
    command: 'diagnose.inventory',
    args: ['diagnose', 'inventory'],
    fixtures: staleGoodsFixtures(),
    entityFields: { 'detail.stale_sample[]': STALE_SAMPLE_FIELDS },
  },
  { command: 'diagnose.promo', args: ['diagnose', 'promo'], fixtures: createFactFixtures() },
  {
    command: 'diagnose.funnel',
    args: ['diagnose', 'funnel'],
    fixtures: createFactFixtures(),
    freeKeyPaths: ['detail.status_distribution'],
  },
  {
    command: 'diagnose.shop',
    args: ['diagnose', 'shop'],
    fixtures: staleGoodsFixtures(),
    freeKeyPaths: ['dimensions.funnel.detail.status_distribution'],
    entityFields: { 'dimensions.inventory.detail.stale_sample[]': STALE_SAMPLE_FIELDS },
  },
  {
    command: 'diagnose.shop',
    args: ['diagnose', 'shop', '--compare', '--days', '7'],
    fixtures: createFactFixtures(),
    freeKeyPaths: ['dimensions.funnel.detail.status_distribution'],
  },
  {
    command: 'goods.update.batch',
    args: ['goods', 'update', 'batch', '--changes', JSON.stringify([{ goods_id: 101, field: 'price_yuan', value: 29.9 }])],
  },
  {
    command: 'goods.update.batch',
    args: [
      'goods', 'update', 'batch', '--confirm',
      '--changes', JSON.stringify([{ goods_id: 101, field: 'price_yuan', value: 29.9 }]),
    ],
    fixtures: { 'endpoints/goods.update.price.json': { success: true, fail_goods_num: 0 } },
  },
];

// 无法在 fixture 子进程中安全运行的命令：命令 → 进程内覆盖其 v2 data 的测试文件（文件须存在且提及该命令）。
// config set / unset 会写入仓库 config/config.json，故以临时项目根目录在进程内校验。
const UNIT_COVERED = {
  'config.set': 'test/contract/config-edit-contract.test.js',
  'config.unset': 'test/contract/config-edit-contract.test.js',
};

// 待迁移清单：已清空，新增命令须加入 V2_CASES 或 UNIT_COVERED。
const PENDING_COMMANDS = new Set([]);

function coveredCommands() {
  return new Set([...V2_CASES.map((testCase) => testCase.command), ...Object.keys(UNIT_COVERED)]);
}

describe('output contract v2: registered command coverage', () => {
  it('every registered command is covered by a v2 case or listed as pending', async () => {
    const registered = await discoverRegisteredCommands();
    assert.ok(registered.length > 0, 'command discovery must not be vacuous');
    assert.equal(new Set(registered).size, registered.length, 'command names must be unique');
    const covered = coveredCommands();
    const missing = registered.filter((name) => !covered.has(name) && !PENDING_COMMANDS.has(name));
    assert.deepEqual(missing, [], 'commands without a v2 contract case');
  });

  it('pending list only names registered, uncovered commands', async () => {
    const registered = new Set(await discoverRegisteredCommands());
    const unknown = [...PENDING_COMMANDS].filter((name) => !registered.has(name));
    assert.deepEqual(unknown, [], 'PENDING_COMMANDS contains unknown commands');
    const both = [...coveredCommands()].filter((name) => PENDING_COMMANDS.has(name));
    assert.deepEqual(both, [], 'covered commands must be removed from PENDING_COMMANDS');
  });

  it('keeps the pending list empty', () => {
    assert.deepEqual([...PENDING_COMMANDS], []);
  });

  it('points every unit-covered command at an existing test that mentions it', async () => {
    const registered = new Set(await discoverRegisteredCommands());
    for (const [name, file] of Object.entries(UNIT_COVERED)) {
      assert.ok(registered.has(name), `${name} is not a registered command`);
      const path = new URL(file, projectRoot);
      assert.ok(existsSync(path), `${file} must exist`);
      assert.ok(readFileSync(path, 'utf8').includes(name), `${file} must mention ${name}`);
    }
  });

  it('every v2 case targets a registered command', async () => {
    const registered = new Set(await discoverRegisteredCommands());
    const unknown = V2_CASES.map((testCase) => testCase.command).filter((name) => !registered.has(name));
    assert.deepEqual(unknown, []);
  });
});

describe.skipIf(V2_CASES.length === 0)('output contract v2: command data', () => {
  for (const testCase of V2_CASES) {
    it(`${testCase.command} ${testCase.args.join(' ')}`, () => {
      const { envelope } = runCli(testCase.args, {
        fixtures: testCase.fixtures, registry: testCase.registry, authState: testCase.authState,
      });
      assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
      // 用例必须真正运行其声明的命令，否则覆盖清单可被其他命令的参数冒充
      assert.equal(envelope.command, testCase.envelopeCommand ?? testCase.command);
      assertDataContractV2(envelope.data, {
        freeKeyPaths: testCase.freeKeyPaths,
        entityFields: testCase.entityFields,
      });
    });
  }
});
