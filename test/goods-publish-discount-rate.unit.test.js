import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { readFullCountDiscountRate, DEFAULT_FULL_COUNT_DISCOUNT_RATE } from '../src/infra/config.js';

describe('readFullCountDiscountRate unit', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.PDD_FULL_COUNT_DISCOUNT_RATE;
    delete process.env.PDD_FULL_COUNT_DISCOUNT_RATE;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PDD_FULL_COUNT_DISCOUNT_RATE = originalEnv;
    } else {
      delete process.env.PDD_FULL_COUNT_DISCOUNT_RATE;
    }
  });

  it('returns 0.95 when env var is not set', () => {
    assert.strictEqual(readFullCountDiscountRate(), 0.95);
  });

  it('returns 0.95 when env var is empty string', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '' }), 0.95);
  });

  it('accepts decimal form 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '0.95' }), 0.95);
  });

  it('accepts percentage form 95 → 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '95' }), 0.95);
  });

  it('accepts percentage form 85 → 0.85', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '85' }), 0.85);
  });

  it('accepts boundary 0.5', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '0.5' }), 0.5);
  });

  it('accepts boundary 0.99', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '0.99' }), 0.99);
  });

  it('accepts percentage boundary 50 → 0.5', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '50' }), 0.5);
  });

  it('accepts percentage boundary 99 → 0.99', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '99' }), 0.99);
  });

  it('rejects value below 0.5 → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '0.49' }), 0.95);
  });

  it('rejects value above 0.99 → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '1.0' }), 0.95);
  });

  it('rejects negative value → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '-0.5' }), 0.95);
  });

  it('rejects non-numeric string → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: 'abc' }), 0.95);
  });

  it('rejects percentage form below 50 → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '49' }), 0.95);
  });

  it('rejects percentage form above 99 → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '100' }), 0.95);
  });

  it('handles whitespace-padded input', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: '  0.8  ' }), 0.8);
  });

  it('rejects Infinity → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: 'Infinity' }), 0.95);
  });

  it('rejects NaN → fallback 0.95', () => {
    assert.strictEqual(readFullCountDiscountRate({ PDD_FULL_COUNT_DISCOUNT_RATE: 'NaN' }), 0.95);
  });

  it('exports DEFAULT_FULL_COUNT_DISCOUNT_RATE constant', () => {
    assert.strictEqual(DEFAULT_FULL_COUNT_DISCOUNT_RATE, 0.95);
  });
});
