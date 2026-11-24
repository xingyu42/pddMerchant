import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { getOrderDetailResult } from '../../src/services/orders.js';
import { ORDER_TRACK_REPORT } from '../../src/services/views/logistics.js';
import {
  createOrderTrackFixtures,
  createUpstreamForwardTrack,
  createUpstreamOrderDetail,
  createUpstreamReverseTrack,
} from '../fixtures/test-data.js';

function mockCtx(handlers) {
  let afterSalesCalls = 0;
  let forwardCalls = 0;
  return {
    getCounts: () => ({ afterSalesCalls, forwardCalls }),
    ctx: {
      page: {},
      mallCtx: { activeId: '900001' },
      client: {
        async execute(meta, params) {
          if (meta.name === 'after_sales.list') afterSalesCalls++;
          if (meta.name === 'logistics.forwardTrack') forwardCalls++;
          const handler = handlers[meta.name];
          if (!handler) throw new Error(`unexpected endpoint ${meta.name}`);
          const raw = typeof handler === 'function' ? await handler(params) : handler;
          return { data: meta.normalize(raw) };
        },
      },
    },
  };
}

function mockTrackCtx(options, overrides = {}) {
  const fixtures = createOrderTrackFixtures(options);
  const handlers = Object.fromEntries(
    Object.entries(fixtures).map(([path, raw]) => [path.slice('endpoints/'.length, -'.json'.length), raw]),
  );
  return mockCtx({ ...handlers, ...overrides });
}

function afterSalesList(orderSn, cases) {
  return {
    success: true,
    errorCode: 1000000,
    result: { total: cases.length, list: cases.map((entry) => ({ orderSn, ...entry })) },
  };
}

const SHIP_NOTICE = { time: '2026-11-14 16:29:02', status: 'OTHER', info: '商家已发货，正在通知圆通快递取件' };
const unixTime = (iso) => Math.floor(Date.parse(iso) / 1000);

