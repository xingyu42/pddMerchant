// 预估实收服务贯通到请求 payload：口径场景值与商品 ID 筛选由 service 参数经 endpoint buildPayload 发出。
import assert from 'node:assert/strict';
import { beforeEach, it } from 'vitest';
import { getGoodsReceiptView } from '../../src/services/goods-receipt.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

let transport;
let ctx;

beforeEach(() => {
  transport = createMemoryEndpointTransport({
    responses: {
      'goodsPrice.list': {
        success: true,
        error_code: 1000000,
        result: { total: 0, goods_price_info_list: [] },
      },
    },
  });
  ctx = createTestCtx({ transport });
});

it('requests the all-discounts scenes 10 and 11 under the all caliber', async () => {
  await getGoodsReceiptView(ctx, { caliber: 'all' });
  await getGoodsReceiptView(ctx, {});
  assert.deepEqual(transport.calls.map((call) => [call.name, call.payload.consult_price_scene_list]),
    [['goodsPrice.list', [10, 11]], ['goodsPrice.list', [7, 8]]]);
});

it('sends the parsed goods ids as goods_id_list', async () => {
  await getGoodsReceiptView(ctx, { goodsIds: ['101', '102', '103'] });
  assert.deepEqual(transport.calls[0].payload.goods_search_condition, { goods_id_list: [101, 102, 103] });
});
