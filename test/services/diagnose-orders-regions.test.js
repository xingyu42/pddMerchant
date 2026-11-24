import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { PddCliError } from '../../src/infra/errors.js';
import { renderSingleDashboard } from '../../src/commands/diagnose/_render.js';
import { getOrdersDiagnosis } from '../../src/services/diagnose/reports.js';
import {
  toOrdersDiagnosisView, ORDER_REGIONS_FIELDS, ORDER_REGION_ITEM_FIELDS,
} from '../../src/services/views/diagnose.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const baseSummary = {
  status: 'full',
  issues: [],
  hints: [],
  detail: { shipping_p95_hours: 10, refund_rate_pct: 5, pending_ship_count: 1, delayed_ship_count: 0 },
};

describe('orders diagnosis regions view', () => {
  it('projects whitelisted sorted regions, rounded yuan values and delay hint', () => {
    const view = toOrdersDiagnosisView(baseSummary, {
      mallId: '900001',
      regions: {
        delayData: 1,
        items: [
          { provinceName: '浙江', provinceId: 31, statDate: '2026-11-21', cfmOrdrAmt: 25.4, cfmOrdrCnt: 1,
            cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4, receive_name: 'SYN-SECRET' },
          { provinceName: '广东', provinceId: 6, statDate: '2026-11-21', cfmOrdrAmt: 820.4, cfmOrdrCnt: 44,
            cfmOrdrUsrCnt: 37, cfmOrdrAup: 22.1729, cfmOrdrAop: 18.6454, extraNoise: 'SYN-NOISE' },
        ],
      },
    });
    assert.deepEqual(Object.keys(view.regions), ORDER_REGIONS_FIELDS);
    assert.deepEqual(Object.keys(view.regions.items[0]), ORDER_REGION_ITEM_FIELDS);
    for (const forbidden of ['provinceId', 'SYN-SECRET', 'SYN-NOISE', 'extraNoise']) {
      assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
    }
    assert.equal(view.regions.caliber, '数据中心-地域分布（成团订单）');
    assert.deepEqual(view.regions.window, { start_date: '2026-11-15', end_date: '2026-11-21', days: 7 });
    assert.equal(view.regions.window_days, 7);
    assert.equal(view.regions.delayed, true);
    assert.equal(view.regions.province_count, 2);
    assert.deepEqual(view.regions.items, [
      { province: '广东', confirmed_order_amount_yuan: 820.4, confirmed_order_count: 44,
        confirmed_buyer_count: 37, avg_buyer_amount_yuan: 22.17, avg_order_amount_yuan: 18.65 },
      { province: '浙江', confirmed_order_amount_yuan: 25.4, confirmed_order_count: 1,
        confirmed_buyer_count: 1, avg_buyer_amount_yuan: 25.4, avg_order_amount_yuan: 25.4 },
    ]);
    assert.equal(view.headline.at(-1), '近 7 天成团分布覆盖 2 个省，广东成团额最高（820.4 元、44 单）');
    assert.deepEqual(view.hints, ['平台标记地域分布数据延迟']);
    assert.equal(view.mall_id, '900001');

    const rendered = renderSingleDashboard({ command: 'diagnose.orders', data: view }, { useColor: false });
    assert.match(rendered, /省级成团分布（数据中心-地域分布（成团订单））/);
    assert.match(rendered, /广东/);
  });

  it('handles empty province list, missing amounts/delayData and null regions degradation cleanly', () => {
    const emptyView = toOrdersDiagnosisView(baseSummary, { regions: { delayData: null, items: [] } });
    assert.equal(emptyView.regions.window, null);
    assert.equal(emptyView.regions.delayed, null);
    assert.equal(emptyView.regions.province_count, 0);
    assert.deepEqual(emptyView.regions.items, []);
    assert.deepEqual(emptyView.hints, []);
    assert.equal(emptyView.headline.at(-1), '近 7 天成团地域分布无成团省份');

    const nullMetricsView = toOrdersDiagnosisView(baseSummary, {
      regions: {
        delayData: 0,
        items: [
          { provinceName: '江苏', statDate: '2026-11-21', cfmOrdrAmt: null, cfmOrdrCnt: null,
            cfmOrdrUsrCnt: null, cfmOrdrAup: null, cfmOrdrAop: null },
          { provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: 25.4, cfmOrdrCnt: 1,
            cfmOrdrUsrCnt: null, cfmOrdrAup: null, cfmOrdrAop: 25.4 },
        ],
      },
    });
    assert.equal(nullMetricsView.regions.items[0].province, '浙江');
    assert.equal(nullMetricsView.regions.items[1].confirmed_order_amount_yuan, null);
    assert.equal(nullMetricsView.regions.items[1].confirmed_buyer_count, null);
    assert.equal(nullMetricsView.headline.at(-1),
      '近 7 天成团分布覆盖 2 个省，在金额已知的省份中，浙江成团额最高（25.4 元、1 单）');

    const allNullAmountsView = toOrdersDiagnosisView(baseSummary, {
      regions: {
        delayData: 0,
        items: [{ provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: null, cfmOrdrCnt: 1,
          cfmOrdrUsrCnt: 1, cfmOrdrAup: null, cfmOrdrAop: null }],
      },
    });
    assert.equal(allNullAmountsView.headline.at(-1), '近 7 天成团分布覆盖 1 个省（成团金额缺失）');

    const degradedView = toOrdersDiagnosisView(baseSummary, { regions: null, regionReason: 'regions_unavailable' });
    assert.equal(degradedView.regions, null);
    assert.equal(degradedView.headline.length, 2);
    assert.deepEqual(degradedView.hints, ['省级成团地域分布拉取失败，regions 为 null']);
  });
});