describe('orders detail --with-track service', () => {
  it('reuses the after-sales query and enriches forward and reverse milestones and headline', async () => {
    const { ctx, getCounts } = mockTrackCtx({
      closeTime: Date.parse('2026-11-23T16:00:00+08:00'),
    });

    const result = await getOrderDetailResult(ctx, 'SYN-ORDER-TRACK-1', { withTrack: true });

    assert.equal(getCounts().afterSalesCalls, 1);
    assert.equal(getCounts().forwardCalls, 1);
    assert.equal(result.meta.xhr_count, 5);
    assert.equal(result.data.headline.length, 4);
    assert.equal(result.data.order.order_sn, 'SYN-ORDER-TRACK-1');
    assert.equal(result.data.after_sales_cases.length, 1);
    assert.equal(result.data.track.forward.available, true);
    assert.equal(result.data.track.forward.shipping_id, '85');
    assert.equal(result.data.track.forward.delivered_at, '2026-11-20 15:00:00');
    assert.equal(result.data.track.forward.delivery_event, '已入柜/驿站待取');
    assert.equal(result.data.track.forward.in_cabinet_at, '2026-11-20 15:00:00');
    assert.equal(result.data.track.forward.signed_at, '2026-11-20 18:00:00');
    assert.equal(result.data.track.forward.transit_days, 2);

    assert.equal(result.data.track.returns.length, 1);
    const ret = result.data.track.returns[0];
    assert.equal(ret.reverse_shipping_id, '85');
    assert.equal(ret.status, '待商家收货');
    assert.equal(ret.type, '退货退款');
    assert.equal(ret.closed_at, '2026-11-23 16:00:00');
    assert.equal(ret.reverse_available, true);
    assert.equal(ret.return_arrived_at, '2026-11-23 15:00:00');
    assert.equal(ret.return_delivery_event, '已签收');
    assert.equal(ret.delivery_to_apply_days, 1);
    assert.equal(ret.apply_to_return_arrived_days, 2);
    assert.equal(ret.delivery_to_return_arrived_days, 3);
    assert.equal(ret.reverse_transit_days, 1.88);
    assert.deepEqual(result.data.hints, []);
    assert.ok(result.data.headline[2].includes('正向快递 2026-11-20 15:00:00 送达'));
    assert.ok(result.data.headline[3].includes('收货至发起售后 1 天，收货至退回签收 3 天'));
  });

  it('keeps fixed summaries while excluding raw personal data and hotlines', async () => {
    const { ctx } = mockTrackCtx();
    const result = await getOrderDetailResult(ctx, 'SYN-ORDER-TRACK-1', { withTrack: true });
    const serialized = JSON.stringify(result.data);
    for (const leaked of ['张三', '李四', '王五', '13812345678', '13987654321', '13700001111', '95554', 'SYN-SHIPPING-PHONE', 'SYN-POSTMAN-NAME', 'SYN-POSTMAN-PHONE', '阳光小区']) {
      assert.equal(serialized.includes(leaked), false, `leaked: ${leaked}`);
    }
    assert.equal(serialized.includes('快件已揽收'), true);
    assert.equal(serialized.includes('快件已签收'), true);
  });

  it('skips after_sales.list on normal orders without after-sales even with withTrack: true', async () => {
    const { ctx, getCounts } = mockCtx({
      'orders.detail': {
        success: true,
        result: createUpstreamOrderDetail({
          order_sn: 'SYN-NO-AS',
          after_sales_id: null,
          after_sales_status: '无售后',
          after_sales_status_code: null,
        }),
      },
      'logistics.forwardTrack': createUpstreamForwardTrack({ orderSn: 'SYN-NO-AS' }),
    });

    const result = await getOrderDetailResult(ctx, 'SYN-NO-AS', { withTrack: true });
    assert.equal(getCounts().afterSalesCalls, 0);
    assert.equal(result.meta.xhr_count, 2);
    assert.equal(result.data.headline.length, 3);
    assert.deepEqual(result.data.after_sales_cases, []);
    assert.equal(result.data.track.forward.available, true);
    assert.deepEqual(result.data.track.returns, []);
  });

  it('omits data.track and skips logistics calls when withTrack is false', async () => {
    const { ctx, getCounts } = mockCtx({
      'orders.detail': {
        success: true,
        result: createUpstreamOrderDetail({
          order_sn: 'SYN-PLAIN',
          after_sales_id: null,
          after_sales_status: '无售后',
          after_sales_status_code: null,
        }),
      },
    });

    const result = await getOrderDetailResult(ctx, 'SYN-PLAIN', { withTrack: false });
    assert.equal(getCounts().forwardCalls, 0);
    assert.equal(result.meta.xhr_count, 1);
    assert.equal(Object.hasOwn(result.data, 'track'), false);
  });

  it('reports distinct hints for unavailable, missing-ID, empty and failed tracks', async () => {
    const orderSn = 'SYN-ORDER-TRACK-2';
    const { ctx } = mockTrackCtx({ orderSn }, {
      'logistics.forwardTrack': { success: true, error_code: '成功', result: null },
      'after_sales.list': afterSalesList(orderSn, [
        { id: 1, createdAt: unixTime('2026-11-21T15:00:00+08:00'), reverseTrackingNumber: 'TN-MISSING-ID' },
        { id: 2, createdAt: unixTime('2026-11-21T12:00:00+08:00'), reverseShippingId: 85, reverseTrackingNumber: 'TN-EMPTY' },
        { id: 3, createdAt: unixTime('2026-11-21T11:30:00+08:00'), reverseShippingId: 85, reverseTrackingNumber: 'TN-EMPTY-TRACES' },
        { id: 4, createdAt: unixTime('2026-11-21T11:00:00+08:00'), reverseShippingId: 85, reverseTrackingNumber: 'TN-FAIL' },
      ]),
      'logistics.reverseTrack': ({ trackingNumber }) => {
        if (trackingNumber === 'TN-EMPTY') return { success: true, error_code: '0', result: null };
        if (trackingNumber === 'TN-EMPTY-TRACES') return createUpstreamReverseTrack({ trackingNumber, traces: [] });
        throw new PddCliError({ code: 'E_NETWORK', message: 'network failure', exitCode: ExitCodes.NETWORK });
      },
    });
    const nullForward = await getOrderDetailResult(ctx, orderSn, { withTrack: true });

    assert.equal(nullForward.data.track.forward.available, false);
    assert.equal(nullForward.data.track.returns.length, 4);
    assert.equal(nullForward.data.track.returns[0].reverse_available, false);
    assert.equal(nullForward.data.track.returns[2].reverse_available, true);
    assert.equal(nullForward.data.track.returns[2].trace_count, 0);
    assert.deepEqual(nullForward.data.hints, [
      ORDER_TRACK_REPORT.hints.forward_unavailable,
      ORDER_TRACK_REPORT.hints.reverse_track_missing_id,
      ORDER_TRACK_REPORT.hints.reverse_track_empty,
      ORDER_TRACK_REPORT.hints.reverse_track_unavailable,
    ]);
  });

  it('marks a forward ship notice with fallback pickup time as having no carrier trace', async () => {
    const shipNoticeOnly = await getOrderDetailResult(
      mockCtx({
        'orders.detail': {
          success: true,
          result: createUpstreamOrderDetail({
            order_sn: 'SYN-NOTICE-ONLY',
            after_sales_id: null,
            after_sales_status: '无售后',
            after_sales_status_code: null,
          }),
        },
        'logistics.forwardTrack': createUpstreamForwardTrack({
          orderSn: 'SYN-NOTICE-ONLY',
          traces: [SHIP_NOTICE],
        }),
      }).ctx,
      'SYN-NOTICE-ONLY',
      { withTrack: true },
    );
    assert.equal(shipNoticeOnly.data.hints.includes(ORDER_TRACK_REPORT.hints.forward_no_carrier_trace), true);
    assert.equal(shipNoticeOnly.data.headline[2].includes('正向物流暂无承运商轨迹'), true);
  });

  it('preserves order detail when the forward request fails with a network error', async () => {
    const degradedForward = await getOrderDetailResult(
      mockCtx({
        'orders.detail': {
          success: true,
          result: createUpstreamOrderDetail({
            order_sn: 'SYN-FWD-ERR',
            after_sales_id: null,
            after_sales_status: '无售后',
            after_sales_status_code: null,
          }),
        },
        'logistics.forwardTrack': () => {
          throw new PddCliError({ code: 'E_NETWORK', message: 'net', exitCode: ExitCodes.NETWORK });
        },
      }).ctx,
      'SYN-FWD-ERR',
      { withTrack: true },
    );
    assert.equal(degradedForward.data.order.order_sn, 'SYN-FWD-ERR');
    assert.equal(degradedForward.data.track.forward.available, false);
    assert.deepEqual(degradedForward.data.hints, [ORDER_TRACK_REPORT.hints.forward_track_unavailable]);
  });

  it.each([
    ['E_TIMEOUT', ExitCodes.NETWORK], ['E_RATE_LIMIT', ExitCodes.RATE_LIMIT],
  ])('propagates fatal forward request errors: %s', async (code, exitCode) => {
    const { ctx } = mockTrackCtx({ orderSn: 'SYN-FATAL' }, {
      'logistics.forwardTrack': () => {
        throw new PddCliError({ code, message: code, exitCode });
      },
    });
    await assert.rejects(() => getOrderDetailResult(ctx, 'SYN-FATAL', { withTrack: true }), { code });
  });

  it.each([
    ['no trace nodes', []],
    ['only a merchant ship notice', [SHIP_NOTICE]],
    ['only an unclassified node', [{ time: SHIP_NOTICE.time, status: 'OTHER', info: '物流节点更新' }]],
  ])('marks reverse track as empty despite fallback pickup time with %s', async (_label, traces) => {
    const orderSn = 'SYN-REV-EMPTY-TRACES';
    const reverseTrack = createUpstreamReverseTrack({ traces });
    reverseTrack.result.wideGotTime = '2026-11-21 18:00:00';
    const { ctx } = mockTrackCtx({ orderSn, reverseTrack });
    const result = await getOrderDetailResult(ctx, orderSn, { withTrack: true });
    assert.deepEqual(result.data.hints, [ORDER_TRACK_REPORT.hints.reverse_track_empty]);
    assert.equal(result.data.track.returns[0].reverse_available, true);
    assert.equal(result.data.track.returns[0].trace_count, traces.length);
    assert.equal(result.data.track.returns[0].got_at, '2026-11-21 18:00:00');
  });

  it('does not use an older return in the headline for a newer refund-only case', async () => {
    const orderSn = 'SYN-MULTI-CASE';
    const reverseTrack = createUpstreamReverseTrack({
      trackingNumber: 'TN-OLD-CABINET',
      traces: [{ time: '2026-11-23 15:00:00', status: 'IN_CABINET', info: '包裹已入库，存入丰巢快递柜' }],
    });
    const { ctx } = mockTrackCtx({ orderSn, reverseTrack }, {
      'orders.detail': {
        success: true,
        result: createUpstreamOrderDetail({ order_sn: orderSn, after_sales_id: '77010', after_sales_status_code: 11 }),
      },
      'after_sales.list': afterSalesList(orderSn, [
        {
          id: 77010,
          afterSalesType: 1,
          afterSalesTypeName: '仅退款',
          afterSalesStatus: 3,
          createdAt: unixTime('2026-11-22T15:00:00+08:00'),
          afterSalesReasonDesc: '最新仅退款',
        },
        {
          id: 77009,
          afterSalesType: 2,
          afterSalesTypeName: '退货退款',
          afterSalesStatus: 11,
          createdAt: unixTime('2026-11-21T15:00:00+08:00'),
          afterSalesReasonDesc: '早期退货',
          reverseShippingId: 85,
          reverseTrackingNumber: 'TN-OLD-CABINET',
        },
      ]),
    });
    const multiCaseMismatch = await getOrderDetailResult(ctx, orderSn, { withTrack: true });
    assert.ok(multiCaseMismatch.data.headline[3].includes('仅退款'));
    assert.equal(multiCaseMismatch.data.headline[3].includes('退回签收'), false);
    assert.equal(multiCaseMismatch.data.headline[3].includes('退回到达'), false);
  });
});
