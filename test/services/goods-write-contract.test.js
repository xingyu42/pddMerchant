import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import {
  validateGoodsId, validateWriteValue, updateGoodsPrice, updateGoodsStock,
  updateGoodsStatus, updateGoodsTitle,
} from '../../src/services/goods.js';
import { PddCliError } from '../../src/infra/errors.js';
import { isUsageError } from '../helpers/error-matchers.js';

// These tests mock client.execute directly, bypassing fixture adapter
beforeEach(() => vi.stubEnv('PDD_TEST_ADAPTER', ''));

describe('public goods validation', () => {
  it.each([null, undefined, '', 0, -1, 1.5, NaN, Infinity, 'not-an-id'])('rejects invalid goods id %#', (value) => {
    assert.throws(() => validateGoodsId(value), isUsageError);
  });

  it('accepts numeric ids and valid boundary values', () => {
    assert.equal(validateGoodsId('1001'), 1001);
    assert.equal(validateWriteValue('price', '1'), 1);
    assert.equal(validateWriteValue('stock', 0), 0);
    assert.equal(validateWriteValue('status', 'offline'), 'offline');
    assert.equal(validateWriteValue('status', 'onsale'), 'onsale');
    assert.equal(validateWriteValue('title', '  x  '), 'x');
    assert.equal(validateWriteValue('title', 'x'.repeat(120)), 'x'.repeat(120));
  });

  it.each([
    ['price', 0], ['price', -1], ['price', 1.5], ['price', Infinity],
    ['stock', -1], ['stock', 0.5], ['stock', NaN],
    ['status', 'paused'], ['title', '  '], ['title', 'x'.repeat(121)], ['unknown', 1],
  ])('rejects invalid %s value %#', (field, value) => {
    assert.throws(() => validateWriteValue(field, value), isUsageError);
  });
});

describe('goods service external write boundary', () => {
  it.each([
    ['price', updateGoodsPrice, '2999', { goods_id: 1001, price: 2999, sku_id: 'sku-synthetic' }],
    ['stock', updateGoodsStock, 0, { goods_id: 1001, quantity: 0, sku_id: 'sku-synthetic' }],
    ['status', updateGoodsStatus, 'offline', { goods_id: 1001, status: 'offline' }],
    ['title', updateGoodsTitle, '  Synthetic  ', { goods_id: 1001, title: 'Synthetic' }],
  ])('sends normalized %s with identity intact', async (field, update, value, expected) => {
    const data = { accepted: true, receipt: `synthetic-${field}` };
    const execute = vi.fn(async () => ({ data }));
    const page = {};
    const signal = new AbortController().signal;
    const result = await update(page, '1001', value, { client: { execute }, config: { skuId: 'sku-synthetic' }, signal });
    assert.deepEqual(result, data);
    assert.equal(execute.mock.calls.length, 1);
    const [spec, params, context] = execute.mock.calls[0];
    assert.equal(spec.name, `goods.update.${field}`);
    assert.deepEqual(params, expected);
    assert.equal(context.page, page);
    assert.equal(context.signal, signal);
  });

  it.each([
    ['price', updateGoodsPrice, 0, 100], ['stock', updateGoodsStock, -1, 0],
    ['status', updateGoodsStatus, 'invalid', 'offline'], ['title', updateGoodsTitle, '', 'Synthetic'],
  ])('does not send invalid %s or invalid identity', async (_field, update, badValue, validValue) => {
    const execute = vi.fn();
    const ctx = { client: { execute } };
    await assert.rejects(update({}, 1001, badValue, ctx), isUsageError);
    await assert.rejects(update({}, 0, validValue, ctx), isUsageError);
    assert.equal(execute.mock.calls.length, 0);
  });

  it('propagates a mapped endpoint failure without replacing its category', async () => {
    const error = new PddCliError({ code: 'E_RATE_LIMIT', message: 'synthetic limit', exitCode: 4 });
    const execute = vi.fn(async () => { throw error; });
    await assert.rejects(updateGoodsStock({}, 1001, 0, { client: { execute } }), (actual) => actual === error);
    assert.equal(execute.mock.calls.length, 1);
  });
});
