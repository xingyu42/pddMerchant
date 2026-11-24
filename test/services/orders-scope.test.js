// 订单范围（scope）贯通测试：各调用方传给 orders.list 的范围（design D5），以及退款字段缺失时的 null 传播。
import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { collectOrdersForStaleAnalysis } from '../../src/services/diagnose/orders-collector.js';
import { collectGoodsInput, collectOrdersInput } from '../../src/services/diagnose/collectors.js';
import { getAfterSalesDiagnosis } from '../../src/services/diagnose/reports.js';
import { getOrderListView, getOrderStatsView } from '../../src/services/orders.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

let transport;
let orders;
let ctx;

function listScopes() {
  return transport.calls.filter((call) => call.name === 'orders.list').map((call) => call.params.scope);
}

beforeEach(() => {
  orders = [];
  transport = createMemoryEndpointTransport((spec) => {
    if (spec.name === 'orders.list') {
      return { success: true, result: { totalItemNum: orders.length, pageItems: orders } };
    }
    if (spec.name === 'orders.stats') {
      return { success: true, result: { unship: 1, unship12h: 0, delay: 0, unreceive: 0 } };
    }
    if (spec.name === 'goods.list') {
      return { success: true, result: { total: 1, goods_list: [{ goods_id: 101, goods_name: 'Tea', quantity: 3 }] } };
    }
    throw new Error(`unexpected endpoint ${spec.name}`);
  });
  ctx = createTestCtx({ transport });
});

describe('order list scope per caller', () => {
  it('collects sales orders with the valid scope by default and honours an explicit scope', async () => {
    const listOrders = vi.fn(async () => ({ orders: [] }));
    await collectOrdersForStaleAnalysis({}, ctx, { listOrders, now: 1700000000 });
    assert.equal(listOrders.mock.calls[0][1].scope, 'valid');
    await collectOrdersForStaleAnalysis({}, ctx, { listOrders, now: 1700000000, scope: 'all' });
    assert.equal(listOrders.mock.calls[1][1].scope, 'all');
  });

  it('uses the valid (sales) scope for inventory enrichment', async () => {
    await collectGoodsInput(ctx.page, ctx);
    assert.deepEqual(listScopes(), ['valid']);
  });

  it('uses the all scope for order diagnosis, after-sales diagnosis and local order stats', async () => {
    await collectOrdersInput(ctx.page, ctx);
    await getAfterSalesDiagnosis(ctx);
    await getOrderStatsView(ctx.page, {}, ctx);
    assert.deepEqual(listScopes(), ['all', 'all', 'all']);
  });

  it('retains partial-data hints when the after-sales order scan reaches its cap', async () => {
    vi.useFakeTimers();
    orders = Array.from({ length: 50 }, (_, index) => ({
      order_sn: `SYN-${index}`, after_sales_status: 10,
    }));
    const pending = getAfterSalesDiagnosis(ctx, { days: 7 });
    await vi.runAllTimersAsync();
    const { data } = await pending;
    assert.equal(data.status, '数据不完整');
    assert.equal(data.detail.total_orders, 500);
    assert.equal(data.detail.after_sales_count, 500);
    assert.equal(data.detail.after_sales_rate_pct, 100);
    assert.ok(data.hints.some((hint) => hint.includes('采集上限（500 条）')));
    assert.equal(listScopes().length, 10);
    assert.ok(listScopes().every((scope) => scope === 'all'));
  });

  it('defaults orders list to all and forwards an explicit CLI scope', async () => {
    orders = [{ order_sn: 'SYN-1', order_status_str: '待发货', after_sales_status: null }];
    const all = await getOrderListView(ctx.page, {}, ctx);
    const pending = await getOrderListView(ctx.page, { scope: 'pending_ship' }, ctx);
    assert.deepEqual(listScopes(), ['all', 'pending_ship']);
    assert.equal(all.headline[0], '近 7 天全部订单共 1 单，本页 1 单');
    assert.equal(pending.headline[0], '近 7 天待发货订单共 1 单，本页 1 单');
    assert.equal(pending.headline[1], '本页状态：待发货 1 单');
  });

  it('names the scope when it has no orders', async () => {
    assert.deepEqual((await getOrderListView(ctx.page, { scope: 'after_sales' }, ctx)).headline, ['近 7 天无售后处理中订单']);
    assert.deepEqual((await getOrderListView(ctx.page, {}, ctx)).headline, ['近 7 天无订单']);
  });
});

describe('refund facts when the after-sales field is absent', () => {
  it('keeps after-sales counts and rates null when the source field is absent', async () => {
    orders = [{ order_sn: 'SYN-1', order_status_str: '已收货' }];
    const { data } = await getAfterSalesDiagnosis(ctx);
    assert.equal(data.detail.total_orders, 1);
    assert.equal(data.detail.refund_count, null);
    assert.equal(data.detail.refund_rate_pct, null);
    assert.equal(data.detail.after_sales_count, null);
    assert.equal(data.detail.after_sales_rate_pct, null);
    assert.equal(Object.hasOwn(data.detail, 'fulfillment_rate_pct'), false);
    assert.ok(data.headline.some((line) => line.includes('售后数据不可用')));
    assert.ok(data.headline.every((line) => !line.includes('退款 0 单')));
  });

  it('states unavailable refund data in the local order stats headline', async () => {
    orders = [{ order_sn: 'SYN-1', order_status_str: '已收货' }];
    const view = await getOrderStatsView(ctx.page, {}, ctx);
    assert.equal(view.local.refund_count, null);
    assert.equal(view.local.refund_rate_pct, null);
    assert.match(view.headline[2], /退款数据不可用/);
  });

  it('reports refunded and open after-sales counts when the field is present', async () => {
    orders = [
      { order_status_str: '已发货，退款成功', after_sales_status: 5 },
      { order_status_str: '已发货，待收货', after_sales_status: 10 },
      { order_status_str: '已发货，待收货', after_sales_status: null },
      { order_status_str: '已收货', after_sales_status: null },
    ];
    const view = await getOrderStatsView(ctx.page, {}, ctx);
    assert.equal(view.local.refund_count, 1);
    assert.equal(view.local.after_sales_count, 1);
    assert.equal(view.local.refund_rate_pct, 25);
    assert.match(view.headline[2], /退款成功 1 单，售后处理中 1 单/);
    const { data } = await getAfterSalesDiagnosis(ctx);
    assert.deepEqual(data.headline, [
      '近 30 天订单 4 单，退款成功 1 单（退款率 25%）',
      '售后处理中 1 单（占比 25%）',
    ]);
    assert.equal(data.detail.after_sales_count, 1);
    assert.equal(data.detail.after_sales_rate_pct, 25);
  });
});
