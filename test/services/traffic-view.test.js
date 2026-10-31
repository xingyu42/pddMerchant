import { it } from 'vitest';
import assert from 'node:assert/strict';
import { toTrafficView, TRAFFIC_ITEM_FIELDS, TRAFFIC_SUMMARY_FIELDS } from '../../src/services/views/traffic.js';
import { toGoodsTrafficItem, toGoodsTrafficView, GOODS_TRAFFIC_ITEM_FIELDS, GOODS_TRAFFIC_PROMO_FIELDS } from '../../src/services/views/goods-traffic.js';

it('projects daily flow, peer metrics, percentages and additive summaries only', () => {
  const view = toTrafficView([{ statDate: '2026-10-30', uv: 10, payOrdrCnt: 2, payOrdrAmt: 1.005,
    payUvRto: 0.12345, uv1dPln: 5, payUvRto1dOst: 0.2, url: 'secret' },
  { statDate: '2026-10-29', uv: 5, payOrdrCnt: 1, payOrdrAmt: 2 }],
  { window: { start_date: '2026-10-29', end_date: '2026-10-30', days: 2 }, mallId: '1' });
  assert.deepEqual(Object.keys(view.items[0]), TRAFFIC_ITEM_FIELDS);
  assert.equal(view.items[1].pay_conversion_pct, 12.35);
  assert.equal(view.items[1].pay_conversion_pct_peer_excellent, 20);
  assert.equal(view.items[1].shop_visitor_count_peer_avg, 5);
  assert.equal(view.items[0].shop_page_view_count, null);
  assert.deepEqual(view.summary, { shop_visitor_count: 15, pay_order_count: 3, pay_amount_yuan: 3.01 });
  assert.ok(view.hints.some((hint) => hint.includes('逐日访客数之和')));
  assert.equal(JSON.stringify(view).includes('secret'), false);
});

it('preserves missing daily summary inputs and projects goods without enrichment leaks', () => {
  const view = toTrafficView([{ statDate: '2026-10-30', uv: 0 }], { window: { days: 1 } });
  assert.equal(view.summary.pay_order_count, null);
  assert.equal(view.summary.shop_visitor_count, 0);
  assert.equal(view.hints.length, 1);
  const item = toGoodsTrafficItem({ goodsId: 101, goodsName: '杯子', goodsVcr: 0.12345, payOrdrAmt: 2.345,
    hdThumbUrl: 'secret', peerPerfUv: 4 }, {});
  assert.deepEqual(Object.keys(item), GOODS_TRAFFIC_ITEM_FIELDS);
  assert.equal(item.goods_id, '101');
  assert.equal(item.pay_conversion_pct, 12.35);
  assert.equal(item.pay_amount_yuan, 2.35);
  assert.equal(item.visitor_count, null);
  assert.equal(item.promo_click_count, null);
  assert.equal(JSON.stringify(item).includes('secret'), false);
});

it('keeps the summary unknown for an empty window and flags fewer stat days than the window', () => {
  const empty = toTrafficView([], { window: { start_date: '2026-10-29', end_date: '2026-10-30', days: 2 } });
  assert.deepEqual(Object.keys(empty.summary), TRAFFIC_SUMMARY_FIELDS);
  assert.deepEqual(empty.summary, { shop_visitor_count: null, pay_order_count: null, pay_amount_yuan: null });
  assert.equal(empty.hints.length, 2);
  assert.ok(empty.hints.some((hint) => hint.includes('少于窗口天数')));
});

it('assembles goods traffic data with promo fen conversion, absent promo as null and labelled hints', () => {
  const promotions = new Map([['101', { directOrderNum: 2, indirectOrderNum: 0, directAmountFen: 246,
    indirectAmountFen: 0, spendFen: 1005, click: 7, nonPromoOrders: 2, nonPromoAmountFen: 1754 }]]);
  const view = toGoodsTrafficView([{ goodsId: 101, payOrdrCnt: 4, payOrdrAmt: 20 }, { goodsId: '102' }], {
    window: { start_date: '2026-10-02', end_date: '2026-10-31', days: 30 }, goodsId: null, total: 2,
    quality: { goods_truncated: false, promo_complete: true }, promotions,
    hints: ['promo_caliber', 'negative_difference', 'negative_difference'], mallId: '1' });
  assert.deepEqual(Object.keys(view), ['headline', 'window', 'filter_goods_id', 'items', 'total', 'data_quality', 'hints', 'mall_id']);
  assert.equal(view.filter_goods_id, null);
  assert.deepEqual(view.items.map((item) => Object.keys(item)), [GOODS_TRAFFIC_ITEM_FIELDS, GOODS_TRAFFIC_ITEM_FIELDS]);
  assert.deepEqual(GOODS_TRAFFIC_PROMO_FIELDS.map((key) => view.items[0][key]), [2, 0, 2.46, 0, 10.05, 7, 2, 17.54]);
  assert.ok(GOODS_TRAFFIC_PROMO_FIELDS.every((key) => view.items[1][key] === null));
  assert.equal(view.hints.length, 2);
  assert.ok(view.hints.every((hint) => typeof hint === 'string' && hint.length > 0));
});
