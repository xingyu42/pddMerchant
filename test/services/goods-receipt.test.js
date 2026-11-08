// 预估实收服务贯通到请求 payload：口径场景值与商品 ID 筛选由 service 参数经 endpoint buildPayload 发出。
import assert from 'node:assert/strict';
import { beforeEach, it, vi } from 'vitest';

const calls = vi.hoisted(() => []);

vi.mock('../../src/adapter/run-endpoint.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runEndpoint: vi.fn(async (_page, spec, params) => {
    calls.push({ name: spec.name, payload: spec.buildPayload(params) });
    return { total: 0, goods: [] };
  }),
}));

const { getGoodsReceiptView } = await import('../../src/services/goods-receipt.js');

const CTX = { page: {}, log: { debug() {} } };

beforeEach(() => {
  calls.length = 0;
});

it('requests the all-discounts scenes 10 and 11 under the all caliber', async () => {
  await getGoodsReceiptView(CTX, { caliber: 'all' });
  await getGoodsReceiptView(CTX, {});
  assert.deepEqual(calls.map((call) => [call.name, call.payload.consult_price_scene_list]),
    [['goodsPrice.list', [10, 11]], ['goodsPrice.list', [7, 8]]]);
});

it('sends the parsed goods ids as goods_id_list', async () => {
  await getGoodsReceiptView(CTX, { goodsIds: ['101', '102', '103'] });
  assert.deepEqual(calls[0].payload.goods_search_condition, { goods_id_list: [101, 102, 103] });
});