describe('getOrdersDiagnosis regions collection', () => {
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

  it('queries with empty params and degrades domain/PUA/auth errors while propagating internal, timeout and bug errors', async () => {
    const { data, warnings } = await getOrdersDiagnosis(ctx);
    assert.deepEqual(warnings, []);
    assert.deepEqual(transport.calls.find((call) => call.name === 'orders.regionDistribution')?.params, {});
    assert.equal(data.regions.province_count, 1);

    transport.set('orders.regionDistribution', {
      success: true,
      errorCode: 0,
      result: {
        delayData: 0,
        geographyDistributionVOList: [{ provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: '\uE001', cfmOrdrCnt: 1,
          cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4 }],
      },
    });
    const { data: puaDegraded } = await getOrdersDiagnosis(ctx);
    assert.equal(puaDegraded.regions, null);
    assert.equal(puaDegraded.status, '数据完整');
    assert.ok(puaDegraded.hints.includes('省级成团地域分布返回字体混淆数据，regions 为 null'));

    transport.set('orders.regionDistribution', { status: 401, raw: null });
    const { data: authDegraded } = await getOrdersDiagnosis(ctx);
    assert.equal(authDegraded.regions, null);
    assert.equal(authDegraded.status, '数据完整');
    assert.ok(authDegraded.hints.includes('省级成团地域分布拉取失败，regions 为 null'));

    const internal = new PddCliError({ code: 'E_INTERNAL', message: 'internal', exitCode: 1 });
    transport.fail('orders.regionDistribution', internal);
    await assert.rejects(getOrdersDiagnosis(ctx), (actual) => actual === internal);

    const timeout = new PddCliError({ code: 'E_TIMEOUT', message: 'timeout', exitCode: 5 });
    transport.fail('orders.regionDistribution', timeout);
    await assert.rejects(getOrdersDiagnosis(ctx), (actual) => actual === timeout);

    const bug = new TypeError('unexpected bug');
    transport.fail('orders.regionDistribution', bug);
    await assert.rejects(getOrdersDiagnosis(ctx), (actual) => actual === bug);
  });
});
