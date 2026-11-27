import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { PddCliError } from '../../src/infra/errors.js';
import { getOrderStatsView } from '../../src/services/orders.js';
import {
  toOrderRegionsView, ORDER_REGIONS_FIELDS, ORDER_REGION_ITEM_FIELDS,
} from '../../src/services/views/order.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

describe('orders stats regions view', () => {
  it('projects descending provincial regions under group-order caliber without PII', () => {
    const window = { start_date: '2026-11-15', end_date: '2026-11-21', days: 7 };
    const view = toOrderRegionsView({
      delayData: 1,
      items: [
        { provinceName: '浙江', provinceId: 31, statDate: '2026-11-21', cfmOrdrAmt: 25.4, cfmOrdrCnt: 1,
          cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4, receive_name: 'SYN-SECRET' },
        { provinceName: '广东', provinceId: 6, statDate: '2026-11-21', cfmOrdrAmt: 820.4, cfmOrdrCnt: 44,
          cfmOrdrUsrCnt: 37, cfmOrdrAup: 22.1729, cfmOrdrAop: 18.6454, extraNoise: 'SYN-NOISE' },
      ],
    }, { window });
    assert.deepEqual(Object.keys(view), ORDER_REGIONS_FIELDS);
    assert.deepEqual(Object.keys(view.items[0]), ORDER_REGION_ITEM_FIELDS);
    for (const forbidden of ['provinceId', 'SYN-SECRET', 'SYN-NOISE', 'extraNoise']) {
      assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
    }
    assert.equal(view.caliber, '数据中心-地域分布（成团订单）');
    assert.deepEqual(view.window, window);
    assert.equal(view.window_days, 7);
    assert.equal(view.delayed, true);
    assert.equal(view.province_count, 2);
    assert.deepEqual(view.items, [
      { province: '广东', confirmed_order_amount_yuan: 820.4, confirmed_order_count: 44,
        confirmed_buyer_count: 37, avg_buyer_amount_yuan: 22.17, avg_order_amount_yuan: 18.65 },
      { province: '浙江', confirmed_order_amount_yuan: 25.4, confirmed_order_count: 1,
        confirmed_buyer_count: 1, avg_buyer_amount_yuan: 25.4, avg_order_amount_yuan: 25.4 },
    ]);
  });

  it('handles empty province list, omitted window, missing amounts/delayData and null regions cleanly', () => {
    const emptyView = toOrderRegionsView({ delayData: null, items: [] });
    assert.equal(emptyView.window, null);
    assert.equal(emptyView.delayed, null);
    assert.equal(emptyView.province_count, 0);
    assert.deepEqual(emptyView.items, []);

    const nullMetricsView = toOrderRegionsView({
      delayData: 0,
      items: [
        { provinceName: '江苏', statDate: '2026-11-21', cfmOrdrAmt: null, cfmOrdrCnt: null,
          cfmOrdrUsrCnt: null, cfmOrdrAup: null, cfmOrdrAop: null },
        { provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: 25.4, cfmOrdrCnt: 1,
          cfmOrdrUsrCnt: null, cfmOrdrAup: null, cfmOrdrAop: 25.4 },
      ],
    });
    assert.equal(nullMetricsView.window, null);
    assert.equal(nullMetricsView.items[0].province, '浙江');
    assert.equal(nullMetricsView.items[1].confirmed_order_amount_yuan, null);
    assert.equal(nullMetricsView.items[1].confirmed_buyer_count, null);

    assert.equal(toOrderRegionsView(null), null);
  });
});

describe('getOrderStatsView withRegions collection', () => {
  let transport;
  let ctx;

  beforeEach(() => {
    transport = createMemoryEndpointTransport({
      responses: {
        'orders.stats': { success: true, result: { unship: 1, unship12h: 0, delay: 0, unreceive: 0 } },
        'orders.list': {
          success: true,
          result: {
            totalItemNum: 1,
            pageItems: [{ order_time: 1700000000, shipping_time: 1700003600, after_sales_status: null }],
          },
        },
        'orders.regionDistribution': {
          success: true,
          errorCode: 0,
          result: {
            delayData: 0,
            geographyDistributionVOList: [{ provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: 25.4, cfmOrdrCnt: 1,
              cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4 }],
          },
        },
      },
    });
    ctx = createTestCtx({
      transport,
      page: { context: () => ({ newPage: vi.fn(async () => ({ close: vi.fn(async () => {}) })) }) },
      mallId: '900001',
    });
  });

  it('skips region endpoint by default, queries with explicit page and resolves window when withRegions is true', async () => {
    const plain = await getOrderStatsView(ctx.page, {}, ctx);
    assert.equal(plain.headline.length, 2);
    assert.equal(plain.headline[0], '待发货 1 单（超 12 小时 0 单），延迟发货 0 单，已发货待收货 0 单');
    assert.equal(Object.hasOwn(plain, 'regions'), false);
    assert.equal(transport.calls.some((call) => call.name === 'orders.regionDistribution'), false);

    const explicitPage = { id: 'explicit-page' };
    const ctxWithoutPage = { ...ctx, page: undefined };
    const data = await getOrderStatsView(explicitPage, { withRegions: true }, ctxWithoutPage);
    const regionCall = transport.calls.find((call) => call.name === 'orders.regionDistribution');
    assert.deepEqual(regionCall?.params, {});
    assert.equal(regionCall?.page, explicitPage);
    assert.equal(data.headline.length, 3);
    assert.deepEqual(data.regions.window, { start_date: '2026-11-15', end_date: '2026-11-21', days: 7 });
    assert.equal(data.regions.province_count, 1);
    assert.match(data.headline[2], /浙江成团额最高/);
  });

  it('degrades domain/PUA/auth errors while propagating internal, timeout and bug errors', async () => {
    transport.set('orders.regionDistribution', {
      success: true,
      errorCode: 0,
      result: {
        delayData: 0,
        geographyDistributionVOList: [{ provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: '\uE001', cfmOrdrCnt: 1,
          cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4 }],
      },
    });
    const puaDegraded = await getOrderStatsView(ctx.page, { withRegions: true }, ctx);
    assert.equal(puaDegraded.regions, null);
    assert.equal(puaDegraded.headline.length, 2);
    assert.ok(puaDegraded.hints.includes('省级成团地域分布返回字体混淆数据，regions 为 null'));

    transport.set('orders.regionDistribution', { status: 401, raw: null });
    const authDegraded = await getOrderStatsView(ctx.page, { withRegions: true }, ctx);
    assert.equal(authDegraded.regions, null);
    assert.ok(authDegraded.hints.includes('省级成团地域分布拉取失败，regions 为 null'));

    const internal = new PddCliError({ code: 'E_INTERNAL', message: 'internal', exitCode: 1 });
    transport.fail('orders.regionDistribution', internal);
    await assert.rejects(getOrderStatsView(ctx.page, { withRegions: true }, ctx), (actual) => actual === internal);

    const timeout = new PddCliError({ code: 'E_TIMEOUT', message: 'timeout', exitCode: 5 });
    transport.fail('orders.regionDistribution', timeout);
    await assert.rejects(getOrderStatsView(ctx.page, { withRegions: true }, ctx), (actual) => actual === timeout);

    const bug = new TypeError('unexpected bug');
    transport.fail('orders.regionDistribution', bug);
    await assert.rejects(getOrderStatsView(ctx.page, { withRegions: true }, ctx), (actual) => actual === bug);
  });
});
