import { it } from 'vitest';
import assert from 'node:assert/strict';
import { GOODS_LIST } from '../src/adapter/endpoints/goods.js';

it('rejects missing or invalid successful goods response fields', () => {
  for (const result of [{}, { total: 0 }, { goods_list: [] }, { total: 0, goods_list: null }, { total: NaN, goods_list: [] }, { total: 1, goods_list: [{}] }]) {
    assert.throws(() => GOODS_LIST.normalize({ success: true, result }), (err) => err.code === 'E_NETWORK' && err.exitCode === 5);
  }
});
it('preserves explicit zero and empty goods results', () => {
  const result = GOODS_LIST.normalize({ success: true, result: { total: 0, goods_list: [] } });
  assert.equal(result.total, 0);
  assert.deepEqual(result.goods, []);
});
it('preserves supported numeric string counts', () => {
  const result = GOODS_LIST.normalize({ success: true, result: { total: '1', goods_list: [{ quantity: '0' }] } });
  assert.equal(result.total, 1);
  assert.equal(result.goods[0].quantity, 0);
});
