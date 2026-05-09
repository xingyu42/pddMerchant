import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { validateGoodsId, validateWriteValue } from '../../src/services/goods.js';
import { mapWriteBusinessError, GOODS_UPDATE_STATUS, GOODS_UPDATE_PRICE } from '../../src/adapter/endpoints/goods.js';

describe('Goods Update PBT', () => {
  // P4: bounds_rejection — values outside platform limits → E_USAGE before trigger
  it('P4: price outside bounds always rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.double({ min: 0.1, max: 0.9 }),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity),
        ),
        (price) => {
          assert.throws(() => validateWriteValue('price', price), (e) => e.code === 'E_USAGE');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('P4: valid price always accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999999 }),
        (price) => {
          assert.equal(validateWriteValue('price', price), price);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('P4: stock outside bounds always rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: -1 }),
          fc.double({ min: 0.1, max: 0.9 }),
          fc.constant(NaN),
        ),
        (qty) => {
          assert.throws(() => validateWriteValue('stock', qty), (e) => e.code === 'E_USAGE');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('P4: valid stock always accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999999 }),
        (qty) => {
          assert.equal(validateWriteValue('stock', qty), qty);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('P4: title outside bounds always rejected', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.char(), { minLength: 121, maxLength: 200 }),
        (title) => {
          assert.throws(() => validateWriteValue('title', title), (e) => e.code === 'E_USAGE');
        }
      ),
      { numRuns: 20 }
    );
  });

  // P6: error_preservation — PDD error bodies → correct PddCliError mapping
  it('P6: error codes map to correct PddCliError codes', () => {
    fc.assert(
      fc.property(
        fc.record({
          error_code: fc.oneof(fc.constant(54001), fc.constant(1000), fc.constant(9999)),
          error_msg: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        (raw) => {
          const mapped = mapWriteBusinessError(raw);
          assert.ok(mapped !== null, 'non-success codes must map');
          if (raw.error_code === 54001) {
            assert.equal(mapped.code, 'E_RATE_LIMIT');
            assert.equal(mapped.exitCode, 4);
          } else if (raw.error_code === 1000) {
            assert.equal(mapped.code, 'E_USAGE');
            assert.equal(mapped.exitCode, 2);
          } else {
            assert.equal(mapped.code, 'E_BUSINESS');
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('P6: success codes do not map to error', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(0), fc.constant(1000000)),
        (code) => {
          const mapped = mapWriteBusinessError({ error_code: code });
          assert.equal(mapped, null, `code ${code} should not map to error`);
        }
      ),
    );
  });

  // P7: goods_id_required — invalid IDs → E_USAGE pre-network
  it('P7: invalid goods_id always rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(0),
          fc.constant(NaN),
          fc.constant(''),
          fc.constant(-1),
          fc.constant(1.5),
          fc.constant('abc'),
        ),
        (id) => {
          assert.throws(() => validateGoodsId(id), (e) => e.code === 'E_USAGE');
        }
      ),
    );
  });

  it('P7: valid goods_id always accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        (id) => {
          assert.equal(validateGoodsId(id), id);
        }
      ),
      { numRuns: 100 }
    );
  });

  // P3: absolute_value_idempotency — writing same value twice yields identical results
  it('P3: normalize is deterministic for same input', () => {
    fc.assert(
      fc.property(
        fc.record({
          success: fc.boolean(),
          errorCode: fc.oneof(fc.constant(0), fc.constant(1000000), fc.constant(54001)),
          result: fc.record({ goods_id: fc.integer({ min: 1 }) }),
        }),
        (raw) => {
          const r1 = GOODS_UPDATE_STATUS.normalize(raw);
          const r2 = GOODS_UPDATE_STATUS.normalize(raw);
          assert.deepStrictEqual(r1.success, r2.success);
          assert.deepStrictEqual(r1.goods_id, r2.goods_id);
        }
      ),
      { numRuns: 50 }
    );
  });
});
