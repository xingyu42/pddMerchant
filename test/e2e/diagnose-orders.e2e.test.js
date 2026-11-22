import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { runCli } from '../helpers/isolated-cli.js';
import { createFactFixtures } from '../fixtures/test-data.js';

describe('diagnose orders provincial regions block', () => {
  it('outputs descending provincial regions under group-order caliber without PII or shop-level bleed', () => {
    const { status, stdout, envelope } = runCli(['diagnose', 'orders'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    assert.equal(envelope.command, 'diagnose.orders');
    const view = envelope.data;
    assert.equal(view.status, '数据完整');
    assert.equal(view.detail.pending_ship_count, 1);
    assert.equal(view.regions.caliber, '数据中心-地域分布（成团订单）');
    assert.deepEqual(view.regions.window, { start_date: '2026-11-15', end_date: '2026-11-21', days: 7 });
    assert.equal(view.regions.delayed, false);
    assert.equal(view.regions.province_count, 2);
    assert.deepEqual(view.regions.items.map((item) => item.province), ['广东', '浙江']);
    assert.equal(view.regions.items[0].avg_buyer_amount_yuan, 22.17);
    assert.equal(view.regions.items[0].avg_order_amount_yuan, 18.65);
    assert.match(view.headline.at(-1), /广东成团额最高/);
    for (const forbidden of ['provinceId', 'cfmOrdrAmtCent', 'SYN-RECEIVER', 'receive_name']) {
      assert.equal(stdout.includes(forbidden), false, forbidden);
    }

    const shopRes = runCli(['diagnose', 'shop'], { fixtures: createFactFixtures() });
    assert.equal(shopRes.status, 0);
    assert.equal(Object.hasOwn(shopRes.envelope.data, 'regions'), false);
    assert.equal(Object.hasOwn(shopRes.envelope.data.dimensions.orders, 'regions'), false);
  });

  it('degrades PUA and network failures on regions while keeping order summary intact', () => {
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
    const puaResult = runCli(['diagnose', 'orders'], { fixtures: puaFixtures });
    assert.equal(puaResult.status, 0);
    assert.equal(puaResult.envelope.data.regions, null);
    assert.equal(puaResult.envelope.data.status, '数据完整');
    assert.ok(puaResult.envelope.data.hints.some((hint) => hint.includes('字体混淆')));

    const netFixtures = {
      ...createFactFixtures(),
      'endpoints/orders.regionDistribution.json': {
        __throws: true, __error: { code: 'E_NETWORK', message: 'region down', exitCode: 5 },
      },
    };
    const netResult = runCli(['diagnose', 'orders'], { fixtures: netFixtures });
    assert.equal(netResult.status, 0);
    assert.equal(netResult.envelope.data.regions, null);
    assert.ok(netResult.envelope.data.hints.some((hint) => hint.includes('拉取失败')));
  });
});
