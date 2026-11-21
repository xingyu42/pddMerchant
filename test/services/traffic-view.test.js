import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { toTrafficView, TRAFFIC_ITEM_FIELDS, TRAFFIC_SUMMARY_FIELDS, TRAFFIC_TODAY_FIELDS,
  TRAFFIC_TODAY_HOURLY_FIELDS } from '../../src/services/views/traffic.js';
import { toGoodsTrafficItem, toGoodsTrafficView, GOODS_TRAFFIC_ITEM_FIELDS, GOODS_TRAFFIC_PROMO_FIELDS,
  GOODS_TRAFFIC_TODAY_OVERVIEW_FIELDS, GOODS_TRAFFIC_TODAY_SINGLE_FIELDS,
  GOODS_TRAFFIC_TODAY_HOURLY_FIELDS } from '../../src/services/views/goods-traffic.js';

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
  assert.deepEqual(Object.keys(view), ['headline', 'window', 'filter_goods_id', 'items', 'total', 'today', 'data_quality', 'hints', 'mall_id']);
  assert.equal(view.filter_goods_id, null);
  assert.equal(view.today, null);
  assert.equal(view.headline.length, 1);
  assert.deepEqual(view.items.map((item) => Object.keys(item)), [GOODS_TRAFFIC_ITEM_FIELDS, GOODS_TRAFFIC_ITEM_FIELDS]);
  assert.deepEqual(GOODS_TRAFFIC_PROMO_FIELDS.map((key) => view.items[0][key]), [2, 0, 2.46, 0, 10.05, 7, 2, 17.54]);
  assert.ok(GOODS_TRAFFIC_PROMO_FIELDS.every((key) => view.items[1][key] === null));
  assert.equal(view.hints.length, 2);
  assert.ok(view.hints.every((hint) => typeof hint === 'string' && hint.length > 0));
});

describe('today block projection', () => {
  const window = { start_date: '2026-10-29', end_date: '2026-10-30', days: 2 };
  const rows = [{ statDate: '2026-10-29' }, { statDate: '2026-10-30' }];
  const today = (trade, flow = { muvRt: 377, mpvRt: 912, guvRt: 350, gpvRt: 801 }) =>
    ({ snapshotAt: '2026-11-11 19:30:00', sources: { flow, trade } });

  it('takes trade fields from the latest cumulative hour and keeps flow realtime values separate', () => {
    const view = toTrafficView(rows, { window, today: today([
      { hr: '18', payOrdrAmt: 745.364, payOrdrCnt: 39, payOrdrUsrCnt: 37, payOrdrAup: 19.11, payUvRto: 0.0955 },
      { hr: '09', payOrdrAmt: 100, payOrdrCnt: 5, payOrdrUsrCnt: 5 },
    ]) });
    assert.deepEqual(Object.keys(view.today), TRAFFIC_TODAY_FIELDS);
    const { hourly, ...latest } = view.today;
    assert.deepEqual(latest, { snapshot_at: '2026-11-11 19:30:00', as_of_hour: '18',
      shop_visitor_count: 377, shop_page_view_count: 912, goods_visitor_count: 350, goods_page_view_count: 801,
      pay_amount_yuan: 745.36, pay_order_count: 39, pay_buyer_count: 37, avg_order_value_yuan: 19.11,
      pay_conversion_pct: 9.55 });
    assert.deepEqual(hourly, [
      { hour: '09', pay_amount_yuan: 100, pay_order_count: 5, pay_buyer_count: 5 },
      { hour: '18', pay_amount_yuan: 745.36, pay_order_count: 39, pay_buyer_count: 37 },
    ]);
    for (const hour of hourly) assert.deepEqual(Object.keys(hour), TRAFFIC_TODAY_HOURLY_FIELDS);
    assert.equal(view.headline[1], '今日截至 18 时累计成交 745.36 元、39 单，店铺访客 377 人');
  });

  it('reports null trade fields and an empty hourly list before the first cumulative row', () => {
    const view = toTrafficView(rows, { window, today: today([], {}) });
    assert.equal(view.today.as_of_hour, null);
    assert.equal(view.today.pay_amount_yuan, null);
    assert.equal(view.today.shop_visitor_count, null);
    assert.deepEqual(view.today.hourly, []);
    assert.equal(view.headline[1], '今日暂无成交累计数据，店铺访客 未知');
  });

  it('keeps today null without a headline line when collection degraded', () => {
    const view = toTrafficView(rows, { window, today: null, hints: ['today_unavailable'] });
    assert.equal(view.today, null);
    assert.equal(view.headline.length, 1);
    assert.ok(view.hints.some((hint) => hint.includes('今日实时数据拉取失败')));
  });
});

