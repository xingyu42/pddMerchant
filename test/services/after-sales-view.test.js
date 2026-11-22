import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import * as views from '../../src/services/views/after-sales.js';

const { toAfterSalesCaseView, toAfterSalesListView } = views;

describe('after-sales views', () => {
  it('projects case data and drops internal and private fields', () => {
    assert.deepEqual(toAfterSalesCaseView({
      id: 123, orderSn: 'SYN-ORDER', goodsName: '样例商品', goodsSpec: 'L', goodsNumber: 2,
      afterSalesType: 2, afterSalesTypeName: '退货退款', afterSalesStatus: 11, afterSalesTitle: '请确认收货',
      sellerAfterSalesShippingStatus: 1, sellerAfterSalesShippingStatusDesc: '平台发货文案',
      afterSalesReasonCode: '88', afterSalesReasonDesc: '不想要了',
      refundAmount: 1778, orderAmount: 1478, receiveAmount: 1778,
      createdAt: 1700000000, closeTime: 1700000060, reverseTrackingNumber: ' SYN-TRACK ',
      thumbUrl: 'SYN-IMAGE', mallRemark: 'SYN-REMARK', uid: 543, returnAddressId: 321, actions: [1],
    }, { 88: '七天无理由退货' }), {
      after_sales_id: '123', order_sn: 'SYN-ORDER', goods_name: '样例商品', spec: 'L', quantity: 2,
      type: '退货退款', status: '待商家收货', status_detail: '请确认收货', shipping_status: '平台发货文案',
      reason_code: 88, reason_desc: '不想要了', reason_category: '七天无理由退货',
      refund_amount_yuan: 17.78, order_amount_yuan: 14.78, receive_amount_yuan: 17.78,
      created_at: '2023-11-15 06:13:20', closed_at: '2023-11-15 06:14:20', reverse_tracking_number: 'SYN-TRACK',
    });
  });

  it('uses case-specific labels and preserves absent or unset fields as null', () => {
    const item = toAfterSalesCaseView({
      afterSalesType: 4, afterSalesStatus: 3, sellerAfterSalesShippingStatus: 0,
      afterSalesReasonCode: 405030, afterSalesReasonDesc: '尺码没选对',
      closeTime: -1, reverseTrackingNumber: '  ',
    }, {});
    assert.equal(item.type, '补寄');
    assert.equal(item.status, '平台处理中');
    assert.equal(item.shipping_status, '未发货');
    assert.equal(item.reason_category, null);
    assert.equal(item.refund_amount_yuan, null);
    assert.equal(item.closed_at, null);
    assert.equal(item.reverse_tracking_number, null);
    assert.equal(toAfterSalesCaseView({ afterSalesStatus: 99, closeTime: 0 }).status, '未知(99)');
    assert.equal(toAfterSalesCaseView({ closeTime: 0 }).closed_at, null);
  });

  it('ranks reasons by count, refund in fen, and description, including unknown reasons', () => {
    const rawItems = [
      { afterSalesReasonDesc: '同文案', afterSalesReasonCode: 88, refundAmount: 1 },
      { afterSalesReasonDesc: '同文案', afterSalesReasonCode: 66, refundAmount: '2' },
      { afterSalesReasonDesc: '同文案', afterSalesReasonCode: 405030, refundAmount: Infinity },
      { afterSalesReasonDesc: 'B', refundAmount: 1000 },
      { afterSalesReasonDesc: 'A', refundAmount: 1000 },
      { afterSalesReasonCode: 93, refundAmount: 0 },
      {},
    ];
    const data = toAfterSalesListView({
      rawItems, total: 7, reasonCategoryMap: { 88: '七天无理由退货', 66: '七天无理由退货' },
      window: { startTime: 1700000000, endTime: 1700086400, days: 1 },
    });
    assert.deepEqual(data.reason_summary, [
      { reason_desc: '同文案', reason_category: null, count: 3, share_pct: 42.86, refund_amount_yuan: 0.03 },
      { reason_desc: 'A', reason_category: null, count: 1, share_pct: 14.29, refund_amount_yuan: 10 },
      { reason_desc: 'B', reason_category: null, count: 1, share_pct: 14.29, refund_amount_yuan: 10 },
      { reason_desc: '未知(93)', reason_category: null, count: 1, share_pct: 14.29, refund_amount_yuan: 0 },
      { reason_desc: '未知', reason_category: null, count: 1, share_pct: 14.29, refund_amount_yuan: null },
    ]);
    assert.match(data.headline[0], /近 1 天售后单 7 条，已采集 7 条/);
    assert.match(data.headline[1], /同文案 3 条（42.86%）、A 1 条（14.29%）、B 1 条（14.29%）/);
  });
});
