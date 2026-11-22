import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { PddCliError } from '../../src/infra/errors.js';
import { renderSingleDashboard } from '../../src/commands/diagnose/_render.js';
import {
  toOrdersDiagnosisView, ORDER_REGIONS_FIELDS, ORDER_REGION_ITEM_FIELDS,
} from '../../src/services/views/diagnose.js';

const mockState = vi.hoisted(() => ({ calls: [], responses: {}, errors: {} }));

vi.mock('../../src/adapter/run-endpoint.js', async (importOriginal) => ({
  ...(await importOriginal()),
  async runEndpoint(_page, spec, params) {
    mockState.calls.push({ name: spec.name, params });
    if (mockState.errors[spec.name]) throw mockState.errors[spec.name];
    return mockState.responses[spec.name];
  },
}));

const { getOrdersDiagnosis } = await import('../../src/services/diagnose/reports.js');

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
          { provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: 25.4, cfmOrdrCnt: 1,
            cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4 },
          { provinceName: '广东', statDate: '2026-11-21', cfmOrdrAmt: 820.4, cfmOrdrCnt: 44,
            cfmOrdrUsrCnt: 37, cfmOrdrAup: 22.1729, cfmOrdrAop: 18.6454 },
        ],
      },
    });
    assert.deepEqual(Object.keys(view.regions), ORDER_REGIONS_FIELDS);
    assert.deepEqual(Object.keys(view.regions.items[0]), ORDER_REGION_ITEM_FIELDS);
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

  it('handles empty province list and null regions degradation cleanly', () => {
    const emptyView = toOrdersDiagnosisView(baseSummary, { regions: { delayData: 0, items: [] } });
    assert.equal(emptyView.regions.window, null);
    assert.equal(emptyView.regions.delayed, false);
    assert.equal(emptyView.regions.province_count, 0);
    assert.deepEqual(emptyView.regions.items, []);
    assert.equal(emptyView.headline.at(-1), '近 7 天成团地域分布无成团省份');

    const degradedView = toOrdersDiagnosisView(baseSummary, { regions: null, extraHints: ['省级成团地域分布拉取失败，regions 为 null'] });
    assert.equal(degradedView.regions, null);
    assert.equal(degradedView.headline.length, 2);
    assert.deepEqual(degradedView.hints, ['省级成团地域分布拉取失败，regions 为 null']);
  });
});

describe('getOrdersDiagnosis regions collection', () => {
  const ctx = {
    page: { context: () => ({ newPage: vi.fn(async () => ({ close: vi.fn(async () => {}) })) }) },
    mallCtx: { activeId: '900001' },
    log: { debug() {} },
  };

  beforeEach(() => {
    mockState.calls = [];
    mockState.errors = {};
    mockState.responses = {
      'orders.stats': { unship: 1, unship12h: 0, delay: 0, unreceive: 0 },
      'orders.list': { orders: [{ order_time: 1700000000, shipping_time: 1700003600, after_sales_status: null }], total: 1 },
      'orders.regionDistribution': {
        delayData: 0,
        geographyDistributionVOList: [],
        items: [{ provinceName: '浙江', statDate: '2026-11-21', cfmOrdrAmt: 25.4, cfmOrdrCnt: 1,
          cfmOrdrUsrCnt: 1, cfmOrdrAup: 25.4, cfmOrdrAop: 25.4 }],
      },
    };
  });

  it('queries queryType 1 and degrades domain/PUA errors while propagating timeouts and bugs', async () => {
    const { data, warnings } = await getOrdersDiagnosis(ctx);
    assert.deepEqual(warnings, []);
    assert.equal(mockState.calls.some((call) => call.name === 'orders.regionDistribution' && call.params.queryType === 1), true);
    assert.equal(data.regions.province_count, 1);

    mockState.errors['orders.regionDistribution'] = new PddCliError({
      code: 'E_BUSINESS', message: '平台返回字体混淆数据', exitCode: 6,
    });
    const { data: puaDegraded } = await getOrdersDiagnosis(ctx);
    assert.equal(puaDegraded.regions, null);
    assert.equal(puaDegraded.status, '数据完整');
    assert.ok(puaDegraded.hints.includes('省级成团地域分布返回字体混淆数据，regions 为 null'));

    const timeout = new PddCliError({ code: 'E_TIMEOUT', message: 'timeout', exitCode: 5 });
    mockState.errors['orders.regionDistribution'] = timeout;
    await assert.rejects(getOrdersDiagnosis(ctx), (actual) => actual === timeout);

    const bug = new TypeError('unexpected bug');
    mockState.errors['orders.regionDistribution'] = bug;
    await assert.rejects(getOrdersDiagnosis(ctx), (actual) => actual === bug);
  });
});
