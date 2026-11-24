import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  DELIVERY_CALIBER,
  TRACE_NODE_FIELDS,
  buildTraceSummary,
  classifyTraceStatus,
  diffDays,
  extractForwardMilestones,
  extractReverseMilestones,
  isAfterSalesCaseShipped,
  parseShanghaiDateTimeToSeconds,
  toOrderDetailTrackView,
} from '../../src/services/views/logistics.js';

const DELIVERED_FORWARD_TRACK = {
  available: true,
  waybills: [{ shippingId: 85, shippingName: '圆通快递', trackingNumber: 'YT3' }],
  traces: [{ time: '2026-11-20 15:00:00', status: 'SIGN', info: '已签收' }],
};

describe('logistics views and trace helpers', () => {
  it('parses Shanghai datetimes and Unix timestamps accurately', () => {
    const sec = parseShanghaiDateTimeToSeconds('2026-11-20 15:00:00');
    assert.equal(sec, Math.floor(Date.parse('2026-11-20T15:00:00+08:00') / 1000));
    assert.equal(parseShanghaiDateTimeToSeconds(sec * 1000), sec);
    assert.equal(parseShanghaiDateTimeToSeconds('2026-02-31 12:00:00'), null);
    assert.equal(parseShanghaiDateTimeToSeconds(0), null);
    assert.equal(diffDays(sec, sec + 86400 * 1.5), 1.5);
    assert.equal(diffDays(sec + 100, sec), null);
  });

  it('classifies consolidation outbound, merchant ship notice, and blank-status nodes accurately', () => {
    assert.equal(classifyTraceStatus({ status: 'IN_CABINET', info: '' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: 'SEND', info: '' }), 'DISPATCH');
    assert.equal(classifyTraceStatus({ status: '', subStatus: 'IN_CABINET_401', info: '' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', subStatus: 'OUT_CABINET_501', info: '' }), 'OUT_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '快件已由驿站代收，请凭取件码取件' }), 'SIGN_ON_BEHALF');
    assert.equal(classifyTraceStatus({ status: '', info: '快件已存入丰巢快递柜，等待取件' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '快件已投递至丰巢快递柜' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '已投递到菜鸟驿站' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '已投递 到菜鸟驿站' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '已投递到菜鸟驿站，驿站代收' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '已投递到前台' }), 'SIGN');
    assert.equal(classifyTraceStatus({ status: '', info: '快件已投递，签收人：王五' }), 'SIGN');
    assert.equal(classifyTraceStatus({ status: '', info: '快递员已揽收' }), 'GOT');
    assert.equal(classifyTraceStatus({ status: '', info: '【某网点】的专员已取件' }), 'GOT');
    assert.equal(classifyTraceStatus({ status: '', info: '快件已取件，感谢使用' }), 'OUT_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '已签收，感谢使用' }), 'SIGN');
    assert.equal(classifyTraceStatus({ status: '', info: '快件已领取' }), 'OUT_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '包裹已出库，装车发往目的地' }), 'OUTBOUND');
    assert.equal(classifyTraceStatus({ status: 'OUT_CABINET', info: '包裹已出库，已装车发往新疆' }), 'OUTBOUND');
    assert.equal(classifyTraceStatus({ status: 'IN_CABINET', info: '包裹已入库，存入丰巢快递柜' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '包裹已入库，存入丰巢快递柜' }), 'IN_CABINET');
    assert.equal(classifyTraceStatus({ status: '', info: '到达圆通中转仓，包裹已入库' }), 'INBOUND');
    assert.equal(classifyTraceStatus({ status: 'SIGN', info: '您的快件已由某人送达圆通中转仓代保管' }), 'INBOUND');
    assert.equal(classifyTraceStatus({ status: 'OTHER', info: '商家已发货，正在通知圆通快递取件' }), 'MERCHANT_SHIPPED');
    assert.equal(classifyTraceStatus({ status: '', info: '商家已发货，正在通知圆通快递取件' }), 'MERCHANT_SHIPPED');
    assert.equal(classifyTraceStatus({ status: '张三13812345678', info: '' }), 'OTHER');
  });

  it('returns closed fixed summaries without leaking names, phones, addresses, URLs, pickup codes, or hotlines', () => {
    const samples = [
      '已签收，张三代收，派件员李四 13812345678，如有疑问请联系95554或010-87654321',
      '已由李四签收，请凭提货密码889900取件',
      '快件已存入北京市朝阳区阳光小区3号楼2单元丰巢快递柜，取件码889900，运单9876543210，见 https://evil.test/x',
      '送达[自提点],取件地址:某绿洲西门9号柜G22,官方客服956025，派送热线952300',
      '请联系驿站确认取件码为956025',
    ];
    for (const _rawInfo of samples) {
      assert.equal(buildTraceSummary('SIGN'), '快件已签收');
      assert.equal(buildTraceSummary('IN_CABINET'), '快件已存入快递柜或驿站待取');
    }
    assert.equal(buildTraceSummary('CUSTOM_UNKNOWN_CODE'), '物流节点更新');
  });

  it('strictly requires shipping_status to be 已发货 for isAfterSalesCaseShipped', () => {
    assert.equal(isAfterSalesCaseShipped({ sellerAfterSalesShippingStatus: 1, sellerAfterSalesShippingStatusDesc: '已发货' }), true);
    assert.equal(isAfterSalesCaseShipped({ sellerAfterSalesShippingStatus: 1 }), true);
    assert.equal(isAfterSalesCaseShipped({ sellerAfterSalesShippingStatus: '1' }), true);
    assert.equal(isAfterSalesCaseShipped({ sellerAfterSalesShippingStatus: '01' }), false);
    assert.equal(isAfterSalesCaseShipped({ sellerAfterSalesShippingStatus: 0, reverseTrackingNumber: 'TN-1' }), false);
    assert.equal(isAfterSalesCaseShipped({ reverseTrackingNumber: 'TN-ONLY' }), false);
    assert.equal(isAfterSalesCaseShipped({ sellerAfterSalesShippingStatusDesc: '未发货', sellerAfterSalesShippingStatus: 1 }), false);
  });

  it('uses the earliest cabinet drop-off and keeps signing time and projected node fields', () => {
    const cabinetFirst = extractForwardMilestones({
      available: true,
      waybills: [{ shippingId: 85, shippingName: '中通快递', trackingNumber: 'TN1' }],
      traces: [
        { time: '2026-11-20 18:00:00', status: 'SIGN', info: '已签收' },
        { time: '2026-11-20 16:00:00', status: 'IN_CABINET', info: '已存入驿站' },
        { time: '2026-11-20 15:00:00', status: 'IN_CABINET', info: '已存入快递柜' },
        { time: '2026-11-18 15:00:00', status: 'GOT', info: '已揽收' },
      ],
    });
    assert.equal(cabinetFirst.shipping_id, '85');
    assert.equal(cabinetFirst.delivery_event, 'IN_CABINET');
    assert.equal(cabinetFirst.has_carrier_progress, true);
    assert.equal(cabinetFirst.delivered_at_sec, parseShanghaiDateTimeToSeconds('2026-11-20 15:00:00'));
    assert.equal(cabinetFirst.signed_at_sec, parseShanghaiDateTimeToSeconds('2026-11-20 18:00:00'));
    assert.deepEqual(Object.keys(cabinetFirst.traces[0]), [...TRACE_NODE_FIELDS]);
    assert.equal(cabinetFirst.traces[0].status, '已揽收');
  });

  it('measures from the initial pickup through final delivery across consolidation legs', () => {
    const consolidated = extractForwardMilestones({
      available: true,
      waybills: [{ shippingId: 384, shippingName: '极兔速递', trackingNumber: 'JT-2' }],
      traces: [
        { time: '2026-11-14 20:00:00', status: 'GOT', info: '第一段揽收' },
        { time: '2026-11-16 04:00:00', status: 'SIGN', info: '送达圆通中转仓代保管' },
        { time: '2026-11-16 12:00:00', status: 'INBOUND', info: '包裹已入库' },
        { time: '2026-11-17 14:00:00', status: 'UNPACKING', info: '包裹正在合包' },
        { time: '2026-11-18 14:00:00', status: '', info: '包裹已出库，装车发往目的地' },
        { time: '2026-11-18 14:05:00', status: 'GOT', info: '第二段已取件' },
        { time: '2026-11-21 12:00:00', status: 'IN_CABINET', info: '送达驿站' },
        { time: '2026-11-23 14:00:00', status: 'OUT_CABINET', info: '买家已取件签收' },
      ],
    });
    assert.equal(consolidated.got_at_sec, parseShanghaiDateTimeToSeconds('2026-11-14 20:00:00'));
    assert.equal(consolidated.in_cabinet_at_sec, parseShanghaiDateTimeToSeconds('2026-11-21 12:00:00'));
    assert.equal(consolidated.signed_at_sec, parseShanghaiDateTimeToSeconds('2026-11-23 14:00:00'));
    assert.equal(consolidated.delivered_at_sec, parseShanghaiDateTimeToSeconds('2026-11-21 12:00:00'));
    assert.equal(consolidated.traces[2].status, '中转入库');
    assert.equal(consolidated.traces[4].status, '中转出库');
  });

  it('clears delivery times once a new leg starts without final delivery', () => {
    const outboundOnlyLeg2 = extractForwardMilestones({
      available: true,
      waybills: [{ shippingId: 384, shippingName: '极兔速递', trackingNumber: 'JT-3' }],
      traces: [
        { time: '2026-11-14 20:00:00', status: 'GOT', info: '第一段揽收' },
        { time: '2026-11-16 04:00:00', status: 'SIGN', info: '送达中转仓' },
        { time: '2026-11-16 12:00:00', status: 'INBOUND', info: '包裹已入库' },
        { time: '2026-11-18 14:00:00', status: '', info: '包裹已出库，装车发往目的地' },
      ],
    });
    assert.equal(outboundOnlyLeg2.delivered_at_sec, null);
    assert.equal(outboundOnlyLeg2.signed_at_sec, null);
  });

  it('uses the first reverse signing event if there is no cabinet drop-off', () => {
    const signOnly = extractReverseMilestones({
      available: true,
      shippingId: 85,
      shippingName: '中通快递',
      trackingNumber: 'TN2',
      traces: [
        { time: '2026-11-22 10:00:00', status: '', info: '已代收' },
        { time: '2026-11-23 12:00:00', status: 'SIGN', info: '已签收' },
      ],
    });
    assert.equal(signOnly.shipping_id, '85');
    assert.equal(signOnly.delivery_event, 'SIGN_ON_BEHALF');
  });

  it('shows a distinct forward headline when no track is available', () => {
    const emptyView = toOrderDetailTrackView({
      forwardTrack: { available: false, waybills: [], traces: [] },
      cases: [],
    });
    assert.equal(emptyView.track.delivery_caliber, DELIVERY_CALIBER);
    assert.equal(emptyView.track.forward.delivered_at, null);
    assert.equal(emptyView.forwardClause, '正向物流暂无可用轨迹');
  });

  it.each([
    ['no nodes', []],
    ['other node', [{ status: 'OTHER', info: '物流节点更新' }]],
    ['merchant ship notice', [{ status: 'OTHER', info: '商家已发货，正在通知圆通快递取件' }]],
  ])('keeps pickup time fallback without counting carrier progress for %s', (_label, traces) => {
    const view = toOrderDetailTrackView({
      forwardTrack: {
        available: true,
        waybills: [{ shippingId: 85, shippingName: '圆通快递', trackingNumber: 'YT1' }],
        wideGotTime: '2026-11-14 16:29:02',
        traces,
      },
    });
    assert.equal(view.track.forward.got_at, '2026-11-14 16:29:02');
    assert.equal(view.forwardClause, '正向物流暂无承运商轨迹');
  });

  it('uses pickup time fallback to calculate transit days when there is a delivery node', () => {
    const view = toOrderDetailTrackView({
      forwardTrack: { ...DELIVERED_FORWARD_TRACK, wideGotTime: '2026-11-18 15:00:00' },
    });
    assert.equal(view.track.forward.transit_days, 2);
  });

  it('uses a safe label and summary for unknown raw status codes', () => {
    const unknownStatusMilestones = extractForwardMilestones({
      available: true,
      waybills: [{ shippingId: 85, shippingName: '圆通快递', trackingNumber: 'YT2' }],
      traces: [
        { time: '2026-11-15 10:00:00', status: '张三13812345678', info: '不可解析文本' },
        { time: '2026-11-15 11:00:00', status: 'CUSTOM_LEAK_XYZ', info: '不可解析文本' },
      ],
    });
    assert.equal(unknownStatusMilestones.traces[0].status, '其他节点');
    assert.equal(unknownStatusMilestones.traces[0].summary, '物流节点更新');
    assert.equal(unknownStatusMilestones.traces[1].status, '其他节点');
    assert.equal(unknownStatusMilestones.traces[1].summary, '物流节点更新');
  });

  it('omits the return timing clause when the latest case is incomplete', () => {
    const latestIncompleteReturnView = toOrderDetailTrackView({
      forwardTrack: DELIVERED_FORWARD_TRACK,
      cases: [
        {
          rawCase: { id: 2, orderSn: 'SYN-MULTI', createdAt: null },
          caseView: { after_sales_id: '2' },
          reverseTrack: { available: false, traces: [] },
        },
        {
          rawCase: { id: 1, orderSn: 'SYN-MULTI', createdAt: parseShanghaiDateTimeToSeconds('2026-11-21 15:00:00') },
          caseView: { after_sales_id: '1' },
          reverseTrack: {
            available: true,
            shippingId: 85,
            trackingNumber: 'REV-1',
            traces: [{ time: '2026-11-22 15:00:00', status: 'SIGN', info: '已签收' }],
          },
        },
      ],
    });
    assert.equal(latestIncompleteReturnView.returnTimingClause, null);
  });

  it.each([
    ['IN_CABINET', '包裹已入库，存入丰巢快递柜'],
    ['', '已投递到菜鸟驿站'],
  ])('shows reverse arrival at lockers or stations: %s %s', (status, info) => {
    const reverseTrack = {
      available: true,
      shippingId: 85,
      trackingNumber: 'REV-CAB',
      traces: [{ time: '2026-11-22 15:00:00', status, info }],
    };
    const rawCase = { id: 3, orderSn: 'SYN-CAB', createdAt: parseShanghaiDateTimeToSeconds('2026-11-21 15:00:00') };
    const view = toOrderDetailTrackView({
      forwardTrack: DELIVERED_FORWARD_TRACK,
      cases: [{ rawCase, reverseTrack: { available: false }, reverseMilestones: extractReverseMilestones(reverseTrack) }],
    });
    assert.equal(view.track.returns[0].return_delivery_event, '已入柜/驿站待取');
    assert.equal(view.returnTimingClause, '收货至发起售后 1 天，收货至退回到达 2 天');
  });
});
