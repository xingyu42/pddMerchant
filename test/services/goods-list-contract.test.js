import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import { listGoods } from '../../src/services/goods.js';

beforeEach(() => vi.stubEnv('PDD_TEST_ADAPTER', ''));

describe('goods list identity mapping', () => {
  it('maps upstream id at both endpoint and service boundaries', async () => {
    const goods = { id: 673183509913, goods_name: 'Synthetic', quantity: 10 };
    const result = GOODS_LIST.normalize({ success: true, result: {
      total: 1, goods_list: [goods],
    } });
    assert.equal(result.goods[0].goods_id, goods.id);
    const execute = vi.fn(async () => ({ data: { total: 1, goods: [goods] } }));
    const listed = await listGoods({}, {}, { client: { execute } });
    assert.equal(listed.goods[0].goods_id, goods.id);
  });
});
