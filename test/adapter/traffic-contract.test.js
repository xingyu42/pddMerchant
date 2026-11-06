import { it } from 'vitest';
import assert from 'node:assert/strict';
import { TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW, GOODS_TRAFFIC_LIST } from '../../src/adapter/endpoints/traffic.js';
import { GOODS_PROMOTION_LIST } from '../../src/adapter/endpoints/promo-goods.js';

it('uses page-api with explicit navigation and exact plain goods payload', () => {
  for (const spec of [TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW, GOODS_TRAFFIC_LIST]) {
    assert.equal(spec.strategy, 'page-api');
    assert.ok(spec.nav.url);
    assert.equal(spec.isSuccess({ success: true, errorCode: 1000000 }), true);
    assert.equal(spec.isSuccess({ success: true, errorCode: 0 }), true);
    assert.equal(spec.isSuccess({ success: false, errorCode: 0 }), false);
    assert.equal(spec.isSuccess({ success: true, errorCode: 1 }), false);
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
