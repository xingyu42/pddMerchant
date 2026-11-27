import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { createCliSandbox, runCli, spawnNode } from '../helpers/isolated-cli.js';
import { DEFAULT_ACCOUNT, seedDb } from '../helpers/seed-db.js';
import { createFactFixtures } from '../fixtures/test-data.js';

const cliPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));
const preloadUrl = new URL('../helpers/offline-preload.js', import.meta.url).href;

describe('orders stats provincial regions block', () => {
  it('outputs descending provincial regions under group-order caliber without PII or shop-level bleed', () => {
    const { status, stdout, envelope } = runCli(['orders', 'stats', '--with-regions'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    assert.equal(envelope.command, 'orders.stats');
    const view = envelope.data;
    assert.equal(view.headline.length, 3);
    assert.equal(view.remote.pending_ship_count, 1);
    assert.equal(view.regions.caliber, '数据中心-地域分布（成团订单）');
    assert.deepEqual(view.regions.window, { start_date: '2026-11-15', end_date: '2026-11-21', days: 7 });
    assert.equal(view.regions.delayed, false);
    assert.equal(view.regions.province_count, 2);
    assert.deepEqual(view.regions.items.map((item) => item.province), ['广东', '浙江']);
    assert.equal(view.regions.items[0].avg_buyer_amount_yuan, 22.17);
    assert.equal(view.regions.items[0].avg_order_amount_yuan, 18.65);
    assert.match(view.headline[2], /广东成团额最高/);
    for (const forbidden of ['provinceId', 'cfmOrdrAmtCent', 'SYN-RECEIVER', 'receive_name']) {
      assert.equal(stdout.includes(forbidden), false, forbidden);
    }

    const shopRes = runCli(['diagnose', 'shop'], { fixtures: createFactFixtures() });
    assert.equal(shopRes.status, 0);
    assert.equal(Object.hasOwn(shopRes.envelope.data, 'regions'), false);
    assert.equal(Object.hasOwn(shopRes.envelope.data.dimensions.orders, 'regions'), false);
  });

  it('renders a provincial table without raw JSON in non-json mode for orders stats --with-regions', async () => {
    const sandbox = createCliSandbox(createFactFixtures());
    try {
      seedDb(sandbox.env.PDD_DB_PATH, {
        accounts: [DEFAULT_ACCOUNT],
        authStates: [{ slug: DEFAULT_ACCOUNT.slug, state: { cookies: [], origins: [] } }],
      });
      const result = await spawnNode(['--import', preloadUrl, cliPath, 'orders', 'stats', '--with-regions'], {
        env: sandbox.env,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /省级成团分布（数据中心-地域分布（成团订单））/);
      for (const header of ['省份', '成团额(元)', '成团单数', '买家数', '客单价(元)', '笔单价(元)']) {
        assert.ok(result.stdout.includes(header), `missing header ${header}`);
      }
      for (const value of ['广东', '820.4', '44', '37', '22.17', '18.65', '浙江', '25.4']) {
        assert.ok(result.stdout.includes(value), `missing value ${value}`);
      }
      assert.equal(result.stdout.includes('{"'), false, `unexpected raw JSON in human output:\n${result.stdout}`);
    } finally {
      sandbox.dispose();
    }
  });

  it('degrades PUA and network failures on regions while keeping order stats intact', () => {
    const puaFixtures = {
      ...createFactFixtures(),
      'endpoints/orders.regionDistribution.json': {
        success: true,
        errorCode: 1000000,
        result: {
          delayData: 0,
          geographyDistributionVOList: [{
            provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: '\uE001',
            cfmOrdrCnt: 1, cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4,
          }],
        },
      },
    };
    const puaResult = runCli(['orders', 'stats', '--with-regions'], { fixtures: puaFixtures });
    assert.equal(puaResult.status, 0);
    assert.equal(puaResult.envelope.data.regions, null);
    assert.equal(puaResult.envelope.data.remote.pending_ship_count, 1);
    assert.ok(puaResult.envelope.data.hints.some((hint) => hint.includes('字体混淆')));

    const netFixtures = {
      ...createFactFixtures(),
      'endpoints/orders.regionDistribution.json': {
        __throws: true, __error: { code: 'E_NETWORK', message: 'region down', exitCode: 5 },
      },
    };
    const netResult = runCli(['orders', 'stats', '--with-regions'], { fixtures: netFixtures });
    assert.equal(netResult.status, 0);
    assert.equal(netResult.envelope.data.regions, null);
    assert.ok(netResult.envelope.data.hints.some((hint) => hint.includes('拉取失败')));
  });
});
