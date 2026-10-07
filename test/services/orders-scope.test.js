// 订单范围（scope）贯通测试：各调用方传给 orders.list 的范围（design D5），以及退款字段缺失时的 null 传播。
import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const calls = vi.hoisted(() => []);
const responses = vi.hoisted(() => ({ orders: [] }));

vi.mock('../../src/adapter/run-endpoint.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runEndpoint: vi.fn(async (_page, spec, params) => {
    calls.push({ name: spec.name, params });
    if (spec.name === 'orders.list') return { total: responses.orders.length, orders: responses.orders };
    if (spec.name === 'orders.stats') return { unship: 1, unship12h: 0, delay: 0, unreceive: 0 };
    if (spec.name === 'goods.list') return { total: 1, goods: [{ goods_id: 101, goods_name: 'Tea', quantity: 3 }] };
    throw new Error(`unexpected endpoint ${spec.name}`);
  }),
}));

const { collectOrdersForStaleAnalysis } = await import('../../src/services/diagnose/orders-collector.js');
const { collectGoodsInput, collectOrdersInput } = await import('../../src/services/diagnose/collectors.js');
const { getFunnelDiagnosis } = await import('../../src/services/diagnose/reports.js');
const { getOrderListView, getOrderStatsView } = await import('../../src/services/orders.js');

const CTX = { log: { debug() {} } };

function listScopes() {
  return calls.filter((call) => call.name === 'orders.list').map((call) => call.params.scope);
}

beforeEach(() => {
  calls.length = 0;
  responses.orders = [];
});

describe('order list scope per caller', () => {
  it('collects sales orders with the valid scope by default and honours an explicit scope', async () => {
    const listOrders = vi.fn(async () => ({ orders: [] }));
    await collectOrdersForStaleAnalysis({}, CTX, { listOrders, now: 1700000000 });
    assert.equal(listOrders.mock.calls[0][1].scope, 'valid');
    await collectOrdersForStaleAnalysis({}, CTX, { listOrders, now: 1700000000, scope: 'all' });
    assert.equal(listOrders.mock.calls[1][1].scope, 'all');
  });

  it('uses the valid (sales) scope for inventory enrichment', async () => {
    await collectGoodsInput({}, CTX);
    assert.deepEqual(listScopes(), ['valid']);
  });

  it('uses the all scope for order diagnosis, funnel diagnosis and local order stats', async () => {
    await collectOrdersInput({}, CTX);
    await getFunnelDiagnosis({ ...CTX, page: {} });
    await getOrderStatsView({}, {}, CTX);
    assert.deepEqual(listScopes(), ['all', 'all', 'all']);
  });

  it('defaults orders list to all and forwards an explicit CLI scope', async () => {
    responses.orders = [{ order_sn: 'SYN-1', order_status_str: '待发货', after_sales_status: null }];
    const all = await getOrderListView({}, {}, CTX);
    const pending = await getOrderListView({}, { scope: 'pending_ship' }, CTX);
    assert.deepEqual(listScopes(), ['all', 'pending_ship']);
    assert.equal(all.headline[0], '近 7 天全部订单共 1 单，本页 1 单');
    assert.equal(pending.headline[0], '近 7 天待发货订单共 1 单，本页 1 单');
    assert.equal(pending.headline[1], '本页状态：待发货 1 单');
  });

  it('names the scope when it has no orders', async () => {
    assert.deepEqual((await getOrderListView({}, { scope: 'after_sales' }, CTX)).headline, ['近 7 天无售后处理中订单']);
    assert.deepEqual((await getOrderListView({}, {}, CTX)).headline, ['近 7 天无订单']);
  });
});

describe('refund facts when the after-sales field is absent', () => {
  it('keeps funnel refund and fulfillment rates null and never claims zero refunds', async () => {
    responses.orders = [{ order_sn: 'SYN-1', order_status_str: '已收货' }];
    const { data } = await getFunnelDiagnosis({ ...CTX, page: {} });
    assert.equal(data.detail.total_orders, 1);
    assert.equal(data.detail.refund_count, null);
    assert.equal(data.detail.refund_rate_pct, null);
    assert.equal(data.detail.fulfillment_rate_pct, null);
    assert.ok(data.headline.some((line) => line.includes('退款数据不可用')));
    assert.ok(data.headline.every((line) => !line.includes('退款 0 单')));
  });

  it('states unavailable refund data in the local order stats headline', async () => {
    responses.orders = [{ order_sn: 'SYN-1', order_status_str: '已收货' }];
    const view = await getOrderStatsView({}, {}, CTX);
    assert.equal(view.local.refund_count, null);
    assert.equal(view.local.refund_rate_pct, null);
    assert.match(view.headline[2], /退款数据不可用/);
  });

  it('reports refunded and open after-sales counts when the field is present', async () => {
    responses.orders = [
      { order_status_str: '已发货，退款成功', after_sales_status: 5 },
      { order_status_str: '已发货，待收货', after_sales_status: 10 },
      { order_status_str: '已发货，待收货', after_sales_status: null },
      { order_status_str: '已收货', after_sales_status: null },
    ];
    const view = await getOrderStatsView({}, {}, CTX);
    assert.equal(view.local.refund_count, 1);
    assert.equal(view.local.after_sales_count, 1);
    assert.equal(view.local.refund_rate_pct, 25);
    assert.match(view.headline[2], /退款成功 1 单，售后处理中 1 单/);
  });
});