describe('goods traffic today view projection', () => {
  const window = { start_date: '2026-10-02', end_date: '2026-10-31', days: 30 };
  const baseArgs = (today, warnings = []) => ({
    window, total: 1, quality: { goods_truncated: false, promo_complete: true },
    promotions: new Map(), hints: [], mallId: '1', today, warnings,
  });

  it('parses formatted comma and percent strings into overview v2 metrics without warnings', () => {
    const warnings = [];
    const view = toGoodsTrafficView([{ goodsId: 101 }], {
      ...baseArgs({ snapshotAt: '2026-11-22 10:00:00', sources: { kind: 'overview', overview: {
        guvRt: '1,234', gpvRt: '2,500', vstGoodsCntRt: '12',
        payOrdrCntRt: '39', payOrdrAmtRt: '1,203.645', payUvRtoRt: '9.55%',
      } } }, warnings),
    });
    assert.deepEqual(Object.keys(view.today), GOODS_TRAFFIC_TODAY_OVERVIEW_FIELDS);
    assert.deepEqual(view.today, {
      snapshot_at: '2026-11-22 10:00:00', goods_visitor_count: 1234, goods_page_view_count: 2500,
      visited_goods_count: 12, pay_order_count: 39, pay_amount_yuan: 1203.65, pay_conversion_pct: 9.55,
    });
    assert.deepEqual(warnings, []);
    assert.equal(view.headline[1], '今日全店商品访客 1234 人，有访问商品 12 个，成交 1203.65 元、39 单');
  });

  it('treats explicit null silently while warning on unparseable formatted values', () => {
    const warnings = [];
    const view = toGoodsTrafficView([{ goodsId: 101 }], {
      ...baseArgs({ snapshotAt: '2026-11-22 04:20:00', sources: { kind: 'overview', overview: {
        guvRt: '0', gpvRt: '--', vstGoodsCntRt: '1,23',
        payOrdrCntRt: '', payOrdrAmtRt: '9.55', payUvRtoRt: null,
      } } }, warnings),
    });
    assert.equal(view.today.goods_visitor_count, 0);
    assert.equal(view.today.goods_page_view_count, null);
    assert.equal(view.today.visited_goods_count, null);
    assert.equal(view.today.pay_order_count, null);
    assert.equal(view.today.pay_amount_yuan, 9.55);
    assert.equal(view.today.pay_conversion_pct, null);
    assert.deepEqual(warnings.map((w) => w.field), ['goods_page_view_count', 'visited_goods_count', 'pay_order_count']);

    const badPctWarnings = [];
    const badPct = toGoodsTrafficView([{ goodsId: 101 }], {
      ...baseArgs({ snapshotAt: '2026-11-22 04:20:00', sources: { kind: 'overview', overview: {
        guvRt: '0', gpvRt: '0', vstGoodsCntRt: '0',
        payOrdrCntRt: '0', payOrdrAmtRt: '0', payUvRtoRt: '9.55',
      } } }, badPctWarnings),
    });
    assert.equal(badPct.today.pay_conversion_pct, null);
    assert.equal(badPctWarnings.length, 1);
    assert.equal(badPctWarnings[0].field, 'pay_conversion_pct');
  });

  it('projects single goods today summary, ascending hourly list, empty hours and degradation', () => {
    const view = toGoodsTrafficView([{ goodsId: 101 }], {
      ...baseArgs({ snapshotAt: '2026-11-22 10:00:00', sources: { kind: 'single', stat: {
        detail: { goodsUv: 350, goodsPv: 801, goodsFavCnt: 14, imprUsrCnt: 1200, ordrVstrRto: 0.12,
          goodsVcr: 0.1057, payOrdrRto: 0.85, payOrdrCnt: 39, payOrdrGoodsQty: 42, payOrdrUsrCnt: 37,
          payOrdrAmt: 745.364, cnsltUsrQty: 6 },
        hourly: [
          { statHr: '02', goodsUv: 120, payOrdrCnt: 10, payOrdrAmt: 200.5, goodsVcr: 0.0833 },
          { statHr: '00', goodsUv: 15, payOrdrCnt: null, payOrdrAmt: null, goodsVcr: null },
        ],
      } } }),
      goodsId: '101',
    });
    assert.deepEqual(Object.keys(view.today), GOODS_TRAFFIC_TODAY_SINGLE_FIELDS);
    assert.equal(view.today.as_of_hour, '02');
    assert.equal(view.today.pay_amount_yuan, 745.36);
    assert.equal(view.today.pay_conversion_pct, 10.57);
    assert.deepEqual(view.today.hourly.map((row) => row.hour), ['00', '02']);
    assert.deepEqual(Object.keys(view.today.hourly[0]), GOODS_TRAFFIC_TODAY_HOURLY_FIELDS);
    assert.equal(view.today.hourly[0].pay_amount_yuan, null);
    assert.equal(view.headline[1], '商品 101 今日截至 02 时累计访客 350 人，成交 745.36 元、39 单');

    const empty = toGoodsTrafficView([{ goodsId: 101 }], {
      ...baseArgs({ snapshotAt: '2026-11-22 04:20:00', sources: { kind: 'single', stat: { detail: null, hourly: [] } } }),
      goodsId: '101',
    });
    assert.equal(empty.today.as_of_hour, null);
    assert.deepEqual(empty.today.hourly, []);
    assert.equal(empty.today.visitor_count, null);
    assert.equal(empty.headline[1], '商品 101 今日暂无小时累计数据，访客 未知');

    const degraded = toGoodsTrafficView([{ goodsId: 101 }], {
      ...baseArgs(null), goodsId: '101', hints: ['today_unavailable'],
    });
    assert.equal(degraded.today, null);
    assert.equal(degraded.headline.length, 1);
    assert.ok(degraded.hints.some((hint) => hint.includes('今日实时数据拉取失败')));
  });
});
