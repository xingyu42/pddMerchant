import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { validateGoodsId, validateWriteValue } from '../src/services/goods.js';

describe('validateGoodsId', () => {
  it('accepts valid positive integer', () => {
    assert.equal(validateGoodsId(1001), 1001);
    assert.equal(validateGoodsId('732191698596'), 732191698596);
  });

  it('rejects null/undefined/empty', () => {
    for (const val of [null, undefined, '']) {
      assert.throws(() => validateGoodsId(val), (e) => e.code === 'E_USAGE');
    }
  });

  it('rejects zero/negative/NaN/float', () => {
    for (const val of [0, -1, NaN, 1.5, 'abc', Infinity]) {
      assert.throws(() => validateGoodsId(val), (e) => e.code === 'E_USAGE');
    }
  });
});

describe('validateWriteValue', () => {
  describe('status', () => {
    it('accepts onsale/offline', () => {
      assert.equal(validateWriteValue('status', 'onsale'), 'onsale');
      assert.equal(validateWriteValue('status', 'offline'), 'offline');
    });

    it('rejects invalid status', () => {
      assert.throws(() => validateWriteValue('status', 'unknown'), (e) => e.code === 'E_USAGE');
    });
  });

  describe('price', () => {
    it('accepts positive integer', () => {
      assert.equal(validateWriteValue('price', 2999), 2999);
      assert.equal(validateWriteValue('price', '100'), 100);
    });

    it('rejects zero/negative/float', () => {
      for (const val of [0, -1, 1.5, 'free', NaN]) {
        assert.throws(() => validateWriteValue('price', val), (e) => e.code === 'E_USAGE');
      }
    });
  });

  describe('stock', () => {
    it('accepts non-negative integer', () => {
      assert.equal(validateWriteValue('stock', 0), 0);
      assert.equal(validateWriteValue('stock', 100), 100);
    });

    it('rejects negative/float', () => {
      for (const val of [-1, 1.5, 'abc', NaN]) {
        assert.throws(() => validateWriteValue('stock', val), (e) => e.code === 'E_USAGE');
      }
    });
  });

  describe('title', () => {
    it('accepts valid title', () => {
      assert.equal(validateWriteValue('title', '测试商品标题'), '测试商品标题');
    });

    it('rejects empty title', () => {
      assert.throws(() => validateWriteValue('title', ''), (e) => e.code === 'E_USAGE');
      assert.throws(() => validateWriteValue('title', '   '), (e) => e.code === 'E_USAGE');
    });

    it('rejects title over 120 chars', () => {
      const long = 'x'.repeat(121);
      assert.throws(() => validateWriteValue('title', long), (e) => e.code === 'E_USAGE');
    });

    it('trims whitespace', () => {
      assert.equal(validateWriteValue('title', '  hello  '), 'hello');
    });
  });

  describe('unknown field', () => {
    it('rejects unknown field', () => {
      assert.throws(() => validateWriteValue('color', 'red'), (e) => e.code === 'E_USAGE');
    });
  });
});
