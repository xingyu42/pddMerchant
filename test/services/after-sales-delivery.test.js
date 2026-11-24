import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { getAfterSalesView } from '../../src/services/after-sales.js';
import { AFTER_SALES_REPORT } from '../../src/services/views/after-sales.js';
import { createUpstreamForwardTrack } from '../fixtures/test-data.js';

const ts = (iso) => Math.floor(Date.parse(iso) / 1000);

function makeRawCase(overrides = {}) {
  return {
    id: 1,
    orderSn: 'SN-1',
    goodsName: 'Tea',
    goodsSpec: '默认',
    goodsNumber: 1,
    afterSalesType: 2,
    afterSalesTypeName: '退货退款',
    afterSalesStatus: 5,
    sellerAfterSalesShippingStatus: 1,
    sellerAfterSalesShippingStatusDesc: '已发货',
    afterSalesReasonCode: 1001,
    afterSalesReasonDesc: '不喜欢',
    refundAmount: 1000,
    orderAmount: 1000,
    receiveAmount: 1000,
    createdAt: ts('2026-11-22T15:00:00+08:00'),
    closeTime: 0,
    reverseTrackingNumber: '',
    ...overrides,
  };
}

function buildCtx(cases, forwardHandler, total = cases.length) {
  const forwardCalls = [];
  return {
    forwardCalls,
    ctx: {
      mallCtx: { activeId: '900001' },
      page: {},
      client: {
        async execute(meta, params) {
          if (meta.name === 'after_sales.list') {
            return { data: { total, items: cases } };
          }
          if (meta.name === 'after_sales.params') {
            return { data: { reasonCategoryMap: {} } };
          }
          if (meta.name === 'logistics.forwardTrack') {
            forwardCalls.push(params.orderSn);
            const raw = await forwardHandler(params.orderSn);
            return { data: meta.normalize(raw) };
          }
          throw new Error(`unexpected endpoint ${meta.name}`);
        },
      },
    },
  };
}

