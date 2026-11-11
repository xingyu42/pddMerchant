import { it } from 'vitest';
import assert from 'node:assert/strict';
import { TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW, GOODS_TRAFFIC_LIST, TRAFFIC_TODAY_FLOW,
  TRAFFIC_TODAY_TRADE } from '../../src/adapter/endpoints/traffic.js';
import { GOODS_PROMOTION_LIST } from '../../src/adapter/endpoints/promo-goods.js';
import { createTrafficFixtures } from '../fixtures/test-data.js';

it('uses page-api with explicit navigation and exact plain goods payload', () => {
  for (const spec of [TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW, GOODS_TRAFFIC_LIST]) {
    assert.equal(spec.strategy, 'page-api');
    assert.ok(spec.nav.url);
  }
  assert.deepEqual(GOODS_TRAFFIC_LIST.buildPayload({ startDate: '2026-10-01', endDate: '2026-10-30', queryType: 2, page: 2, goodsId: '101' }),
    { startDate: '2026-10-01', endDate: '2026-10-30', queryType: 2, pageNum: 2, pageSize: 50, sortCol: 0, sortType: 1, goodsId: '101' });
  assert.equal(TRAFFIC_READY_TIME.normalize({ result: '2026-10-30' }), '2026-10-30');
  assert.throws(() => TRAFFIC_READY_TIME.normalize({ result: '2026-02-30' }), { code: 'E_NETWORK' });
});

it('rejects shape drift and obfuscated numeric fields, projects out URLs', () => {
  assert.throws(() => GOODS_TRAFFIC_LIST.normalize({ result: {} }), { code: 'E_NETWORK' });
  assert.throws(() => GOODS_TRAFFIC_LIST.normalize({ result: { totalNum: 1, goodsDetailList: [{ goodsId: 1, goodsUv: '\ue001' }] } }), { code: 'E_BUSINESS' });
  const result = GOODS_TRAFFIC_LIST.normalize({ result: { totalNum: 1, goodsDetailList: [{ goodsId: 1, goodsUv: 0, hdThumbUrl: 'secret' }] } });
  assert.deepEqual(result, { total: 1, items: [{ goodsId: 1, goodsUv: 0 }] });
  assert.throws(() => TRAFFIC_OVERVIEW.normalize({ result: null }), { code: 'E_NETWORK' });
});

it('guards every numeric field against obfuscated glyphs but keeps free text untouched', () => {
  assert.throws(() => TRAFFIC_OVERVIEW.normalize({ result: [{ statDate: '2026-10-30', uv: '1\uE123' }] }), { code: 'E_BUSINESS' });
  assert.throws(() => TRAFFIC_OVERVIEW.normalize({ result: [{ statDate: '2026-10-30', payUvRto1dOst: '\uE010' }] }),
    { code: 'E_BUSINESS' });
  assert.throws(() => GOODS_TRAFFIC_LIST.normalize({ result: { totalNum: 1, goodsDetailList: [{ goodsId: '\uE001' }] } }),
    { code: 'E_BUSINESS' });
  const result = GOODS_TRAFFIC_LIST.normalize({ result: { totalNum: 1,
    goodsDetailList: [{ goodsId: '101', goodsName: '杯子\uE000', cate3Name: '类目\uF8FF', goodsUv: '12' }] } });
  assert.deepEqual(result.items, [{ goodsId: '101', goodsName: '杯子\uE000', cate3Name: '类目\uF8FF', goodsUv: '12' }]);
});

it.each([undefined, '2026-02-30', '2026-10-3', null])('rejects missing or invalid daily statDate %s', (statDate) => {
  assert.throws(() => TRAFFIC_OVERVIEW.normalize({ result: [{ statDate, uv: 10 }] }), { code: 'E_NETWORK' });
});

it('reads realtime flow from the traffic board with an empty body and projects only the four counters', () => {
  assert.equal(TRAFFIC_TODAY_FLOW.strategy, 'page-api');
  assert.equal(TRAFFIC_TODAY_FLOW.nav.url, TRAFFIC_OVERVIEW.nav.url);
  assert.equal(TRAFFIC_TODAY_FLOW.apiUrl, '/sydney/api/mallFlow/queryMallFlowRtData');
  assert.deepEqual(TRAFFIC_TODAY_FLOW.buildPayload({}), {});
  const fixture = createTrafficFixtures()['endpoints/traffic.todayFlow.json'];
  assert.deepEqual(TRAFFIC_TODAY_FLOW.normalize({ ...fixture, result: { ...fixture.result, extra: 'secret' } }),
    { muvRt: 377, mpvRt: 912, guvRt: 350, gpvRt: 801 });
  assert.throws(() => TRAFFIC_TODAY_FLOW.normalize({ result: null }), { code: 'E_NETWORK' });
  assert.throws(() => TRAFFIC_TODAY_FLOW.normalize({ result: { muvRt: '' } }), { code: 'E_BUSINESS' });
});

it('queries cumulative trade for the given day and projects todayRtList rows only', () => {
  assert.equal(TRAFFIC_TODAY_TRADE.strategy, 'page-api');
  assert.equal(TRAFFIC_TODAY_TRADE.nav.url, TRAFFIC_OVERVIEW.nav.url);
  assert.equal(TRAFFIC_TODAY_TRADE.apiUrl, '/sydney/api/mallTrade/queryMallTradeList');
  assert.deepEqual(TRAFFIC_TODAY_TRADE.buildPayload({ queryDate: '2026-11-11' }), { queryType: 6, queryDate: '2026-11-11' });
  const rows = TRAFFIC_TODAY_TRADE.normalize(createTrafficFixtures()['endpoints/traffic.todayTrade.json']);
  assert.deepEqual(rows, [
    { hr: '00', payOrdrAmt: 12.5, payOrdrCnt: 1, payOrdrUsrCnt: 1, payOrdrAup: 12.5, payUvRto: 0.0125 },
    { hr: '01', payOrdrAmt: 745.364, payOrdrCnt: 39, payOrdrUsrCnt: 36, payOrdrAup: 19.112, payUvRto: 0.09549 },
  ]);
  assert.deepEqual(TRAFFIC_TODAY_TRADE.normalize({ result: { todayRtList: null } }), []);
  assert.deepEqual(TRAFFIC_TODAY_TRADE.normalize({ result: {} }), []);
});

it.each([
  [{ result: null }, 'E_NETWORK'], [{ result: { todayRtList: {} } }, 'E_NETWORK'],
  [{ result: { todayRtList: [{ hr: '24' }] } }, 'E_NETWORK'], [{ result: { todayRtList: [{ hr: 1 }] } }, 'E_NETWORK'],
  [{ result: { todayRtList: [{ hr: '01', payOrdrCnt: '' }] } }, 'E_BUSINESS'],
])('rejects trade shape drift %j', (raw, code) => {
  assert.throws(() => TRAFFIC_TODAY_TRADE.normalize(raw), { code });
});

it('flattens venus reports in order and converts bare li and object yuan to integer fen', () => {
  const result = GOODS_PROMOTION_LIST.normalize({ result: { adInfos: [{ goodsId: 1, goodsName: 'secret',
    optimizationMessage: { directOrderNum: 1 }, reportInfo: { directGmv: 12340, clickCount: 4 },
    reportInfo2: { directOrderNum: 2, indirectPayGmv: { value: 456, unit: 'PERCENT', unitCode: 100 },
      orderMarketingSpend: { value: 1.23 }, indirectOrderNum: 0 } }] } });
  assert.deepEqual(result.items, [{ goodsId: '1', click: 4, directOrderNum: 2, indirectOrderNum: 0,
    directAmountFen: 1234, indirectAmountFen: 456, spendFen: 123 }]);
  assert.deepEqual(GOODS_PROMOTION_LIST.normalize({ result: { adInfos: null, totalAdNum: 0 } }), { items: [], unknownUnits: [] });
  assert.throws(() => GOODS_PROMOTION_LIST.normalize({ result: { adInfos: null } }), { code: 'E_NETWORK' });
  assert.throws(() => GOODS_PROMOTION_LIST.normalize({ result: { adInfos: [{}] } }), { code: 'E_NETWORK' });
});

it('converts money objects by unit like promo MoneyVO and reports unknown units as null', () => {
  const result = GOODS_PROMOTION_LIST.normalize({ result: { adInfos: [{ goodsId: '101',
    directGmv: { value: 1.5, unit: 'YUAN' }, indirectGmv: { value: 250, unit: 'fen' },
    spend: { value: 3, unit: 'WAN' } }, { goodsId: '102', spend: { value: 1, unit: 'WAN' } }] } });
  assert.equal(result.items[0].directAmountFen, 150);
  assert.equal(result.items[0].indirectAmountFen, 250);
  assert.equal(result.items[0].spendFen, null);
  assert.deepEqual(result.unknownUnits, ['WAN']);
});

it('treats empty aliases as missing while retaining explicit zero', () => {
  const result = GOODS_PROMOTION_LIST.normalize({ result: { adInfos: [{ goodsId: '101', click: '', clickCount: 0,
    directGmv: '', directPayGmv: 0, spend: null, orderMarketingSpend: 1000 }] } });
  assert.equal(result.items[0].click, 0);
  assert.equal(result.items[0].directAmountFen, 0);
  assert.equal(result.items[0].spendFen, 100);
  assert.equal(result.items[0].indirectAmountFen, null);
  assert.deepEqual(GOODS_PROMOTION_LIST.buildPayload({ page: 2, scenesMode: 3, goodsIds: ['101', '102'], beginDate: 'a', endDate: 'b' }),
    { beginDate: 'a', endDate: 'b', blockType: 3, clientType: 1, pageNumber: 2, pageSize: 50,
      filter: { searchKeyV2: '101,102' }, sortBy: 9999, orderBy: 9999, scenesMode: 3, withTagsInfo: true });
});