describe('after-sales delivery enrichment', () => {
  it('deduplicates track requests and aggregates delivery intervals across shipped cases', async () => {
    const cases = [
      makeRawCase({ id: 1, orderSn: 'SN-DUP', createdAt: ts('2026-11-21T15:00:00+08:00') }),
      makeRawCase({ id: 2, orderSn: 'SN-DUP', createdAt: ts('2026-11-23T15:00:00+08:00') }),
      makeRawCase({ id: 3, orderSn: 'SN-LIVE', createdAt: ts('2026-11-22T15:00:00+08:00') }),
      makeRawCase({ id: 4, orderSn: 'SN-WAYBILL-ONLY', createdAt: ts('2026-11-22T15:00:00+08:00') }),
    ];

    const { ctx, forwardCalls } = buildCtx(cases, (sn) => {
      if (sn === 'SN-WAYBILL-ONLY') {
        return createUpstreamForwardTrack({ orderSn: sn, traces: [] });
      }
      return createUpstreamForwardTrack({
        orderSn: sn,
        traces: [
          { time: '2026-11-20 15:00:00', status: 'IN_CABINET', info: '已存入丰巢' },
        ],
      });
    });

    const { data, meta } = await getAfterSalesView(ctx, { days: 30, withDelivery: true });
    assert.deepEqual(forwardCalls, ['SN-DUP', 'SN-LIVE', 'SN-WAYBILL-ONLY']);
    assert.equal(meta.xhr_count, 5);
    assert.equal(Object.hasOwn(data.delivery, 'cache_hit_orders_count'), false);
    assert.equal(data.delivery.shipped_cases_count, 4);
    assert.equal(data.delivery.unique_orders_count, 3);
    assert.equal(data.delivery.fetched_orders_count, 3);
    assert.equal(data.delivery.delivered_orders_count, 2);
    assert.equal(data.delivery.in_transit_orders_count, 0);
    assert.equal(data.delivery.measured_cases_count, 3);
    assert.equal(data.delivery.avg_days, 2);
    assert.equal(data.delivery.p50_days, 2);
    assert.equal(data.delivery.p90_days, 2.8);
    assert.equal(data.delivery.min_days, 1);
    assert.equal(data.delivery.max_days, 3);
    assert.equal(data.items[0].delivery_source, '实时查询');
    assert.equal(data.items[3].delivery_source, '无可用轨迹');
    assert.equal(data.headline.length, 3);
  });

  it('skips unshipped or unknown shipment statuses even when a return waybill exists', async () => {
    const cases = [
      makeRawCase({ sellerAfterSalesShippingStatus: 0, sellerAfterSalesShippingStatusDesc: '未发货' }),
      makeRawCase({
        id: 2, orderSn: 'SN-MISSING-STATUS', sellerAfterSalesShippingStatus: undefined,
        sellerAfterSalesShippingStatusDesc: undefined, reverseTrackingNumber: 'REV-ONLY',
      }),
      makeRawCase({
        id: 3, orderSn: 'SN-UNKNOWN-01', sellerAfterSalesShippingStatus: '01',
        sellerAfterSalesShippingStatusDesc: undefined, reverseTrackingNumber: 'REV-01',
      }),
    ];
    const { ctx, forwardCalls } = buildCtx(cases, () => assert.fail('unexpected forward track request'));
    const { data } = await getAfterSalesView(ctx, { days: 30, withDelivery: true });
    assert.deepEqual(forwardCalls, []);
    assert.equal(data.items[0].delivery_source, '未发货');
    assert.equal(data.items[0].delivered_at, null);
    assert.equal(data.items[1].delivery_source, null);
    assert.equal(data.items[2].shipping_status, '未知(01)');
    assert.equal(data.items[2].delivery_source, null);
  });

  it('caps live fetches at maxTrackFetches, records capped hint, and keeps headline <= 3 even when truncated', async () => {
    const cases = Array.from({ length: 2000 }, (_, index) =>
      makeRawCase({ id: index + 1, orderSn: `SN-${index + 1}`, createdAt: ts('2026-11-21T15:00:00+08:00') }));
    const pagedCtx = {
      mallCtx: { activeId: '900001' },
      page: {},
      client: {
        async execute(meta, params) {
          if (meta.name === 'after_sales.list') {
            const start = (params.page - 1) * params.pageSize;
            return { data: { total: 2050, items: cases.slice(start, start + params.pageSize) } };
          }
          if (meta.name === 'after_sales.params') {
            return { data: { reasonCategoryMap: {} } };
          }
          if (meta.name === 'logistics.forwardTrack') {
            return {
              data: meta.normalize(createUpstreamForwardTrack({
                orderSn: params.orderSn,
                traces: [{ time: '2026-11-20 15:00:00', status: 'SIGN', info: '已签收' }],
              })),
            };
          }
          throw new Error(`unexpected endpoint ${meta.name}`);
        },
      },
    };

    const { data } = await getAfterSalesView(pagedCtx, { days: 30, withDelivery: true, maxTrackFetches: 2 });
    assert.equal(data.truncated, true);
    assert.equal(data.delivery.capped, true);
    assert.equal(data.delivery.fetched_orders_count, 2);
    assert.equal(data.delivery.delivered_orders_count, 2);
    assert.equal(data.delivery.skipped_cap_orders_count, 1998);
    assert.equal(data.items[2].delivery_source, '超出配额未查');
    assert.equal(data.hints.includes(AFTER_SALES_REPORT.hints.delivery_track_capped), true);
    assert.equal(data.headline.length, 3);
    assert.ok(data.headline[0].includes('已达单次 2000 条上限'));
  });

  it('stops on E_RATE_LIMIT and marks remaining orders as skipped_throttled', async () => {
    const cases = [
      makeRawCase({ id: 1, orderSn: 'SN-OK', createdAt: ts('2026-11-21T15:00:00+08:00') }),
      makeRawCase({ id: 2, orderSn: 'SN-NET', createdAt: ts('2026-11-21T15:00:00+08:00') }),
      makeRawCase({ id: 3, orderSn: 'SN-RL', createdAt: ts('2026-11-21T15:00:00+08:00') }),
      makeRawCase({ id: 4, orderSn: 'SN-AFTER-RL', createdAt: ts('2026-11-21T15:00:00+08:00') }),
    ];
    const { ctx, forwardCalls } = buildCtx(cases, (sn) => {
      if (sn === 'SN-NET') throw new PddCliError({ code: 'E_NETWORK', message: 'net', exitCode: ExitCodes.NETWORK });
      if (sn === 'SN-RL') throw new PddCliError({ code: 'E_RATE_LIMIT', message: 'rl', exitCode: ExitCodes.RATE_LIMIT });
      return createUpstreamForwardTrack({
        orderSn: sn,
        traces: [{ time: '2026-11-20 15:00:00', status: 'SIGN', info: '已签收' }],
      });
    });

    const { data } = await getAfterSalesView(ctx, { days: 30, withDelivery: true });
    assert.deepEqual(forwardCalls, ['SN-OK', 'SN-NET', 'SN-RL']);
    assert.equal(data.delivery.fetched_orders_count, 3);
    assert.equal(data.delivery.delivered_orders_count, 1);
    assert.equal(data.delivery.failed_orders_count, 2);
    assert.equal(data.delivery.skipped_throttled_orders_count, 1);
    assert.equal(
      data.delivery.unique_orders_count,
      data.delivery.fetched_orders_count
        + data.delivery.skipped_cap_orders_count
        + data.delivery.skipped_throttled_orders_count,
    );
    assert.equal(data.items[3].delivery_source, '流控中止未查');
    assert.equal(data.hints.includes(AFTER_SALES_REPORT.hints.delivery_track_rate_limited), true);
    assert.equal(data.hints.includes(AFTER_SALES_REPORT.hints.delivery_track_partial_failed), true);
  });

  it('propagates E_RISK_CONTROL and abort signals in batch delivery enrichment', async () => {
    const { ctx: riskCtx } = buildCtx([makeRawCase({ orderSn: 'SN-RISK' })], () => {
      throw new PddCliError({ code: 'E_RISK_CONTROL', message: 'risk', exitCode: ExitCodes.BUSINESS });
    });
    await assert.rejects(() => getAfterSalesView(riskCtx, { days: 30, withDelivery: true }), { code: 'E_RISK_CONTROL' });

    const controller = new AbortController();
    const cases2 = [
      makeRawCase({ id: 10, orderSn: 'SN-ABORT-1', createdAt: ts('2026-11-21T15:00:00+08:00') }),
      makeRawCase({ id: 11, orderSn: 'SN-ABORT-2', createdAt: ts('2026-11-21T15:00:00+08:00') }),
    ];
    const { ctx: abortCtx } = buildCtx(cases2, (sn) => {
      if (sn === 'SN-ABORT-1') {
        controller.abort();
        return createUpstreamForwardTrack({
          orderSn: sn,
          traces: [{ time: '2026-11-20 15:00:00', status: 'SIGN', info: '已签收' }],
        });
      }
      throw new Error('should not reach SN-ABORT-2');
    });
    abortCtx.signal = controller.signal;
    await assert.rejects(() => getAfterSalesView(abortCtx, { days: 30, withDelivery: true }), { code: 'E_TIMEOUT' });
  });
});
